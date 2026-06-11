"""Tests for aristotle_tool_call_wrapper + aristotle_atool_call_wrapper.

Uses a Pydantic-free structural fake of ``ToolCallRequest`` so tests run
WITHOUT installing langgraph or langchain-core. ``_make_tool_message`` falls
back to a dict shape when those packages aren't available, which the tests
assert against directly.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Dict, List, Tuple

import httpx
import pytest

from aristotle import AristotleClient, AsyncAristotleClient
from aristotle_langgraph import (
    GateEscalation,
    GateRefusal,
    aristotle_atool_call_wrapper,
    aristotle_tool_call_wrapper,
)


# ---------------------------------------------------------------------------
# Structural fakes for ToolCallRequest / ToolCall
# ---------------------------------------------------------------------------

@dataclass
class FakeToolCall:
    name: str
    args: Dict[str, Any]
    id: str
    type: str = "tool_call"


@dataclass
class FakeToolCallRequest:
    tool_call: Dict[str, Any]   # use a dict shape (matches langchain's TypedDict)
    tool: Any = None
    state: Any = None
    runtime: Any = None


def make_request(name: str, args: Dict[str, Any], call_id: str = "call-1") -> FakeToolCallRequest:
    return FakeToolCallRequest(tool_call={"name": name, "args": args, "id": call_id, "type": "tool_call"})


# ---------------------------------------------------------------------------
# httpx mock plumbing
# ---------------------------------------------------------------------------

def make_transport(handler: Callable[[httpx.Request], Tuple[int, Any]]) -> Tuple[httpx.MockTransport, List[httpx.Request]]:
    recorded: List[httpx.Request] = []

    def _handle(req: httpx.Request) -> httpx.Response:
        recorded.append(req)
        status, body = handler(req)
        return httpx.Response(status, json=body if not isinstance(body, str) else None, text=body if isinstance(body, str) else None)

    return httpx.MockTransport(_handle), recorded


def make_client(handler: Callable[[httpx.Request], Tuple[int, Any]]) -> Tuple[AristotleClient, List[httpx.Request]]:
    transport, calls = make_transport(handler)
    return AristotleClient(base_url="https://gate.internal", token="t", transport=transport), calls


ALLOW = {
    "decision": "ALLOW",
    "reason_codes": [],
    "canonical_action_hash": "h",
    "warrant": {"warrant_id": "wr-1"},
    "gel_record": {"record_id": "rec-1", "record_hash": "rh"},
}
REFUSE = {
    "decision": "REFUSE",
    "reason_codes": ["ACTION_DENIED", "PHYSICAL_INVARIANT_FAILED"],
    "canonical_action_hash": "h",
    "gel_record": {"record_id": "rec-1", "record_hash": "rh"},
}
ESCALATE = {
    "decision": "ESCALATE",
    "reason_codes": ["DUAL_CONTROL_REQUIRED"],
    "canonical_action_hash": "h",
    "gel_record": {"record_id": "rec-1", "record_hash": "rh"},
}


def _tm_dict(tm: Any) -> Dict[str, Any]:
    """Normalize a ToolMessage return to dict form for assertions."""
    if isinstance(tm, dict):
        return tm
    # If langchain is installed and a real ToolMessage came back, extract fields.
    return {
        "type": "tool",
        "content": getattr(tm, "content", None),
        "tool_call_id": getattr(tm, "tool_call_id", None),
        "name": getattr(tm, "name", None),
        "status": getattr(tm, "status", None),
    }


# ---------------------------------------------------------------------------
# Sync tests
# ---------------------------------------------------------------------------

def test_allow_invokes_inner_execute_and_returns_its_output() -> None:
    inner_calls: List[Any] = []

    def execute(req: Any) -> str:
        inner_calls.append(req)
        return "tool ran"

    client, calls = make_client(lambda _r: (200, ALLOW))
    wrap = aristotle_tool_call_wrapper(client=client, ward_id="ward-ops", subject="agent:1")

    out = wrap(make_request("send_email", {"to": "alice@example.com", "body": "hi"}), execute)
    assert out == "tool ran"
    assert len(inner_calls) == 1
    assert len(calls) == 1

    body = json.loads(calls[0].read().decode())
    assert body["action"]["action_type"] == "tool.send_email"
    assert body["action"]["ward_id"] == "ward-ops"
    assert body["action"]["subject"] == "agent:1"
    assert body["action"]["params"] == {"to": "alice@example.com", "body": "hi"}
    assert body["action"]["action_id"] == "call-1"


def test_refuse_returns_tool_message_by_default_inner_never_runs() -> None:
    inner_calls: List[Any] = []

    def execute(_req: Any) -> str:
        inner_calls.append(True)
        return "should not run"

    client, _ = make_client(lambda _r: (200, REFUSE))
    wrap = aristotle_tool_call_wrapper(client=client, ward_id="w", subject="s")
    tm = wrap(make_request("delete_user", {"id": 42}), execute)
    d = _tm_dict(tm)

    assert d["status"] == "error"
    assert d["tool_call_id"] == "call-1"
    assert d["name"] == "delete_user"
    content = json.loads(d["content"])
    assert content["__aristotle"] == "REFUSE"
    assert content["reason_codes"] == ["ACTION_DENIED", "PHYSICAL_INVARIANT_FAILED"]
    assert content["gel_record_id"] == "rec-1"
    assert inner_calls == []


def test_refuse_raises_GateRefusal_when_on_refuse_is_raise() -> None:
    def execute(_req: Any) -> str:
        return "ok"

    client, _ = make_client(lambda _r: (200, REFUSE))
    wrap = aristotle_tool_call_wrapper(client=client, ward_id="w", subject="s", on_refuse="raise")
    with pytest.raises(GateRefusal) as info:
        wrap(make_request("t", {}), execute)
    assert info.value.tool_name == "t"
    assert "ACTION_DENIED" in info.value.reason_codes


def test_escalate_returns_tool_message_by_default() -> None:
    def execute(_req: Any) -> str:
        return "ok"

    client, _ = make_client(lambda _r: (200, ESCALATE))
    wrap = aristotle_tool_call_wrapper(client=client, ward_id="w", subject="s")
    tm = wrap(make_request("send_email", {"to": "alice"}), execute)
    d = _tm_dict(tm)
    content = json.loads(d["content"])
    assert content["__aristotle"] == "ESCALATE"
    assert content["reason_codes"] == ["DUAL_CONTROL_REQUIRED"]


def test_escalate_raises_GateEscalation_when_on_escalate_is_raise() -> None:
    def execute(_req: Any) -> str:
        return "ok"

    client, _ = make_client(lambda _r: (200, ESCALATE))
    wrap = aristotle_tool_call_wrapper(client=client, ward_id="w", subject="s", on_escalate="raise")
    with pytest.raises(GateEscalation):
        wrap(make_request("t", {}), execute)


def test_gate_unreachable_raises_by_default() -> None:
    def execute(_req: Any) -> str:
        return "ok"

    transport = httpx.MockTransport(lambda _r: (_ for _ in ()).throw(httpx.ConnectError("network down")))
    client = AristotleClient(base_url="https://gate.internal", token="t", transport=transport)
    wrap = aristotle_tool_call_wrapper(client=client, ward_id="w", subject="s")
    with pytest.raises(httpx.ConnectError):
        wrap(make_request("t", {}), execute)


def test_gate_unreachable_returns_tool_message_when_configured() -> None:
    def execute(_req: Any) -> str:
        return "ok"

    transport = httpx.MockTransport(lambda _r: (_ for _ in ()).throw(httpx.ConnectError("network down")))
    client = AristotleClient(base_url="https://gate.internal", token="t", transport=transport)
    wrap = aristotle_tool_call_wrapper(client=client, ward_id="w", subject="s", on_error="tool_message")
    tm = wrap(make_request("t", {}), execute)
    d = _tm_dict(tm)
    assert d["status"] == "error"
    content = json.loads(d["content"])
    assert content["__aristotle"] == "GATE_UNREACHABLE"
    assert "network down" in content["message"]


def test_passthrough_tools_skips_the_gate_and_calls_inner_directly() -> None:
    inner_calls: List[Any] = []

    def execute(req: Any) -> str:
        inner_calls.append(req)
        return "passthrough ran"

    handler_called: List[bool] = []
    def handler(_req: httpx.Request) -> Tuple[int, Any]:
        handler_called.append(True)
        return 500, {"error": "should not be reached"}

    client, _ = make_client(handler)
    wrap = aristotle_tool_call_wrapper(
        client=client, ward_id="w", subject="s",
        passthrough_tools={"read_kb", "search_docs"},
    )
    out = wrap(make_request("read_kb", {"q": "x"}), execute)
    assert out == "passthrough ran"
    assert handler_called == []
    assert len(inner_calls) == 1


def test_action_type_for_routes_specific_tools_into_vertical() -> None:
    def execute(_req: Any) -> str:
        return "ok"

    seen_bodies: List[bytes] = []

    def handler(req: httpx.Request) -> Tuple[int, Any]:
        seen_bodies.append(req.read())
        return 200, ALLOW

    client, _ = make_client(handler)
    wrap = aristotle_tool_call_wrapper(
        client=client, ward_id="w", subject="s",
        action_type_for=lambda n: "title.transfer" if n == "transfer_title" else f"tool.{n.lower()}",
    )
    wrap(make_request("transfer_title", {"vin": "V"}), execute)
    body = json.loads(seen_bodies[0].decode())
    assert body["action"]["action_type"] == "title.transfer"


def test_build_action_takes_full_control() -> None:
    def execute(_req: Any) -> str:
        return "ok"

    seen_bodies: List[bytes] = []

    def handler(req: httpx.Request) -> Tuple[int, Any]:
        seen_bodies.append(req.read())
        return 200, ALLOW

    def build(tool_name: str, tool_input: Dict[str, Any], tool_call_id: Any, **_: Any) -> Dict[str, Any]:
        return {
            "action_id": tool_call_id or "fallback",
            "ward_id": "ward-custom",
            "subject": "agent:custom",
            "action_type": f"custom.{tool_name}",
            "params": {"wrapped": tool_input},
            "target": "custom-target",
        }

    client, _ = make_client(handler)
    wrap = aristotle_tool_call_wrapper(client=client, ward_id="w", subject="s", build_action=build)
    wrap(make_request("audit_log", {"event": "login"}), execute)
    body = json.loads(seen_bodies[0].decode())
    assert body["action"]["action_type"] == "custom.audit_log"
    assert body["action"]["ward_id"] == "ward-custom"
    assert body["action"]["target"] == "custom-target"


def test_on_decision_telemetry_fires_with_verdict_and_elapsed_ms() -> None:
    seen: List[Dict[str, Any]] = []

    def execute(_req: Any) -> str:
        return "ok"

    def on_decision(**info: Any) -> None:
        seen.append(info)

    client, _ = make_client(lambda _r: (200, ALLOW))
    wrap = aristotle_tool_call_wrapper(client=client, ward_id="w", subject="s", on_decision=on_decision)
    wrap(make_request("search", {"q": "x"}), execute)

    assert len(seen) == 1
    info = seen[0]
    assert info["tool_name"] == "search"
    assert info["decision"]["decision"] == "ALLOW"
    assert isinstance(info["elapsed_ms"], float)


def test_wrapper_refuses_missing_required_options() -> None:
    client, _ = make_client(lambda _r: (200, ALLOW))
    with pytest.raises(ValueError, match="ward_id"):
        aristotle_tool_call_wrapper(client=client, ward_id="", subject="s")
    with pytest.raises(ValueError, match="subject"):
        aristotle_tool_call_wrapper(client=client, ward_id="w", subject="")


# ---------------------------------------------------------------------------
# Async tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_async_allow_awaits_inner_execute() -> None:
    inner_calls: List[Any] = []

    async def execute(req: Any) -> str:
        inner_calls.append(req)
        return "async ran"

    transport, _ = make_transport(lambda _r: (200, ALLOW))
    client = AsyncAristotleClient(base_url="https://gate.internal", token="t", transport=transport)
    try:
        wrap = aristotle_atool_call_wrapper(client=client, ward_id="w", subject="s")
        out = await wrap(make_request("t", {"x": 1}), execute)
        assert out == "async ran"
        assert len(inner_calls) == 1
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_async_refuse_returns_tool_message_by_default() -> None:
    async def execute(_req: Any) -> str:
        return "ok"

    transport, _ = make_transport(lambda _r: (200, REFUSE))
    client = AsyncAristotleClient(base_url="https://gate.internal", token="t", transport=transport)
    try:
        wrap = aristotle_atool_call_wrapper(client=client, ward_id="w", subject="s")
        tm = await wrap(make_request("t", {}), execute)
        d = _tm_dict(tm)
        content = json.loads(d["content"])
        assert content["__aristotle"] == "REFUSE"
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_async_refuse_raises_when_configured() -> None:
    async def execute(_req: Any) -> str:
        return "ok"

    transport, _ = make_transport(lambda _r: (200, REFUSE))
    client = AsyncAristotleClient(base_url="https://gate.internal", token="t", transport=transport)
    try:
        wrap = aristotle_atool_call_wrapper(client=client, ward_id="w", subject="s", on_refuse="raise")
        with pytest.raises(GateRefusal):
            await wrap(make_request("t", {}), execute)
    finally:
        await client.aclose()
