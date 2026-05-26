"""Tests for aristotle_autogen wrappers."""

from __future__ import annotations

import inspect
from typing import Any, Callable, Dict, List, Tuple

import httpx
import pytest

from aristotle import AristotleClient
from aristotle_autogen import GateRefusal, aristotle_governed, govern_autogen_function, govern_autogen_tool


def transport(handler: Callable[[httpx.Request], Tuple[int, Any]]) -> Tuple[httpx.MockTransport, List[httpx.Request]]:
    recorded: List[httpx.Request] = []
    def _h(r: httpx.Request) -> httpx.Response:
        recorded.append(r)
        s, b = handler(r)
        return httpx.Response(s, json=b if not isinstance(b, str) else None, text=b if isinstance(b, str) else None)
    return httpx.MockTransport(_h), recorded


def client(handler: Callable[[httpx.Request], Tuple[int, Any]]) -> Tuple[AristotleClient, List[httpx.Request]]:
    tr, calls = transport(handler)
    return AristotleClient(base_url="https://gate.internal", token="t", transport=tr), calls


ALLOW = {"decision": "ALLOW", "reason_codes": [], "canonical_action_hash": "h", "warrant": {"warrant_id": "wr"}, "gel_record": {"record_id": "rec", "record_hash": "rh"}}
REFUSE = {"decision": "REFUSE", "reason_codes": ["ACTION_DENIED"], "canonical_action_hash": "h", "gel_record": {"record_id": "rec", "record_hash": "rh"}}


def test_allow_invokes_inner_preserves_signature():
    def send_email(to: str, body: str) -> str:
        return f"sent to {to}"
    c, calls = client(lambda _: (200, ALLOW))
    g = govern_autogen_function(send_email, name="send_email", client=c, ward_id="w", subject="s")
    assert g("alice", "hi") == "sent to alice"
    assert inspect.signature(g) == inspect.signature(send_email)
    body = calls[0].read().decode()
    assert "tool.send_email" in body and "alice" in body


def test_refuse_returns_message_inner_never_runs():
    inner_calls: List[Any] = []
    def send_email(to: str) -> str:
        inner_calls.append(True)
        return "sent"
    c, _ = client(lambda _: (200, REFUSE))
    g = govern_autogen_function(send_email, name="send_email", client=c, ward_id="w", subject="s")
    assert "REFUSE" in g("alice")
    assert inner_calls == []


def test_refuse_raises_when_configured():
    def t() -> str: return "ok"
    c, _ = client(lambda _: (200, REFUSE))
    g = govern_autogen_function(t, name="t", client=c, ward_id="w", subject="s", on_refuse="raise")
    with pytest.raises(GateRefusal):
        g()


def test_aristotle_governed_decorator():
    c, _ = client(lambda _: (200, ALLOW))
    govern = aristotle_governed(client=c, ward_id="w", subject="s")
    @govern("send")
    def send(to: str) -> str:
        return f"sent to {to}"
    assert send("alice") == "sent to alice"


def test_action_type_for_routes_vertical():
    seen: List[bytes] = []
    def h(r: httpx.Request) -> Tuple[int, Any]:
        seen.append(r.read())
        return 200, ALLOW
    def transfer_title(vin: str) -> str: return "ok"
    c, _ = client(h)
    g = govern_autogen_function(transfer_title, name="transfer_title", client=c, ward_id="w", subject="s", action_type_for=lambda _n: "title.transfer")
    g(vin="V")
    assert "title.transfer" in seen[0].decode()


def test_passthrough_skips_gate():
    seen: List[bool] = []
    def h(_: httpx.Request) -> Tuple[int, Any]:
        seen.append(True)
        return 500, {}
    def t() -> str: return "ok"
    c, _ = client(h)
    g = govern_autogen_function(t, name="t", client=c, ward_id="w", subject="s", passthrough=True)
    assert g() == "ok"
    assert seen == []


def test_on_decision_telemetry_fires():
    seen: List[Dict[str, Any]] = []
    def t() -> str: return "ok"
    c, _ = client(lambda _: (200, ALLOW))
    g = govern_autogen_function(t, name="t", client=c, ward_id="w", subject="s", on_decision=lambda **i: seen.append(i))
    g()
    assert seen[0]["tool_name"] == "t" and seen[0]["decision"]["decision"] == "ALLOW"


@pytest.mark.asyncio
async def test_async_function_wrapped():
    async def send(to: str) -> str:
        return f"sent to {to}"
    c, _ = client(lambda _: (200, ALLOW))
    g = govern_autogen_function(send, name="send", client=c, ward_id="w", subject="s")
    assert inspect.iscoroutinefunction(g)
    assert await g("alice") == "sent to alice"


def test_govern_autogen_tool_wraps_function_tool_shape():
    class FakeFunctionTool:
        def __init__(self, func, description="", name=None):
            self._func = func
            self.description = description
            self.name = name or func.__name__
    def real_send(to: str) -> str:
        return f"sent to {to}"
    tool = FakeFunctionTool(real_send, description="Send email", name="send_email")
    c, _ = client(lambda _: (200, ALLOW))
    g = govern_autogen_tool(tool, client=c, ward_id="w", subject="s")
    assert g.name == "send_email"
    assert g._func is not real_send
    assert g._func("alice") == "sent to alice"


def test_constructor_refuses_missing_required():
    c, _ = client(lambda _: (200, ALLOW))
    def t() -> str: return "ok"
    with pytest.raises(ValueError, match="name"):
        govern_autogen_function(t, name="", client=c, ward_id="w", subject="s")
    with pytest.raises(ValueError, match="ward_id"):
        govern_autogen_function(t, name="t", client=c, ward_id="", subject="s")
    with pytest.raises(ValueError, match="subject"):
        govern_autogen_function(t, name="t", client=c, ward_id="w", subject="")
