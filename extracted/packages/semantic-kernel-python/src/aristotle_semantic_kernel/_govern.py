"""Semantic Kernel function wrappers that route every invocation through the
AristotleOS Commit Gate.

Semantic Kernel introspects function signatures and uses ``@kernel_function``
metadata to build the LLM tool schema. The wrapper preserves the wrapped
function's signature via ``functools.wraps`` + explicit signature copy, and
forwards any ``kernel_function`` metadata attributes set by the decorator.
"""

from __future__ import annotations

import asyncio
import functools
import inspect
import time
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Iterable, Optional

from aristotle import AristotleApiError, AristotleClient


class AristotleSemanticKernelError(Exception):
    pass


class GateRefusal(AristotleSemanticKernelError):
    def __init__(self, tool_name: str, reason_codes: Iterable[str], gel_record_id: Optional[str], decision: Dict[str, Any]) -> None:
        codes = list(reason_codes) or ["no reason codes"]
        super().__init__(f"aristotle: REFUSE on {tool_name} - {', '.join(codes)} - record {gel_record_id or '(none)'}")
        self.tool_name = tool_name
        self.reason_codes = codes
        self.gel_record_id = gel_record_id
        self.decision = decision


class GateEscalation(AristotleSemanticKernelError):
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
        "action_id": f"sk-{tool_name}-{int(time.time() * 1000):x}",
        "ward_id": ward_id, "subject": subject, "action_type": action_type,
        "params": tool_input, "requested_at": _now(),
        "telemetry": {"agent_runtime": "semantic-kernel"},
    }


def _extract_args(func: Callable[..., Any], args: tuple, kwargs: Dict[str, Any]) -> Dict[str, Any]:
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


# Semantic Kernel sets these attributes on functions decorated with @kernel_function.
_SK_METADATA_ATTRS = (
    "__kernel_function__",
    "__kernel_function_name__",
    "__kernel_function_description__",
    "__kernel_function_parameters__",
    "__kernel_function_return_description__",
    "__kernel_function_return_required__",
    "__kernel_function_return_type__",
    "__kernel_function_streaming__",
)


def _copy_sk_metadata(src: Callable[..., Any], dst: Callable[..., Any]) -> None:
    for attr in _SK_METADATA_ATTRS:
        if hasattr(src, attr):
            try:
                setattr(dst, attr, getattr(src, attr))
            except Exception:
                pass


def govern_kernel_function(
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
    """Wrap a Semantic Kernel function with Aristotle governance.

    Preserves the wrapped function's signature AND any ``__kernel_function_*``
    attributes set by the ``@kernel_function`` decorator. Stack ABOVE
    ``@kernel_function`` so the metadata exists when this wrapper copies it.
    Sync + async auto-detected.
    """
    if not name:
        raise ValueError("govern_kernel_function requires a non-empty 'name'")
    if not ward_id:
        raise ValueError("govern_kernel_function requires a non-empty 'ward_id'")
    if not subject:
        raise ValueError("govern_kernel_function requires a non-empty 'subject'")

    is_async = inspect.iscoroutinefunction(func)

    def _action(args: tuple, kwargs: Dict[str, Any]) -> tuple:
        tool_input = _extract_args(func, args, kwargs)
        action_type = action_type_for(name) if action_type_for else f"{action_type_prefix}.{name.lower()}"
        action = (
            build_action(tool_name=name, tool_input=tool_input, ward_id=ward_id, subject=subject, action_type=action_type)
            if build_action
            else _build_action(tool_name=name, tool_input=tool_input, ward_id=ward_id, subject=subject, action_type=action_type)
        )
        return tool_input, action

    def _decide(decision: Dict[str, Any]) -> Optional[Any]:
        v = decision.get("decision")
        if v == "ALLOW": return None
        if v == "ESCALATE":
            if on_escalate == "raise":
                raise GateEscalation(name, decision.get("reason_codes") or [], (decision.get("gel_record") or {}).get("record_id"), decision)
            return _escalate(name, decision)
        if on_refuse == "raise":
            raise GateRefusal(name, decision.get("reason_codes") or [], (decision.get("gel_record") or {}).get("record_id"), decision)
        return _refuse(name, decision)

    if is_async:
        @functools.wraps(func)
        async def _aw(*args: Any, **kwargs: Any) -> Any:
            if passthrough:
                return await func(*args, **kwargs)
            tool_input, action = _action(args, kwargs)
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
        _copy_sk_metadata(func, _aw)
        return _aw

    @functools.wraps(func)
    def _sw(*args: Any, **kwargs: Any) -> Any:
        if passthrough:
            return func(*args, **kwargs)
        tool_input, action = _action(args, kwargs)
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
    _copy_sk_metadata(func, _sw)
    return _sw


def aristotle_governed(*, client: AristotleClient, ward_id: str, subject: str, **kwargs: Any) -> Callable[[str], Callable[[Callable[..., Any]], Callable[..., Any]]]:
    """Decorator factory: stack with ``@kernel_function``.

    Example::

        govern = aristotle_governed(client=aos, ward_id=..., subject=...)

        class MyPlugin:
            @govern("send_email")
            @kernel_function(name="send_email", description="Send an email.")
            async def send_email(self, to: str, body: str) -> str:
                ...
    """
    def factory(name: str) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        def decorator(fn: Callable[..., Any]) -> Callable[..., Any]:
            return govern_kernel_function(fn, name=name, client=client, ward_id=ward_id, subject=subject, **kwargs)
        return decorator
    return factory
