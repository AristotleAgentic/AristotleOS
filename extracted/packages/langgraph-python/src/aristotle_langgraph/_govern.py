"""LangGraph wrap_tool_call middleware that routes every tool call through
the AristotleOS Commit Gate.

The wrapper signature matches LangGraph's ``ToolCallWrapper`` /
``AsyncToolCallWrapper`` types from ``langgraph.prebuilt.tool_node``:

    ToolCallWrapper = Callable[
        [ToolCallRequest, Callable[[ToolCallRequest], ToolMessage | Command]],
        ToolMessage | Command,
    ]

The wrapper receives a ``ToolCallRequest`` and the underlying ``execute``
callable. On ALLOW the wrapper invokes ``execute(request)``; on REFUSE /
ESCALATE / error it synthesizes a ``ToolMessage`` (or, for ESCALATE with
``on_escalate='interrupt'``, calls ``langgraph.types.interrupt`` to pause
the graph for human-in-the-loop approval).
"""

from __future__ import annotations

import time
from dataclasses import dataclass
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

from aristotle import AristotleApiError, AristotleClient, AsyncAristotleClient


# ---------------------------------------------------------------------------
# Errors raised by the wrappers when configured to ``raise``.
# ---------------------------------------------------------------------------

class AristotleLanggraphError(Exception):
    """Base class for Aristotle / LangGraph integration errors."""


class GateRefusal(AristotleLanggraphError):
    """Raised when the gate REFUSES a tool call and ``on_refuse='raise'``."""

    def __init__(self, tool_name: str, reason_codes: Iterable[str], gel_record_id: Optional[str], decision: Dict[str, Any]) -> None:
        codes = list(reason_codes) or ["no reason codes"]
        super().__init__(
            f"aristotle: REFUSE on {tool_name} - {', '.join(codes)} - record {gel_record_id or '(none)'}"
        )
        self.tool_name = tool_name
        self.reason_codes = codes
        self.gel_record_id = gel_record_id
        self.decision = decision


class GateEscalation(AristotleLanggraphError):
    """Raised when the gate ESCALATES and ``on_escalate='raise'``."""

    def __init__(self, tool_name: str, reason_codes: Iterable[str], gel_record_id: Optional[str], decision: Dict[str, Any]) -> None:
        codes = list(reason_codes) or ["no reason codes"]
        super().__init__(
            f"aristotle: ESCALATE on {tool_name} - {', '.join(codes)} - record {gel_record_id or '(none)'}"
        )
        self.tool_name = tool_name
        self.reason_codes = codes
        self.gel_record_id = gel_record_id
        self.decision = decision


# ---------------------------------------------------------------------------
# Structured outcome surfaced to the agent in ToolMessage content (default
# behavior on REFUSE / ESCALATE / gate error).
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class AristotleToolOutcome:
    kind: str  # "REFUSE" | "ESCALATE" | "GATE_UNREACHABLE"
    tool_name: str
    reason_codes: tuple
    message: str
    gel_record_id: Optional[str] = None
    warrant_id: Optional[str] = None

    def to_content(self) -> str:
        """Render this outcome as the ``content`` of a ToolMessage."""
        import json

        return json.dumps(
            {
                "__aristotle": self.kind,
                "tool_name": self.tool_name,
                "reason_codes": list(self.reason_codes),
                "message": self.message,
                "gel_record_id": self.gel_record_id,
                "warrant_id": self.warrant_id,
            }
        )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _default_action_type(tool_name: str, prefix: str) -> str:
    return f"{prefix}.{tool_name.lower()}"


def _build_action(
    *,
    tool_name: str,
    tool_input: Dict[str, Any],
    tool_call_id: Optional[str],
    ward_id: str,
    subject: str,
    action_type: str,
) -> Dict[str, Any]:
    return {
        "action_id": tool_call_id or f"langgraph-{tool_name}-{int(time.time() * 1000):x}",
        "ward_id": ward_id,
        "subject": subject,
        "action_type": action_type,
        "params": tool_input,
        "requested_at": _now_iso(),
        "telemetry": {"agent_runtime": "langgraph"},
    }


def _coerce_passthrough(tools: Union[Set[str], Iterable[str], None]) -> Set[str]:
    if tools is None:
        return set()
    if isinstance(tools, set):
        return tools
    return set(tools)


def _read_tool_call(request: Any) -> tuple:
    """Extract (tool_name, tool_args, tool_call_id) from a ToolCallRequest."""
    tc = getattr(request, "tool_call", None)
    if tc is None:
        raise AttributeError("ToolCallRequest is missing the 'tool_call' field")
    # langchain_core.messages.tool.ToolCall is a TypedDict at runtime: a plain
    # dict with keys 'name', 'args', 'id', 'type'. Some versions may also pass
    # a Pydantic model; support both shapes.
    if isinstance(tc, dict):
        return (
            tc.get("name") or "",
            dict(tc.get("args") or {}),
            tc.get("id"),
        )
    return (
        getattr(tc, "name", "") or "",
        dict(getattr(tc, "args", {}) or {}),
        getattr(tc, "id", None),
    )


def _make_tool_message(content: str, tool_call_id: Optional[str], name: Optional[str], status: str) -> Any:
    """Construct a langchain_core ToolMessage at runtime (lazy import).

    Returns a langchain ToolMessage if the import succeeds; otherwise returns
    a structurally-compatible plain dict (useful in tests that don't depend
    on langchain).
    """
    try:
        from langchain_core.messages import ToolMessage  # type: ignore
        return ToolMessage(content=content, tool_call_id=tool_call_id or "", name=name, status=status)
    except Exception:
        # Fallback structural shape for tests / environments without langchain_core.
        return {
            "type": "tool",
            "content": content,
            "tool_call_id": tool_call_id,
            "name": name,
            "status": status,
        }


def _format_refuse(tool_name: str, decision: Dict[str, Any]) -> AristotleToolOutcome:
    codes = decision.get("reason_codes") or []
    gel = decision.get("gel_record") or {}
    return AristotleToolOutcome(
        kind="REFUSE",
        tool_name=tool_name,
        reason_codes=tuple(codes),
        message=f"aristotle: REFUSE on {tool_name} - {', '.join(codes) or 'no reason codes'} - record {gel.get('record_id', '(none)')}",
        gel_record_id=gel.get("record_id"),
    )


def _format_escalate(tool_name: str, decision: Dict[str, Any]) -> AristotleToolOutcome:
    codes = decision.get("reason_codes") or []
    gel = decision.get("gel_record") or {}
    return AristotleToolOutcome(
        kind="ESCALATE",
        tool_name=tool_name,
        reason_codes=tuple(codes),
        message=f"aristotle: ESCALATE on {tool_name} - {', '.join(codes) or 'no reason codes'} - record {gel.get('record_id', '(none)')}",
        gel_record_id=gel.get("record_id"),
    )


def _format_error(tool_name: str, exc: BaseException) -> AristotleToolOutcome:
    if isinstance(exc, AristotleApiError):
        msg = f"aristotle: gate error HTTP {exc.status} on {tool_name}: {exc}"
    else:
        msg = f"aristotle: gate unreachable on {tool_name}: {exc}"
    return AristotleToolOutcome(
        kind="GATE_UNREACHABLE",
        tool_name=tool_name,
        reason_codes=(msg,),
        message=msg,
    )


def _interrupt(payload: Dict[str, Any]) -> Any:
    """Pause the graph via langgraph.types.interrupt (lazy import)."""
    from langgraph.types import interrupt  # type: ignore

    return interrupt(payload)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

ActionTypeFor = Callable[[str], str]
BuildAction = Callable[..., Dict[str, Any]]
OnDecision = Callable[..., None]


def aristotle_tool_call_wrapper(
    *,
    client: AristotleClient,
    ward_id: str,
    subject: str,
    agent_name: Optional[str] = None,
    action_type_prefix: str = "tool",
    action_type_for: Optional[ActionTypeFor] = None,
    build_action: Optional[BuildAction] = None,
    passthrough_tools: Union[Set[str], Iterable[str], None] = None,
    on_refuse: str = "tool_message",
    on_escalate: str = "tool_message",
    on_error: str = "raise",
    on_decision: Optional[OnDecision] = None,
) -> Callable[[Any, Callable[[Any], Any]], Any]:
    """Build a sync ``wrap_tool_call`` middleware for LangGraph's ToolNode.

    Args:
        client: A sync :class:`AristotleClient` already pointed at the gate.
        ward_id: Ward the tool calls fall under.
        subject: Agent identifier (e.g. ``"agent:assistant-1"``).
        agent_name: optional agent display name for telemetry.
        action_type_prefix: Default ``"tool"``. Forms ``"<prefix>.<lower(name)>"``.
        action_type_for: Map a tool name to a fully-qualified action_type.
        build_action: Override the full CanonicalAction shape.
        passthrough_tools: Set of tool names to allow without calling the gate.
        on_refuse: ``"tool_message"`` (default; returns a ToolMessage with
            ``status="error"`` carrying the structured outcome) or
            ``"raise"`` (raises :class:`GateRefusal`).
        on_escalate: ``"tool_message"`` (default) or ``"interrupt"`` (calls
            ``langgraph.types.interrupt`` to pause the graph; resume payload
            with ``{"approve": True}`` to admit, anything else to refuse) or
            ``"raise"`` (raises :class:`GateEscalation`).
        on_error: ``"raise"`` (default — propagate the underlying exception)
            or ``"tool_message"`` (fail-closed with a structured ToolMessage).
        on_decision: callback fired after every gate call (incl. errors).

    Returns:
        A ``ToolCallWrapper`` suitable for ``ToolNode(..., wrap_tool_call=...)``.
    """
    if not client:
        raise ValueError("aristotle_tool_call_wrapper requires a client")
    if not ward_id:
        raise ValueError("aristotle_tool_call_wrapper requires a non-empty ward_id")
    if not subject:
        raise ValueError("aristotle_tool_call_wrapper requires a non-empty subject")

    passthrough = _coerce_passthrough(passthrough_tools)

    def _wrap(request: Any, execute: Callable[[Any], Any]) -> Any:
        tool_name, tool_args, tool_call_id = _read_tool_call(request)

        if tool_name in passthrough:
            return execute(request)

        action_type = (
            action_type_for(tool_name) if action_type_for else _default_action_type(tool_name, action_type_prefix)
        )
        action = (
            build_action(tool_name=tool_name, tool_input=tool_args, tool_call_id=tool_call_id, ward_id=ward_id, subject=subject, action_type=action_type, agent_name=agent_name)
            if build_action
            else _build_action(tool_name=tool_name, tool_input=tool_args, tool_call_id=tool_call_id, ward_id=ward_id, subject=subject, action_type=action_type)
        )

        t0 = time.monotonic()
        try:
            decision = client.evaluate(action)
        except Exception as exc:
            elapsed_ms = (time.monotonic() - t0) * 1000.0
            if on_decision is not None:
                on_decision(tool_name=tool_name, tool_input=tool_args, action=action, decision={"decision": "ERROR", "reason_codes": [str(exc)]}, elapsed_ms=elapsed_ms)
            if on_error == "raise":
                raise
            outcome = _format_error(tool_name, exc)
            return _make_tool_message(outcome.to_content(), tool_call_id, tool_name, "error")

        elapsed_ms = (time.monotonic() - t0) * 1000.0
        if on_decision is not None:
            on_decision(tool_name=tool_name, tool_input=tool_args, action=action, decision=decision, elapsed_ms=elapsed_ms)

        verdict = decision.get("decision")
        if verdict == "ALLOW":
            return execute(request)

        if verdict == "ESCALATE":
            outcome = _format_escalate(tool_name, decision)
            if on_escalate == "raise":
                raise GateEscalation(tool_name, outcome.reason_codes, outcome.gel_record_id, decision)
            if on_escalate == "interrupt":
                response = _interrupt({
                    "kind": "aristotle.escalate",
                    "tool_name": tool_name,
                    "reason_codes": list(outcome.reason_codes),
                    "gel_record_id": outcome.gel_record_id,
                })
                # Host resumes the graph with the response payload.
                if isinstance(response, dict) and response.get("approve"):
                    return execute(request)
                # Anything else: refuse with the original escalation outcome.
                refuse = _format_refuse(tool_name, decision)
                return _make_tool_message(refuse.to_content(), tool_call_id, tool_name, "error")
            return _make_tool_message(outcome.to_content(), tool_call_id, tool_name, "error")

        # REFUSE
        outcome = _format_refuse(tool_name, decision)
        if on_refuse == "raise":
            raise GateRefusal(tool_name, outcome.reason_codes, outcome.gel_record_id, decision)
        return _make_tool_message(outcome.to_content(), tool_call_id, tool_name, "error")

    return _wrap


def aristotle_atool_call_wrapper(
    *,
    client: AsyncAristotleClient,
    ward_id: str,
    subject: str,
    agent_name: Optional[str] = None,
    action_type_prefix: str = "tool",
    action_type_for: Optional[ActionTypeFor] = None,
    build_action: Optional[BuildAction] = None,
    passthrough_tools: Union[Set[str], Iterable[str], None] = None,
    on_refuse: str = "tool_message",
    on_escalate: str = "tool_message",
    on_error: str = "raise",
    on_decision: Optional[OnDecision] = None,
) -> Callable[[Any, Callable[[Any], Awaitable[Any]]], Awaitable[Any]]:
    """Async counterpart of :func:`aristotle_tool_call_wrapper`.

    Expects an :class:`AsyncAristotleClient`; the returned wrapper awaits both
    the gate call and the inner ``execute(request)``.
    """
    if not client:
        raise ValueError("aristotle_atool_call_wrapper requires a client")
    if not ward_id:
        raise ValueError("aristotle_atool_call_wrapper requires a non-empty ward_id")
    if not subject:
        raise ValueError("aristotle_atool_call_wrapper requires a non-empty subject")

    passthrough = _coerce_passthrough(passthrough_tools)

    async def _wrap(request: Any, execute: Callable[[Any], Awaitable[Any]]) -> Any:
        tool_name, tool_args, tool_call_id = _read_tool_call(request)

        if tool_name in passthrough:
            return await execute(request)

        action_type = (
            action_type_for(tool_name) if action_type_for else _default_action_type(tool_name, action_type_prefix)
        )
        action = (
            build_action(tool_name=tool_name, tool_input=tool_args, tool_call_id=tool_call_id, ward_id=ward_id, subject=subject, action_type=action_type, agent_name=agent_name)
            if build_action
            else _build_action(tool_name=tool_name, tool_input=tool_args, tool_call_id=tool_call_id, ward_id=ward_id, subject=subject, action_type=action_type)
        )

        t0 = time.monotonic()
        try:
            decision = await client.evaluate(action)
        except Exception as exc:
            elapsed_ms = (time.monotonic() - t0) * 1000.0
            if on_decision is not None:
                on_decision(tool_name=tool_name, tool_input=tool_args, action=action, decision={"decision": "ERROR", "reason_codes": [str(exc)]}, elapsed_ms=elapsed_ms)
            if on_error == "raise":
                raise
            outcome = _format_error(tool_name, exc)
            return _make_tool_message(outcome.to_content(), tool_call_id, tool_name, "error")

        elapsed_ms = (time.monotonic() - t0) * 1000.0
        if on_decision is not None:
            on_decision(tool_name=tool_name, tool_input=tool_args, action=action, decision=decision, elapsed_ms=elapsed_ms)

        verdict = decision.get("decision")
        if verdict == "ALLOW":
            return await execute(request)

        if verdict == "ESCALATE":
            outcome = _format_escalate(tool_name, decision)
            if on_escalate == "raise":
                raise GateEscalation(tool_name, outcome.reason_codes, outcome.gel_record_id, decision)
            if on_escalate == "interrupt":
                response = _interrupt({
                    "kind": "aristotle.escalate",
                    "tool_name": tool_name,
                    "reason_codes": list(outcome.reason_codes),
                    "gel_record_id": outcome.gel_record_id,
                })
                if isinstance(response, dict) and response.get("approve"):
                    return await execute(request)
                refuse = _format_refuse(tool_name, decision)
                return _make_tool_message(refuse.to_content(), tool_call_id, tool_name, "error")
            return _make_tool_message(outcome.to_content(), tool_call_id, tool_name, "error")

        # REFUSE
        outcome = _format_refuse(tool_name, decision)
        if on_refuse == "raise":
            raise GateRefusal(tool_name, outcome.reason_codes, outcome.gel_record_id, decision)
        return _make_tool_message(outcome.to_content(), tool_call_id, tool_name, "error")

    return _wrap
