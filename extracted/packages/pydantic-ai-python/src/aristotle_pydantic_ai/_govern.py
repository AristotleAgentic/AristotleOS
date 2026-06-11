"""Pydantic AI wrappers that route every tool invocation through the
AristotleOS Commit Gate.

Pydantic AI introspects tool function signatures to build JSON schema; the
wrappers preserve the wrapped function's ``__signature__``, ``__name__``,
``__annotations__``, and docstring via ``functools.wraps`` + explicit signature
copy, so the agent runtime sees no change in the tool's parameter shape.
"""

from __future__ import annotations

import asyncio
import functools
import inspect
import time
from datetime import datetime, timezone
from typing import (
    Any,
    Awaitable,
    Callable,
    Dict,
    Iterable,
    Optional,
    Set,
    Union,
)

from aristotle import AristotleApiError, AristotleClient


class AristotlePydanticAiError(Exception):
    """Base class for Aristotle / Pydantic AI integration errors."""


class GateRefusal(AristotlePydanticAiError):
    def __init__(self, tool_name: str, reason_codes: Iterable[str], gel_record_id: Optional[str], decision: Dict[str, Any]) -> None:
        codes = list(reason_codes) or ["no reason codes"]
        super().__init__(
            f"aristotle: REFUSE on {tool_name} - {', '.join(codes)} - record {gel_record_id or '(none)'}"
        )
        self.tool_name = tool_name
        self.reason_codes = codes
        self.gel_record_id = gel_record_id
        self.decision = decision


class GateEscalation(AristotlePydanticAiError):
    def __init__(self, tool_name: str, reason_codes: Iterable[str], gel_record_id: Optional[str], decision: Dict[str, Any]) -> None:
        codes = list(reason_codes) or ["no reason codes"]
        super().__init__(
            f"aristotle: ESCALATE on {tool_name} - {', '.join(codes)} - record {gel_record_id or '(none)'}"
        )
        self.tool_name = tool_name
        self.reason_codes = codes
        self.gel_record_id = gel_record_id
        self.decision = decision


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _action_id(tool_name: str) -> str:
    return f"pydantic-ai-{tool_name}-{int(time.time() * 1000):x}"


def _build_action(
    *,
    tool_name: str,
    tool_input: Dict[str, Any],
    ward_id: str,
    subject: str,
    action_type: str,
) -> Dict[str, Any]:
    return {
        "action_id": _action_id(tool_name),
        "ward_id": ward_id,
        "subject": subject,
        "action_type": action_type,
        "params": tool_input,
        "requested_at": _now_iso(),
        "telemetry": {"agent_runtime": "pydantic-ai"},
    }


def _coerce_passthrough(tools: Union[Set[str], Iterable[str], None]) -> Set[str]:
    if tools is None:
        return set()
    if isinstance(tools, set):
        return tools
    return set(tools)


def _refuse_message(tool_name: str, decision: Dict[str, Any]) -> str:
    codes = decision.get("reason_codes") or []
    gel = decision.get("gel_record") or {}
    return f"aristotle: REFUSE on {tool_name} - {', '.join(codes) or 'no reason codes'} - record {gel.get('record_id', '(none)')}"


def _escalate_message(tool_name: str, decision: Dict[str, Any]) -> str:
    codes = decision.get("reason_codes") or []
    gel = decision.get("gel_record") or {}
    return f"aristotle: ESCALATE on {tool_name} - {', '.join(codes) or 'no reason codes'} - record {gel.get('record_id', '(none)')}"


def _error_message(tool_name: str, exc: BaseException) -> str:
    if isinstance(exc, AristotleApiError):
        return f"aristotle: gate error HTTP {exc.status} on {tool_name}: {exc}"
    return f"aristotle: gate unreachable on {tool_name}: {exc}"


def _extract_args(func: Callable[..., Any], args: tuple, kwargs: Dict[str, Any]) -> Dict[str, Any]:
    """Bind positional args to parameter names so the gate sees them as a dict."""
    try:
        sig = inspect.signature(func)
        bound = sig.bind_partial(*args, **kwargs)
        # Skip the RunContext (first positional) if Pydantic AI is using @agent.tool (not tool_plain)
        params = dict(bound.arguments)
        # Strip RunContext-named first param if present
        for name in list(params.keys()):
            cls_name = type(params[name]).__name__
            if cls_name == "RunContext":
                del params[name]
                break
        return params
    except (TypeError, ValueError):
        return {**kwargs, **({"_args": list(args)} if args else {})}


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
    """Wrap a Pydantic AI tool function with Aristotle governance.

    The returned function preserves the wrapped function's signature so
    Pydantic AI's schema introspection sees no change. Sync and async
    functions are both supported (auto-detected via
    :func:`inspect.iscoroutinefunction`).
    """
    if not name:
        raise ValueError("govern_tool_function requires a non-empty 'name'")
    if not ward_id:
        raise ValueError("govern_tool_function requires a non-empty 'ward_id'")
    if not subject:
        raise ValueError("govern_tool_function requires a non-empty 'subject'")

    is_async = inspect.iscoroutinefunction(func)

    def _build(args: tuple, kwargs: Dict[str, Any]) -> Dict[str, Any]:
        tool_input = _extract_args(func, args, kwargs)
        action_type = action_type_for(name) if action_type_for else f"{action_type_prefix}.{name.lower()}"
        return (
            build_action(tool_name=name, tool_input=tool_input, ward_id=ward_id, subject=subject, action_type=action_type)
            if build_action
            else _build_action(tool_name=name, tool_input=tool_input, ward_id=ward_id, subject=subject, action_type=action_type)
        )

    def _handle_verdict(decision: Dict[str, Any], tool_input: Dict[str, Any]) -> Any:
        verdict = decision.get("decision")
        if verdict == "ALLOW":
            return "_ALLOW_"
        if verdict == "ESCALATE":
            if on_escalate == "raise":
                raise GateEscalation(name, decision.get("reason_codes") or [], (decision.get("gel_record") or {}).get("record_id"), decision)
            return _escalate_message(name, decision)
        if on_refuse == "raise":
            raise GateRefusal(name, decision.get("reason_codes") or [], (decision.get("gel_record") or {}).get("record_id"), decision)
        return _refuse_message(name, decision)

    if is_async:
        @functools.wraps(func)
        async def _async_wrapped(*args: Any, **kwargs: Any) -> Any:
            if passthrough:
                return await func(*args, **kwargs)
            tool_input = _extract_args(func, args, kwargs)
            action = _build(args, kwargs)
            t0 = time.monotonic()
            try:
                decision = await asyncio.to_thread(client.evaluate, action)
            except Exception as exc:
                elapsed_ms = (time.monotonic() - t0) * 1000.0
                if on_decision is not None:
                    on_decision(tool_name=name, tool_input=tool_input, action=action, decision={"decision": "ERROR", "reason_codes": [str(exc)]}, elapsed_ms=elapsed_ms)
                if on_error == "raise":
                    raise
                return _error_message(name, exc)
            elapsed_ms = (time.monotonic() - t0) * 1000.0
            if on_decision is not None:
                on_decision(tool_name=name, tool_input=tool_input, action=action, decision=decision, elapsed_ms=elapsed_ms)
            verdict_or_msg = _handle_verdict(decision, tool_input)
            if verdict_or_msg == "_ALLOW_":
                return await func(*args, **kwargs)
            return verdict_or_msg

        _async_wrapped.__signature__ = inspect.signature(func)  # type: ignore[attr-defined]
        return _async_wrapped

    @functools.wraps(func)
    def _sync_wrapped(*args: Any, **kwargs: Any) -> Any:
        if passthrough:
            return func(*args, **kwargs)
        tool_input = _extract_args(func, args, kwargs)
        action = _build(args, kwargs)
        t0 = time.monotonic()
        try:
            decision = client.evaluate(action)
        except Exception as exc:
            elapsed_ms = (time.monotonic() - t0) * 1000.0
            if on_decision is not None:
                on_decision(tool_name=name, tool_input=tool_input, action=action, decision={"decision": "ERROR", "reason_codes": [str(exc)]}, elapsed_ms=elapsed_ms)
            if on_error == "raise":
                raise
            return _error_message(name, exc)
        elapsed_ms = (time.monotonic() - t0) * 1000.0
        if on_decision is not None:
            on_decision(tool_name=name, tool_input=tool_input, action=action, decision=decision, elapsed_ms=elapsed_ms)
        verdict_or_msg = _handle_verdict(decision, tool_input)
        if verdict_or_msg == "_ALLOW_":
            return func(*args, **kwargs)
        return verdict_or_msg

    _sync_wrapped.__signature__ = inspect.signature(func)  # type: ignore[attr-defined]
    return _sync_wrapped


def govern_pydantic_ai_tool(
    tool: Any,
    *,
    client: AristotleClient,
    ward_id: str,
    subject: str,
    **kwargs: Any,
) -> Any:
    """Wrap a ``pydantic_ai.tools.Tool`` and return a same-shape governed twin.

    Re-uses :func:`govern_tool_function` on the tool's ``function`` field.
    Pydantic AI's Tool class is a Pydantic model; we call ``model_copy`` with
    the updated function so all other configuration (name, description,
    args_validator, prepare, requires_approval, etc.) is preserved.
    """
    tool_name = getattr(tool, "name", None) or getattr(getattr(tool, "function", None), "__name__", "tool")
    inner_func = getattr(tool, "function", None)
    if inner_func is None:
        raise ValueError("govern_pydantic_ai_tool: tool has no 'function' attribute")
    governed_func = govern_tool_function(
        inner_func, name=tool_name, client=client, ward_id=ward_id, subject=subject, **kwargs
    )
    if hasattr(tool, "model_copy"):
        return tool.model_copy(update={"function": governed_func})
    # Fallback: mutate the function attribute on the instance.
    try:
        tool.function = governed_func
    except Exception:
        pass
    return tool


def aristotle_governed(
    *,
    client: AristotleClient,
    ward_id: str,
    subject: str,
    **kwargs: Any,
) -> Callable[[str], Callable[[Callable[..., Any]], Callable[..., Any]]]:
    """Decorator factory: ``@aristotle_governed(client=..., ward_id=..., subject=...)(name)``.

    Use in combination with Pydantic AI's ``@agent.tool`` / ``@agent.tool_plain``::

        govern = aristotle_governed(client=aos, ward_id=..., subject=...)

        @agent.tool_plain
        @govern("send_email")
        def send_email(to: str, body: str) -> str:
            ...
    """
    def factory(name: str) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        def decorator(fn: Callable[..., Any]) -> Callable[..., Any]:
            return govern_tool_function(fn, name=name, client=client, ward_id=ward_id, subject=subject, **kwargs)

        return decorator

    return factory
