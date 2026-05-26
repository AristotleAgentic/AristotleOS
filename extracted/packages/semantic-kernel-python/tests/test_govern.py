"""Tests for aristotle_semantic_kernel."""

from __future__ import annotations

import inspect
from typing import Any, Callable, Dict, List, Tuple

import httpx
import pytest

from aristotle import AristotleClient
from aristotle_semantic_kernel import GateRefusal, aristotle_governed, govern_kernel_function


def transport(handler):
    recorded = []
    def _h(r):
        recorded.append(r)
        s, b = handler(r)
        return httpx.Response(s, json=b if not isinstance(b, str) else None, text=b if isinstance(b, str) else None)
    return httpx.MockTransport(_h), recorded


def client(handler):
    tr, calls = transport(handler)
    return AristotleClient(base_url="https://gate.internal", token="t", transport=tr), calls


ALLOW = {"decision": "ALLOW", "reason_codes": [], "canonical_action_hash": "h", "warrant": {"warrant_id": "wr"}, "gel_record": {"record_id": "rec", "record_hash": "rh"}}
REFUSE = {"decision": "REFUSE", "reason_codes": ["ACTION_DENIED"], "canonical_action_hash": "h", "gel_record": {"record_id": "rec", "record_hash": "rh"}}


def test_allow_invokes_inner_preserves_signature_and_metadata():
    def send(to: str) -> str: return f"sent to {to}"
    # Simulate @kernel_function attributes
    send.__kernel_function__ = True
    send.__kernel_function_name__ = "send"
    send.__kernel_function_description__ = "Send a thing"
    c, calls = client(lambda _: (200, ALLOW))
    g = govern_kernel_function(send, name="send", client=c, ward_id="w", subject="s")
    assert g("alice") == "sent to alice"
    assert inspect.signature(g) == inspect.signature(send)
    # Metadata copied through
    assert g.__kernel_function__ is True
    assert g.__kernel_function_name__ == "send"
    assert g.__kernel_function_description__ == "Send a thing"


def test_refuse_returns_message_inner_never_runs():
    inner = []
    def t() -> str:
        inner.append(True)
        return "ok"
    c, _ = client(lambda _: (200, REFUSE))
    g = govern_kernel_function(t, name="t", client=c, ward_id="w", subject="s")
    assert "REFUSE" in g()
    assert inner == []


def test_refuse_raises_when_configured():
    def t() -> str: return "ok"
    c, _ = client(lambda _: (200, REFUSE))
    g = govern_kernel_function(t, name="t", client=c, ward_id="w", subject="s", on_refuse="raise")
    with pytest.raises(GateRefusal):
        g()


def test_decorator_factory():
    c, _ = client(lambda _: (200, ALLOW))
    govern = aristotle_governed(client=c, ward_id="w", subject="s")
    @govern("send")
    def send(to: str) -> str: return f"sent to {to}"
    assert send("alice") == "sent to alice"


def test_action_type_for_routes_vertical():
    seen = []
    def h(r):
        seen.append(r.read())
        return 200, ALLOW
    def transfer_title(vin: str) -> str: return "ok"
    c, _ = client(h)
    g = govern_kernel_function(transfer_title, name="transfer_title", client=c, ward_id="w", subject="s", action_type_for=lambda _: "title.transfer")
    g(vin="V")
    assert "title.transfer" in seen[0].decode()


def test_passthrough():
    seen = []
    def h(_):
        seen.append(True)
        return 500, {}
    def t() -> str: return "ok"
    c, _ = client(h)
    g = govern_kernel_function(t, name="t", client=c, ward_id="w", subject="s", passthrough=True)
    assert g() == "ok"
    assert seen == []


def test_on_decision():
    seen = []
    def t() -> str: return "ok"
    c, _ = client(lambda _: (200, ALLOW))
    g = govern_kernel_function(t, name="t", client=c, ward_id="w", subject="s", on_decision=lambda **i: seen.append(i))
    g()
    assert seen[0]["tool_name"] == "t"


@pytest.mark.asyncio
async def test_async_function_wrapped():
    async def send(to: str) -> str: return f"sent to {to}"
    c, _ = client(lambda _: (200, ALLOW))
    g = govern_kernel_function(send, name="send", client=c, ward_id="w", subject="s")
    assert inspect.iscoroutinefunction(g)
    assert await g("alice") == "sent to alice"


def test_constructor_refuses_missing_required():
    c, _ = client(lambda _: (200, ALLOW))
    def t() -> str: return "ok"
    with pytest.raises(ValueError, match="name"):
        govern_kernel_function(t, name="", client=c, ward_id="w", subject="s")
    with pytest.raises(ValueError, match="ward_id"):
        govern_kernel_function(t, name="t", client=c, ward_id="", subject="s")
    with pytest.raises(ValueError, match="subject"):
        govern_kernel_function(t, name="t", client=c, ward_id="w", subject="")
