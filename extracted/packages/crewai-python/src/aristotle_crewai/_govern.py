"""Core governance wrappers shared by both integration shapes."""

from __future__ import annotations

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

from aristotle import AristotleApiError, AristotleClient, AsyncAristotleClient


# ---------------------------------------------------------------------------
# Errors raised by the wrappers (in addition to anything the gate raises).
# ---------------------------------------------------------------------------

class AristotleCrewaiError(Exception):
    """Base class for Aristotle/CrewAI integration errors."""


class GateRefusal(AristotleCrewaiError):
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


class GateEscalation(AristotleCrewaiError):
    """Raised when the gate ESCALATES a tool call and ``on_escalate='raise'``."""

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
# Internal helpers
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _action_id(tool_name: str) -> str:
    return f"crewai-{tool_name}-{int(time.time() * 1000):x}"


def _default_action_type(tool_name: str, prefix: str) -> str:
    return f"{prefix}.{tool_name.lower()}"


def _build_action(
    *,
    tool_name: str,
    tool_input: Dict[str, Any],
    ward_id: str,
    subject: str,
    action_type: str,
    agent_name: Optional[str],
) -> Dict[str, Any]:
    return {
        "action_id": _action_id(tool_name),
        "ward_id": ward_id,
        "subject": subject,
        "action_type": action_type,
        "params": tool_input,
        "requested_at": _now_iso(),
        "telemetry": {
            "agent_runtime": "crewai",
            "agent_name": agent_name,
        },
    }


def _normalize_args(args: tuple, kwargs: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize CrewAI ``_run(*args, **kwargs)`` into a dict for the gate.

    CrewAI tools defined with an ``args_schema`` will be called with keyword
    arguments by the agent runtime; positional calls (e.g. tests) are
    normalized into ``{"_args": [...]}`` so the gate still gets a record.
    """
    if not args:
        return dict(kwargs)
    if kwargs:
        return {**kwargs, "_args": list(args)}
    if len(args) == 1:
        return {"input": args[0]}
    return {"_args": list(args)}


def _format_refuse_message(tool_name: str, decision: Dict[str, Any]) -> str:
    codes = decision.get("reason_codes") or []
    gel = decision.get("gel_record") or {}
    return (
        f"aristotle: REFUSE on {tool_name} - {', '.join(codes) or 'no reason codes'}"
        f" - record {gel.get('record_id', '(none)')}"
    )


def _format_escalate_message(tool_name: str, decision: Dict[str, Any]) -> str:
    codes = decision.get("reason_codes") or []
    gel = decision.get("gel_record") or {}
    return (
        f"aristotle: ESCALATE on {tool_name} - {', '.join(codes) or 'no reason codes'}"
        f" - record {gel.get('record_id', '(none)')}"
    )


def _format_error_message(tool_name: str, exc: BaseException) -> str:
    if isinstance(exc, AristotleApiError):
        return f"aristotle: gate error HTTP {exc.status} on {tool_name}: {exc}"
    return f"aristotle: gate unreachable on {tool_name}: {exc}"


def _coerce_passthrough(tools: Union[Set[str], Iterable[str], None]) -> Set[str]:
    if tools is None:
        return set()
    if isinstance(tools, set):
        return tools
    return set(tools)


# ---------------------------------------------------------------------------
# govern_run — the primary low-level integration
# ---------------------------------------------------------------------------

OnError = str  # "raise" | "return_message"
OnRefuse = str  # "raise" | "return_message"
OnEscalate = str  # "raise" | "return_message"

ActionTypeFor = Callable[[str], str]
BuildAction = Callable[..., Dict[str, Any]]
OnDecision = Callable[..., None]


def govern_run(
    inner_run: Callable[..., Any],
    *,
    name: str,
    client: AristotleClient,
    ward_id: str,
    subject: str,
    agent_name: Optional[str] = None,
    action_type_prefix: str = "tool",
    action_type_for: Optional[ActionTypeFor] = None,
    build_action: Optional[BuildAction] = None,
    passthrough: bool = False,
    on_refuse: OnRefuse = "return_message",
    on_escalate: OnEscalate = "return_message",
    on_error: OnError = "raise",
    on_decision: Optional[OnDecision] = None,
) -> Callable[..., Any]:
    """Wrap a CrewAI ``_run`` callable with Aristotle governance.

    Returns a new callable with the SAME signature as ``inner_run``. When the
    agent invokes the tool, the wrapper:

    1. builds a CanonicalAction from the tool name + kwargs,
    2. calls :meth:`AristotleClient.evaluate` synchronously,
    3. on ``ALLOW``: invokes ``inner_run(*args, **kwargs)`` and returns
       whatever it returns,
    4. on ``REFUSE``: returns a refusal message (default) or raises
       :class:`GateRefusal`,
    5. on ``ESCALATE``: returns an escalation message (default) or raises
       :class:`GateEscalation`,
    6. on gate error: raises the underlying exception (default), or
       returns an error message if ``on_error="return_message"``.

    Args:
        inner_run: the original ``_run`` callable to wrap.
        name: the CrewAI tool's ``name`` (used for action_type + telemetry).
        client: an :class:`AristotleClient` already pointed at the gate.
        ward_id: the Ward the tool call falls under.
        subject: the agent identifier (e.g. ``"agent:assistant-1"``).
        agent_name: optional agent display name for telemetry.
        action_type_prefix: default ``"tool"``. Forms ``"<prefix>.<lower(name)>"``.
        action_type_for: override the action_type for specific tools (vertical routing).
        build_action: override the full CanonicalAction shape.
        passthrough: if True, do NOT call the gate; just forward. Useful for
            read-only tools registered with a shared wrapper.
        on_refuse: ``"return_message"`` (default) or ``"raise"``.
        on_escalate: ``"return_message"`` (default) or ``"raise"``.
        on_error: ``"raise"`` (default — propagate the underlying exception)
            or ``"return_message"`` (fail-closed with a message the agent sees).
        on_decision: callback fired after every gate call. Receives a dict
            with ``tool_name``, ``tool_input``, ``action``, ``decision``,
            ``elapsed_ms``.
    """
    if not name:
        raise ValueError("govern_run requires a non-empty 'name'")
    if not ward_id:
        raise ValueError("govern_run requires a non-empty 'ward_id'")
    if not subject:
        raise ValueError("govern_run requires a non-empty 'subject'")

    def _wrapped(*args: Any, **kwargs: Any) -> Any:
        if passthrough:
            return inner_run(*args, **kwargs)

        tool_input = _normalize_args(args, kwargs)
        action_type = action_type_for(name) if action_type_for else _default_action_type(name, action_type_prefix)
        action = (
            build_action(tool_name=name, tool_input=tool_input, ward_id=ward_id, subject=subject, action_type=action_type, agent_name=agent_name)
            if build_action
            else _build_action(tool_name=name, tool_input=tool_input, ward_id=ward_id, subject=subject, action_type=action_type, agent_name=agent_name)
        )

        t0 = time.monotonic()
        try:
            decision = client.evaluate(action)
        except Exception as exc:
            elapsed_ms = (time.monotonic() - t0) * 1000.0
            if on_decision is not None:
                on_decision(tool_name=name, tool_input=tool_input, action=action, decision={"decision": "ERROR", "reason_codes": [str(exc)]}, elapsed_ms=elapsed_ms)
            if on_error == "raise":
                raise
            return _format_error_message(name, exc)

        elapsed_ms = (time.monotonic() - t0) * 1000.0
        if on_decision is not None:
            on_decision(tool_name=name, tool_input=tool_input, action=action, decision=decision, elapsed_ms=elapsed_ms)

        verdict = decision.get("decision")
        if verdict == "ALLOW":
            return inner_run(*args, **kwargs)

        if verdict == "ESCALATE":
            if on_escalate == "raise":
                raise GateEscalation(name, decision.get("reason_codes") or [], (decision.get("gel_record") or {}).get("record_id"), decision)
            return _format_escalate_message(name, decision)

        # REFUSE
        if on_refuse == "raise":
            raise GateRefusal(name, decision.get("reason_codes") or [], (decision.get("gel_record") or {}).get("record_id"), decision)
        return _format_refuse_message(name, decision)

    _wrapped.__name__ = f"governed_{getattr(inner_run, '__name__', '_run')}"
    _wrapped.__qualname__ = _wrapped.__name__
    _wrapped.__doc__ = (
        f"Aristotle-governed wrapper around {getattr(inner_run, '__qualname__', '_run')}. "
        f"Every call is admitted only on ALLOW + warrant."
    )
    return _wrapped


# ---------------------------------------------------------------------------
# govern_arun — async variant for ``_arun``
# ---------------------------------------------------------------------------

def govern_arun(
    inner_arun: Callable[..., Awaitable[Any]],
    *,
    name: str,
    client: AsyncAristotleClient,
    ward_id: str,
    subject: str,
    agent_name: Optional[str] = None,
    action_type_prefix: str = "tool",
    action_type_for: Optional[ActionTypeFor] = None,
    build_action: Optional[BuildAction] = None,
    passthrough: bool = False,
    on_refuse: OnRefuse = "return_message",
    on_escalate: OnEscalate = "return_message",
    on_error: OnError = "raise",
    on_decision: Optional[OnDecision] = None,
) -> Callable[..., Awaitable[Any]]:
    """Async counterpart of :func:`govern_run` for CrewAI's ``_arun``.

    Identical contract; uses :class:`AsyncAristotleClient` and awaits both the
    gate call and the wrapped tool.
    """
    if not name:
        raise ValueError("govern_arun requires a non-empty 'name'")
    if not ward_id:
        raise ValueError("govern_arun requires a non-empty 'ward_id'")
    if not subject:
        raise ValueError("govern_arun requires a non-empty 'subject'")

    async def _wrapped(*args: Any, **kwargs: Any) -> Any:
        if passthrough:
            return await inner_arun(*args, **kwargs)

        tool_input = _normalize_args(args, kwargs)
        action_type = action_type_for(name) if action_type_for else _default_action_type(name, action_type_prefix)
        action = (
            build_action(tool_name=name, tool_input=tool_input, ward_id=ward_id, subject=subject, action_type=action_type, agent_name=agent_name)
            if build_action
            else _build_action(tool_name=name, tool_input=tool_input, ward_id=ward_id, subject=subject, action_type=action_type, agent_name=agent_name)
        )

        t0 = time.monotonic()
        try:
            decision = await client.evaluate(action)
        except Exception as exc:
            elapsed_ms = (time.monotonic() - t0) * 1000.0
            if on_decision is not None:
                on_decision(tool_name=name, tool_input=tool_input, action=action, decision={"decision": "ERROR", "reason_codes": [str(exc)]}, elapsed_ms=elapsed_ms)
            if on_error == "raise":
                raise
            return _format_error_message(name, exc)

        elapsed_ms = (time.monotonic() - t0) * 1000.0
        if on_decision is not None:
            on_decision(tool_name=name, tool_input=tool_input, action=action, decision=decision, elapsed_ms=elapsed_ms)

        verdict = decision.get("decision")
        if verdict == "ALLOW":
            return await inner_arun(*args, **kwargs)

        if verdict == "ESCALATE":
            if on_escalate == "raise":
                raise GateEscalation(name, decision.get("reason_codes") or [], (decision.get("gel_record") or {}).get("record_id"), decision)
            return _format_escalate_message(name, decision)

        # REFUSE
        if on_refuse == "raise":
            raise GateRefusal(name, decision.get("reason_codes") or [], (decision.get("gel_record") or {}).get("record_id"), decision)
        return _format_refuse_message(name, decision)

    _wrapped.__name__ = f"governed_{getattr(inner_arun, '__name__', '_arun')}"
    _wrapped.__qualname__ = _wrapped.__name__
    return _wrapped


# ---------------------------------------------------------------------------
# govern_crewai_tool — wrap an existing CrewAI BaseTool instance
# ---------------------------------------------------------------------------

def govern_crewai_tool(
    tool: Any,
    *,
    client: AristotleClient,
    ward_id: str,
    subject: str,
    agent_name: Optional[str] = None,
    action_type_prefix: str = "tool",
    action_type_for: Optional[ActionTypeFor] = None,
    build_action: Optional[BuildAction] = None,
    passthrough_tools: Union[Set[str], Iterable[str], None] = None,
    on_refuse: OnRefuse = "return_message",
    on_escalate: OnEscalate = "return_message",
    on_error: OnError = "raise",
    on_decision: Optional[OnDecision] = None,
) -> Any:
    """Wrap a CrewAI :class:`BaseTool` instance and return a governed twin.

    The returned tool is an instance of a DYNAMIC subclass of ``type(tool)``
    that overrides ``_run`` (and ``_arun`` if the original defines one) to
    route every invocation through the Aristotle Commit Gate. Name,
    description, and ``args_schema`` are preserved so the agent sees no
    change in its tool catalog.

    ``passthrough_tools`` is checked by tool name and bypasses the gate.
    """
    tool_name = getattr(tool, "name", None) or type(tool).__name__
    passthrough = tool_name in _coerce_passthrough(passthrough_tools)

    base_cls = type(tool)

    governed_run = govern_run(
        tool._run,
        name=tool_name,
        client=client,
        ward_id=ward_id,
        subject=subject,
        agent_name=agent_name,
        action_type_prefix=action_type_prefix,
        action_type_for=action_type_for,
        build_action=build_action,
        passthrough=passthrough,
        on_refuse=on_refuse,
        on_escalate=on_escalate,
        on_error=on_error,
        on_decision=on_decision,
    )

    # Build the override dict; only override _arun if the original defines one.
    overrides: Dict[str, Any] = {
        "_run": lambda self, *args, **kwargs: governed_run(*args, **kwargs),
    }
    # Note: govern_arun for a tool instance requires an AsyncAristotleClient,
    # not the sync client passed in; we don't auto-wrap _arun here. Use
    # govern_arun directly if you have async tools.

    governed_cls = type(
        f"AristotleGoverned_{base_cls.__name__}",
        (base_cls,),
        overrides,
    )

    # Construct a new instance copying the original's fields. Pydantic v2
    # makes this straightforward via model_dump() / model_copy(), but we
    # support tools that don't expose those by falling back to name+description.
    if hasattr(tool, "model_dump") and hasattr(governed_cls, "model_validate"):
        try:
            data = tool.model_dump(exclude_unset=False)
        except TypeError:
            data = tool.model_dump()
        # args_schema is a class (not serializable to dict); re-attach it.
        if getattr(tool, "args_schema", None) is not None:
            data["args_schema"] = tool.args_schema
        try:
            return governed_cls.model_validate(data)
        except Exception:
            pass

    kwargs: Dict[str, Any] = {
        "name": getattr(tool, "name", base_cls.__name__),
        "description": getattr(tool, "description", ""),
    }
    if getattr(tool, "args_schema", None) is not None:
        kwargs["args_schema"] = tool.args_schema
    return governed_cls(**kwargs)
