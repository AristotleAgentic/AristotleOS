"""AutoGen tool wrappers that route every invocation through the
AristotleOS Commit Gate.

AutoGen's ``FunctionTool(func, description, name=None)`` introspects the
function signature to build a JSON schema for the LLM. The wrapper
preserves the wrapped function's ``__signature__`` so the schema is
unchanged.
"""

from __future__ import annotations

import asyncio
import functools
import inspect
import time
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, Iterable, Optional, Set, Union

from aristotle import AristotleApiError, AristotleClient


class AristotleAutogenError(Exception):
    pass


class GateRefusal(AristotleAutogenError):
    def __init__(self, tool_name: str, reason_codes: Iterable[str], gel_record_id: Optional[str], decision: Dict[str, Any]) -> None:
        codes = list(reason_codes) or ["no reason codes"]
        super().__init__(f"aristotle: REFUSE on {tool_name} - {', '.join(codes)} - record {gel_record_id or '(none)'}")
        self.tool_name = tool_name
        self.reason_codes = codes
        self.gel_record_id = gel_record_id
        self.decision = decision


class GateEscalation(AristotleAutogenError):
    def __init__(self, tool_name: str, reason_codes: Iterable[str], gel_record_id: Optional[str], decision: Dict[str, Any]) -> None:
        codes = list(reason_codes) or ["no reason codes"]
        super().__init__(f"aristotle: ESCALATE on {tool_name} - {', '.join(codes)} - record {gel_record_id or '(none)'}")
        self.tool_name = tool_name
        self.reason_codes = codes
        self.gel_record_id = gel_record_id
        self.decision = decision


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _build_action(*, tool_name: str, tool_input: Dict[str, Any], ward_id: str, subject: str, action_type: str) -> Dict[str, Any]:
    return {
        "action_id": f"autogen-{tool_name}-{int(time.time() * 1000):x}",
        "ward_id": ward_id, "subject": subject, "action_type": action_type,
        "params": tool_input, "requested_at": _now(),
        "telemetry": {"agent_runtime": "autogen"},
    }


def _extract_args(func: Callable[..., Any], args: tuple, kwargs: Dict[str, Any]) -> Dict[str, Any]:
    try:
        bound = inspect.signature(func).bind_partial(*args, **kwargs)
        return dict(bound.arguments)
    except (TypeError, ValueError):
        return {**kwargs, **({"_args": list(args)} if args else {})}


def _refuse_msg(name: str, d: Dict[str, Any]) -> str:
    codes = d.get("reason_codes") or []
    gel = d.get("gel_record") or {}
    return f"aristotle: REFUSE on {name} - {', '.join(codes) or 'no reason codes'} - record {gel.get('record_id', '(none)')}"


def _escalate_msg(name: str, d: Dict[str, Any]) -> str:
    codes = d.get("reason_codes") or []
    gel = d.get("gel_record") or {}
    return f"aristotle: ESCALATE on {name} - {', '.join(codes) or 'no reason codes'} - record {gel.get('record_id', '(none)')}"


def _error_msg(name: str, exc: BaseException) -> str:
    if isinstance(exc, AristotleApiError):
        return f"aristotle: gate error HTTP {exc.status} on {name}: {exc}"
    return f"aristotle: gate unreachable on {name}: {exc}"


def govern_autogen_function(
    func: Callable[..., Any],
    *,
    name: str,
    client: AristotleClient,
    ward_id: str,
    subject: str,
    action_type_prefix: str = "tool",
    action_type_for: Optional[Callable[[str], str]] = None,
    build_action: Optional[Callable[..., Dict[str, Any]]] = None,
    passthrough: bool = False,
    on_refuse: str = "return_message",
    on_escalate: str = "return_message",
    on_error: str = "raise",
    on_decision: Optional[Callable[..., None]] = None,
) -> Callable[..., Any]:
    """Wrap an AutoGen tool function with Aristotle governance.

    Preserves signature so AutoGen's FunctionTool schema introspection
    sees no change. Sync + async auto-detected.
    """
    if not name:
        raise ValueError("govern_autogen_function requires a non-empty 'name'")
    if not ward_id:
        raise ValueError("govern_autogen_function requires a non-empty 'ward_id'")
    if not subject:
        raise ValueError("govern_autogen_function requires a non-empty 'subject'")

    is_async = inspect.iscoroutinefunction(func)

    def _make_action(args: tuple, kwargs: Dict[str, Any]) -> tuple:
        tool_input = _extract_args(func, args, kwargs)
        action_type = action_type_for(name) if action_type_for else f"{action_type_prefix}.{name.lower()}"
        action = (
            build_action(tool_name=name, tool_input=tool_input, ward_id=ward_id, subject=subject, action_type=action_type)
            if build_action
            else _build_action(tool_name=name, tool_input=tool_input, ward_id=ward_id, subject=subject, action_type=action_type)
        )
        return tool_input, action

    def _decide(decision: Dict[str, Any]) -> Optional[Any]:
        verdict = decision.get("decision")
        if verdict == "ALLOW":
            return None
        if verdict == "ESCALATE":
            if on_escalate == "raise":
                raise GateEscalation(name, decision.get("reason_codes") or [], (decision.get("gel_record") or {}).get("record_id"), decision)
            return _escalate_msg(name, decision)
        if on_refuse == "raise":
            raise GateRefusal(name, decision.get("reason_codes") or [], (decision.get("gel_record") or {}).get("record_id"), decision)
        return _refuse_msg(name, decision)

    if is_async:
        @functools.wraps(func)
        async def _aw(*args: Any, **kwargs: Any) -> Any:
            if passthrough:
                return await func(*args, **kwargs)
            tool_input, action = _make_action(args, kwargs)
            t0 = time.monotonic()
            try:
                decision = await asyncio.to_thread(client.evaluate, action)
            except Exception as exc:
                if on_decision: on_decision(tool_name=name, tool_input=tool_input, action=action, decision={"decision": "ERROR", "reason_codes": [str(exc)]}, elapsed_ms=(time.monotonic() - t0) * 1000.0)
                if on_error == "raise":
                    raise
                return _error_msg(name, exc)
            if on_decision: on_decision(tool_name=name, tool_input=tool_input, action=action, decision=decision, elapsed_ms=(time.monotonic() - t0) * 1000.0)
            rv = _decide(decision)
            return await func(*args, **kwargs) if rv is None else rv

        _aw.__signature__ = inspect.signature(func)  # type: ignore[attr-defined]
        return _aw

    @functools.wraps(func)
    def _sw(*args: Any, **kwargs: Any) -> Any:
        if passthrough:
            return func(*args, **kwargs)
        tool_input, action = _make_action(args, kwargs)
        t0 = time.monotonic()
        try:
            decision = client.evaluate(action)
        except Exception as exc:
            if on_decision: on_decision(tool_name=name, tool_input=tool_input, action=action, decision={"decision": "ERROR", "reason_codes": [str(exc)]}, elapsed_ms=(time.monotonic() - t0) * 1000.0)
            if on_error == "raise":
                raise
            return _error_msg(name, exc)
        if on_decision: on_decision(tool_name=name, tool_input=tool_input, action=action, decision=decision, elapsed_ms=(time.monotonic() - t0) * 1000.0)
        rv = _decide(decision)
        return func(*args, **kwargs) if rv is None else rv

    _sw.__signature__ = inspect.signature(func)  # type: ignore[attr-defined]
    return _sw


def govern_autogen_tool(tool: Any, *, client: AristotleClient, ward_id: str, subject: str, **kwargs: Any) -> Any:
    """Wrap an ``autogen_core.tools.FunctionTool`` and return a same-shape governed twin.

    AutoGen's FunctionTool exposes the underlying callable via ``_func`` (private)
    and ``name`` / ``description`` as public properties. We construct a new
    FunctionTool with the governed function; falling back to mutating the
    private ``_func`` attribute if the class can't be reconstructed.
    """
    tool_name = getattr(tool, "name", None) or getattr(getattr(tool, "_func", None), "__name__", "tool")
    inner = getattr(tool, "_func", None) or getattr(tool, "func", None)
    if inner is None:
        raise ValueError("govern_autogen_tool: tool has no '_func'/'func' attribute")
    governed = govern_autogen_function(inner, name=tool_name, client=client, ward_id=ward_id, subject=subject, **kwargs)

    cls = type(tool)
    description = getattr(tool, "description", "")
    try:
        return cls(governed, description=description, name=tool_name)
    except Exception:
        # Last resort: mutate.
        try:
            tool._func = governed
        except Exception:
            pass
        return tool


def aristotle_governed(*, client: AristotleClient, ward_id: str, subject: str, **kwargs: Any) -> Callable[[str], Callable[[Callable[..., Any]], Callable[..., Any]]]:
    """Decorator factory: ``@aristotle_governed(client=..., ward_id=..., subject=...)(name)``."""
    def factory(name: str) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        def decorator(fn: Callable[..., Any]) -> Callable[..., Any]:
            return govern_autogen_function(fn, name=name, client=client, ward_id=ward_id, subject=subject, **kwargs)
        return decorator
    return factory
