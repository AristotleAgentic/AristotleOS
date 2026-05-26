"""Tests for govern_run + govern_arun against a mock httpx transport."""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Tuple

import httpx
import pytest

from aristotle import AristotleApiError, AristotleClient, AsyncAristotleClient
from aristotle_crewai import (
    GateEscalation,
    GateRefusal,
    govern_arun,
    govern_run,
)


def make_transport(
    handler: Callable[[httpx.Request], Tuple[int, Any]],
) -> Tuple[httpx.MockTransport, List[httpx.Request]]:
    recorded: List[httpx.Request] = []

    def _handle(request: httpx.Request) -> httpx.Response:
        recorded.append(request)
        status, body = handler(request)
        return httpx.Response(status, json=body if not isinstance(body, str) else None, text=body if isinstance(body, str) else None)

    return httpx.MockTransport(_handle), recorded


def make_async_transport(
    handler: Callable[[httpx.Request], Tuple[int, Any]],
) -> Tuple[httpx.MockTransport, List[httpx.Request]]:
    return make_transport(handler)


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


# ---------------------------------------------------------------------------
# Sync govern_run
# ---------------------------------------------------------------------------

def test_allow_invokes_inner_and_returns_its_output() -> None:
    inner_calls: List[Dict[str, Any]] = []

    def inner(to: str, body: str) -> str:
        inner_calls.append({"to": to, "body": body})
        return f"sent to {to}"

    client, calls = make_client(lambda _r: (200, ALLOW))
    wrapped = govern_run(inner, name="send_email", client=client, ward_id="ward-ops", subject="agent:1")

    result = wrapped(to="alice@example.com", body="hello")
    assert result == "sent to alice@example.com"
    assert inner_calls == [{"to": "alice@example.com", "body": "hello"}]
    assert len(calls) == 1
    body = calls[0].read().decode()
    assert "tool.send_email" in body
    assert "alice@example.com" in body
    assert "ward-ops" in body
    assert "agent:1" in body


def test_refuse_returns_message_by_default_and_inner_never_runs() -> None:
    inner_calls: List[Any] = []

    def inner(query: str) -> str:
        inner_calls.append(query)
        return "data"

    client, _ = make_client(lambda _r: (200, REFUSE))
    wrapped = govern_run(inner, name="delete_user", client=client, ward_id="w", subject="s")

    result = wrapped(query="DROP TABLE users")
    assert isinstance(result, str)
    assert "REFUSE" in result
    assert "ACTION_DENIED" in result
    assert inner_calls == []


def test_refuse_raises_when_on_refuse_is_raise() -> None:
    def inner() -> str:
        return "data"

    client, _ = make_client(lambda _r: (200, REFUSE))
    wrapped = govern_run(inner, name="t", client=client, ward_id="w", subject="s", on_refuse="raise")

    with pytest.raises(GateRefusal) as info:
        wrapped()
    err = info.value
    assert err.tool_name == "t"
    assert "ACTION_DENIED" in err.reason_codes
    assert err.gel_record_id == "rec-1"


def test_escalate_returns_message_by_default() -> None:
    def inner() -> str:
        return "ok"

    client, _ = make_client(lambda _r: (200, ESCALATE))
    wrapped = govern_run(inner, name="t", client=client, ward_id="w", subject="s")
    result = wrapped()
    assert isinstance(result, str)
    assert "ESCALATE" in result
    assert "DUAL_CONTROL_REQUIRED" in result


def test_escalate_raises_when_on_escalate_is_raise() -> None:
    def inner() -> str:
        return "ok"

    client, _ = make_client(lambda _r: (200, ESCALATE))
    wrapped = govern_run(inner, name="t", client=client, ward_id="w", subject="s", on_escalate="raise")

    with pytest.raises(GateEscalation) as info:
        wrapped()
    assert "DUAL_CONTROL_REQUIRED" in info.value.reason_codes


def test_gate_error_raises_by_default() -> None:
    def inner() -> str:
        return "ok"

    client, _ = make_client(lambda _r: (502, {"error": "bad gateway"}))
    wrapped = govern_run(inner, name="t", client=client, ward_id="w", subject="s")
    with pytest.raises(AristotleApiError):
        wrapped()


def test_gate_error_returns_message_when_on_error_is_return_message() -> None:
    inner_calls: List[Any] = []

    def inner() -> str:
        inner_calls.append(True)
        return "ok"

    client, _ = make_client(lambda _r: (502, {"error": "bad gateway"}))
    wrapped = govern_run(inner, name="t", client=client, ward_id="w", subject="s", on_error="return_message")
    result = wrapped()
    assert "gate error HTTP 502" in result
    assert inner_calls == [], "inner must not run when the gate refused / errored"


def test_passthrough_skips_the_gate_entirely() -> None:
    def inner(q: str) -> str:
        return f"r:{q}"

    handler_called: List[bool] = []

    def handler(_req: httpx.Request) -> Tuple[int, Any]:
        handler_called.append(True)
        return (500, {"error": "should not be reached"})

    client, _ = make_client(handler)
    wrapped = govern_run(inner, name="t", client=client, ward_id="w", subject="s", passthrough=True)
    assert wrapped(q="x") == "r:x"
    assert handler_called == []


def test_action_type_for_routes_into_a_vertical_namespace() -> None:
    seen_bodies: List[bytes] = []

    def inner(**_: Any) -> str:
        return "ok"

    def handler(req: httpx.Request) -> Tuple[int, Any]:
        seen_bodies.append(req.read())
        return (200, ALLOW)

    client, _ = make_client(handler)
    wrapped = govern_run(
        inner,
        name="transfer_title",
        client=client,
        ward_id="w",
        subject="s",
        action_type_for=lambda n: f"title.{n.replace('transfer_title', 'transfer')}",
    )
    wrapped(vin="V", to="Alice")
    body = seen_bodies[0].decode()
    assert "title.transfer" in body


def test_build_action_overrides_the_full_canonical_action_shape() -> None:
    seen_bodies: List[bytes] = []

    def inner(**_: Any) -> str:
        return "ok"

    def handler(req: httpx.Request) -> Tuple[int, Any]:
        seen_bodies.append(req.read())
        return (200, ALLOW)

    def build_action(tool_name: str, tool_input: Dict[str, Any], **_: Any) -> Dict[str, Any]:
        return {
            "action_id": "custom-id",
            "ward_id": "ward-custom",
            "subject": "agent:custom",
            "action_type": f"custom.{tool_name}",
            "params": {"wrapped": tool_input},
            "target": "custom-target",
        }

    client, _ = make_client(handler)
    wrapped = govern_run(inner, name="audit_log", client=client, ward_id="w", subject="s", build_action=build_action)
    wrapped(event="login")
    body = seen_bodies[0].decode()
    assert "custom.audit_log" in body
    assert "ward-custom" in body
    assert "custom-target" in body


def test_on_decision_telemetry_fires_with_elapsed_ms_and_verdict() -> None:
    seen: List[Dict[str, Any]] = []

    def inner() -> str:
        return "ok"

    def on_decision(**info: Any) -> None:
        seen.append(info)

    client, _ = make_client(lambda _r: (200, ALLOW))
    wrapped = govern_run(inner, name="t", client=client, ward_id="w", subject="s", on_decision=on_decision)
    wrapped()

    assert len(seen) == 1
    info = seen[0]
    assert info["tool_name"] == "t"
    assert info["decision"]["decision"] == "ALLOW"
    assert info["decision"]["warrant"]["warrant_id"] == "wr-1"
    assert isinstance(info["elapsed_ms"], float)


def test_govern_run_refuses_missing_required_options() -> None:
    client, _ = make_client(lambda _r: (200, ALLOW))
    with pytest.raises(ValueError, match="name"):
        govern_run(lambda: "x", name="", client=client, ward_id="w", subject="s")
    with pytest.raises(ValueError, match="ward_id"):
        govern_run(lambda: "x", name="t", client=client, ward_id="", subject="s")
    with pytest.raises(ValueError, match="subject"):
        govern_run(lambda: "x", name="t", client=client, ward_id="w", subject="")


def test_positional_single_arg_normalizes_to_input_key() -> None:
    seen_bodies: List[bytes] = []

    def inner(q: str) -> str:
        return f"r:{q}"

    def handler(req: httpx.Request) -> Tuple[int, Any]:
        seen_bodies.append(req.read())
        return (200, ALLOW)

    client, _ = make_client(handler)
    wrapped = govern_run(inner, name="t", client=client, ward_id="w", subject="s")
    wrapped("hello")
    body = seen_bodies[0].decode()
    assert '"input"' in body or '"input":' in body
    assert "hello" in body


# ---------------------------------------------------------------------------
# Async govern_arun
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_govern_arun_allow_awaits_inner_and_returns_its_output() -> None:
    inner_calls: List[Dict[str, Any]] = []

    async def inner(to: str) -> str:
        inner_calls.append({"to": to})
        return f"sent to {to}"

    transport, _ = make_async_transport(lambda _r: (200, ALLOW))
    client = AsyncAristotleClient(base_url="https://gate.internal", token="t", transport=transport)
    try:
        wrapped = govern_arun(inner, name="send_email", client=client, ward_id="w", subject="s")
        out = await wrapped(to="alice")
        assert out == "sent to alice"
        assert inner_calls == [{"to": "alice"}]
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_govern_arun_refuse_returns_message_by_default() -> None:
    async def inner() -> str:
        return "ok"

    transport, _ = make_async_transport(lambda _r: (200, REFUSE))
    client = AsyncAristotleClient(base_url="https://gate.internal", token="t", transport=transport)
    try:
        wrapped = govern_arun(inner, name="t", client=client, ward_id="w", subject="s")
        out = await wrapped()
        assert "REFUSE" in out
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_govern_arun_refuse_raises_when_configured() -> None:
    async def inner() -> str:
        return "ok"

    transport, _ = make_async_transport(lambda _r: (200, REFUSE))
    client = AsyncAristotleClient(base_url="https://gate.internal", token="t", transport=transport)
    try:
        wrapped = govern_arun(inner, name="t", client=client, ward_id="w", subject="s", on_refuse="raise")
        with pytest.raises(GateRefusal):
            await wrapped()
    finally:
        await client.aclose()
