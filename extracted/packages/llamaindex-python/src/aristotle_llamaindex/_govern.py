"""LlamaIndex tool wrappers that route every invocation through the
AristotleOS Commit Gate.
"""

from __future__ import annotations

import asyncio
import functools
import inspect
import time
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, Iterable, Optional

from aristotle import AristotleApiError, AristotleClient


class AristotleLlamaIndexError(Exception):
    pass


class GateRefusal(AristotleLlamaIndexError):
    def __init__(self, tool_name: str, reason_codes: Iterable[str], gel_record_id: Optional[str], decision: Dict[str, Any]) -> None:
        codes = list(reason_codes) or ["no reason codes"]
        super().__init__(f"aristotle: REFUSE on {tool_name} - {', '.join(codes)} - record {gel_record_id or '(none)'}")
        self.tool_name = tool_name
        self.reason_codes = codes
        self.gel_record_id = gel_record_id
        self.decision = decision


class GateEscalation(AristotleLlamaIndexError):
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
        "action_id": f"llamaindex-{tool_name}-{int(time.time() * 1000):x}",
        "ward_id": ward_id, "subject": subject, "action_type": action_type,
        "params": tool_input, "requested_at": _now(),
        "telemetry": {"agent_runtime": "llamaindex"},
    }


def _extract(func: Callable[..., Any], args: tuple, kwargs: Dict[str, Any]) -> Dict[str, Any]:
    try:
        bound = inspect.signature(func).bind_partial(*args, **kwargs)
        return dict(bound.arguments)
    except (TypeError, ValueError):
        return {**kwargs, **({"_args": list(args)} if args else {})}


def _refuse(name: str, d: Dict[str, Any]) -> str:
    codes = d.get("reason_codes") or []
    gel = d.get("gel_record") or {}
    return f"aristotle: REFUSE on {name} - {', '.join(codes) or 'no reason codes'} - record {gel.get('record_id', '(none)')}"


def _escalate(name: str, d: Dict[str, Any]) -> str:
    codes = d.get("reason_codes") or []
    gel = d.get("gel_record") or {}
    return f"aristotle: ESCALATE on {name} - {', '.join(codes) or 'no reason codes'} - record {gel.get('record_id', '(none)')}"


def _err(name: str, exc: BaseException) -> str:
    if isinstance(exc, AristotleApiError):
        return f"aristotle: gate error HTTP {exc.status} on {name}: {exc}"
    return f"aristotle: gate unreachable on {name}: {exc}"


def govern_tool_function(
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
    """Wrap a LlamaIndex tool function with Aristotle governance.

    Pass the result to ``FunctionTool.from_defaults(fn=governed_func, ...)``.
    Sync + async auto-detected.
    """
    if not name:
        raise ValueError("govern_tool_function requires a non-empty 'name'")
    if not ward_id:
        raise ValueError("govern_tool_function requires a non-empty 'ward_id'")
    if not subject:
        raise ValueError("govern_tool_function requires a non-empty 'subject'")

    is_async = inspect.iscoroutinefunction(func)

    def _act(args: tuple, kwargs: Dict[str, Any]) -> tuple:
        tool_input = _extract(func, args, kwargs)
        action_type = action_type_for(name) if action_type_for else f"{action_type_prefix}.{name.lower()}"
        action = (
            build_action(tool_name=name, tool_input=tool_input, ward_id=ward_id, subject=subject, action_type=action_type)
            if build_action
            else _build_action(tool_name=name, tool_input=tool_input, ward_id=ward_id, subject=subject, action_type=action_type)
        )
        return tool_input, action

    def _decide(d: Dict[str, Any]) -> Optional[Any]:
        v = d.get("decision")
        if v == "ALLOW": return None
        if v == "ESCALATE":
            if on_escalate == "raise":
                raise GateEscalation(name, d.get("reason_codes") or [], (d.get("gel_record") or {}).get("record_id"), d)
            return _escalate(name, d)
        if on_refuse == "raise":
            raise GateRefusal(name, d.get("reason_codes") or [], (d.get("gel_record") or {}).get("record_id"), d)
        return _refuse(name, d)

    if is_async:
        @functools.wraps(func)
        async def _aw(*args: Any, **kwargs: Any) -> Any:
            if passthrough:
                return await func(*args, **kwargs)
            tool_input, action = _act(args, kwargs)
            t0 = time.monotonic()
            try:
                decision = await asyncio.to_thread(client.evaluate, action)
            except Exception as exc:
                if on_decision: on_decision(tool_name=name, tool_input=tool_input, action=action, decision={"decision": "ERROR", "reason_codes": [str(exc)]}, elapsed_ms=(time.monotonic() - t0) * 1000.0)
                if on_error == "raise": raise
                return _err(name, exc)
            if on_decision: on_decision(tool_name=name, tool_input=tool_input, action=action, decision=decision, elapsed_ms=(time.monotonic() - t0) * 1000.0)
            rv = _decide(decision)
            return await func(*args, **kwargs) if rv is None else rv
        _aw.__signature__ = inspect.signature(func)  # type: ignore[attr-defined]
        return _aw

    @functools.wraps(func)
    def _sw(*args: Any, **kwargs: Any) -> Any:
        if passthrough:
            return func(*args, **kwargs)
        tool_input, action = _act(args, kwargs)
        t0 = time.monotonic()
        try:
            decision = client.evaluate(action)
        except Exception as exc:
            if on_decision: on_decision(tool_name=name, tool_input=tool_input, action=action, decision={"decision": "ERROR", "reason_codes": [str(exc)]}, elapsed_ms=(time.monotonic() - t0) * 1000.0)
            if on_error == "raise": raise
            return _err(name, exc)
        if on_decision: on_decision(tool_name=name, tool_input=tool_input, action=action, decision=decision, elapsed_ms=(time.monotonic() - t0) * 1000.0)
        rv = _decide(decision)
        return func(*args, **kwargs) if rv is None else rv
    _sw.__signature__ = inspect.signature(func)  # type: ignore[attr-defined]
    return _sw


def govern_llamaindex_tool(tool: Any, *, client: AristotleClient, ward_id: str, subject: str, **kwargs: Any) -> Any:
    """Wrap a constructed ``FunctionTool`` and return a same-shape governed twin.

    LlamaIndex's FunctionTool stores the callable as ``.fn`` (sync) and
    optionally ``.async_fn``. We construct a new FunctionTool with both
    governed when present.
    """
    tool_name = getattr(getattr(tool, "metadata", None), "name", None) or getattr(getattr(tool, "fn", None), "__name__", "tool")
    inner_sync = getattr(tool, "fn", None)
    inner_async = getattr(tool, "async_fn", None)
    if inner_sync is None and inner_async is None:
        raise ValueError("govern_llamaindex_tool: tool has neither fn nor async_fn")

    governed_sync = govern_tool_function(inner_sync, name=tool_name, client=client, ward_id=ward_id, subject=subject, **kwargs) if inner_sync else None
    governed_async = govern_tool_function(inner_async, name=tool_name, client=client, ward_id=ward_id, subject=subject, **kwargs) if inner_async else None

    cls = type(tool)
    description = getattr(getattr(tool, "metadata", None), "description", "")
    if hasattr(cls, "from_defaults"):
        return cls.from_defaults(fn=governed_sync, async_fn=governed_async, name=tool_name, description=description)
    try:
        if governed_sync: tool.fn = governed_sync
        if governed_async: tool.async_fn = governed_async
    except Exception:
        pass
    return tool


def aristotle_governed(*, client: AristotleClient, ward_id: str, subject: str, **kwargs: Any) -> Callable[[str], Callable[[Callable[..., Any]], Callable[..., Any]]]:
    """Decorator factory."""
    def factory(name: str) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        def decorator(fn: Callable[..., Any]) -> Callable[..., Any]:
            return govern_tool_function(fn, name=name, client=client, ward_id=ward_id, subject=subject, **kwargs)
        return decorator
    return factory
