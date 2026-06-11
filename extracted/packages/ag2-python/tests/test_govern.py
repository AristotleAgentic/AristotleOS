"""Tests for aristotle_ag2."""

from __future__ import annotations

import inspect
import json
from typing import Any, Callable, Dict, List, Tuple

import httpx
import pytest

from aristotle import AristotleClient
from aristotle_ag2 import GateRefusal, aristotle_governed, govern_ag2_function


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


def test_allow_and_telemetry_tag_is_ag2():
    def send(to: str) -> str: return f"sent to {to}"
    c, calls = client(lambda _: (200, ALLOW))
    g = govern_ag2_function(send, name="send", client=c, ward_id="w", subject="s")
    assert g("alice") == "sent to alice"
    body = json.loads(calls[0].read().decode())
    assert body["action"]["telemetry"]["agent_runtime"] == "ag2"


def test_refuse_returns_message():
    inner = []
    def t() -> str:
        inner.append(True)
        return "ok"
    c, _ = client(lambda _: (200, REFUSE))
    g = govern_ag2_function(t, name="t", client=c, ward_id="w", subject="s")
    assert "REFUSE" in g()
    assert inner == []


def test_refuse_raises_when_configured():
    def t() -> str: return "ok"
    c, _ = client(lambda _: (200, REFUSE))
    g = govern_ag2_function(t, name="t", client=c, ward_id="w", subject="s", on_refuse="raise")
    with pytest.raises(GateRefusal):
        g()


def test_decorator_factory():
    c, _ = client(lambda _: (200, ALLOW))
    govern = aristotle_governed(client=c, ward_id="w", subject="s")
    @govern("send")
    def send(to: str) -> str: return f"sent to {to}"
    assert send("alice") == "sent to alice"


def test_signature_preserved():
    def send(to: str, body: str) -> str: return "ok"
    c, _ = client(lambda _: (200, ALLOW))
    g = govern_ag2_function(send, name="send", client=c, ward_id="w", subject="s")
    assert inspect.signature(g) == inspect.signature(send)


def test_action_type_for_routes_vertical():
    seen = []
    def h(r):
        seen.append(r.read())
        return 200, ALLOW
    def transfer(vin: str) -> str: return "ok"
    c, _ = client(h)
    g = govern_ag2_function(transfer, name="transfer", client=c, ward_id="w", subject="s", action_type_for=lambda _: "title.transfer")
    g(vin="V")
    assert "title.transfer" in seen[0].decode()


def test_passthrough():
    seen = []
    def h(_):
        seen.append(True)
        return 500, {}
    def t() -> str: return "ok"
    c, _ = client(h)
    g = govern_ag2_function(t, name="t", client=c, ward_id="w", subject="s", passthrough=True)
    assert g() == "ok"
    assert seen == []


@pytest.mark.asyncio
async def test_async_wrapped():
    async def send(to: str) -> str: return f"sent to {to}"
    c, _ = client(lambda _: (200, ALLOW))
    g = govern_ag2_function(send, name="send", client=c, ward_id="w", subject="s")
    assert inspect.iscoroutinefunction(g)
    assert await g("alice") == "sent to alice"


def test_constructor_refuses_missing():
    c, _ = client(lambda _: (200, ALLOW))
    def t() -> str: return "ok"
    with pytest.raises(ValueError, match="name"):
        govern_ag2_function(t, name="", client=c, ward_id="w", subject="s")
    with pytest.raises(ValueError, match="ward_id"):
        govern_ag2_function(t, name="t", client=c, ward_id="", subject="s")
    with pytest.raises(ValueError, match="subject"):
        govern_ag2_function(t, name="t", client=c, ward_id="w", subject="")
