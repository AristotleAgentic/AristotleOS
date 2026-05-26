"""Tests for govern_tool_function (sync + async) + aristotle_governed decorator.

Uses a structural Pydantic fake of pydantic_ai.tools.Tool so tests run without
pydantic-ai installed.
"""

from __future__ import annotations

import inspect
from typing import Any, Callable, Dict, List, Tuple

import httpx
import pytest

from aristotle import AristotleClient
from aristotle_pydantic_ai import (
    GateRefusal,
    aristotle_governed,
    govern_pydantic_ai_tool,
    govern_tool_function,
)


def make_transport(handler: Callable[[httpx.Request], Tuple[int, Any]]) -> Tuple[httpx.MockTransport, List[httpx.Request]]:
    recorded: List[httpx.Request] = []

    def _h(req: httpx.Request) -> httpx.Response:
        recorded.append(req)
        status, body = handler(req)
        return httpx.Response(status, json=body if not isinstance(body, str) else None, text=body if isinstance(body, str) else None)

    return httpx.MockTransport(_h), recorded


def make_client(handler: Callable[[httpx.Request], Tuple[int, Any]]) -> Tuple[AristotleClient, List[httpx.Request]]:
    transport, calls = make_transport(handler)
    return AristotleClient(base_url="https://gate.internal", token="t", transport=transport), calls


ALLOW = {"decision": "ALLOW", "reason_codes": [], "canonical_action_hash": "h", "warrant": {"warrant_id": "wr-1"}, "gel_record": {"record_id": "rec-1", "record_hash": "rh"}}
REFUSE = {"decision": "REFUSE", "reason_codes": ["ACTION_DENIED"], "canonical_action_hash": "h", "gel_record": {"record_id": "rec-1", "record_hash": "rh"}}


def test_allow_invokes_inner_and_preserves_signature() -> None:
    def send_email(to: str, body: str) -> str:
        return f"sent to {to}"

    client, calls = make_client(lambda _r: (200, ALLOW))
    governed = govern_tool_function(send_email, name="send_email", client=client, ward_id="w", subject="s")
    assert governed("alice@example.com", "hi") == "sent to alice@example.com"
    assert inspect.signature(governed) == inspect.signature(send_email)
    assert governed.__name__ == "send_email"
    body = calls[0].read().decode()
    assert "tool.send_email" in body
    assert "alice@example.com" in body


def test_refuse_returns_message_by_default() -> None:
    inner_calls: List[Any] = []

    def send_email(to: str, body: str) -> str:
        inner_calls.append(True)
        return "sent"

    client, _ = make_client(lambda _r: (200, REFUSE))
    governed = govern_tool_function(send_email, name="send_email", client=client, ward_id="w", subject="s")
    result = governed(to="alice", body="hi")
    assert isinstance(result, str)
    assert "REFUSE" in result
    assert inner_calls == []


def test_refuse_raises_when_configured() -> None:
    def t() -> str:
        return "ok"

    client, _ = make_client(lambda _r: (200, REFUSE))
    governed = govern_tool_function(t, name="t", client=client, ward_id="w", subject="s", on_refuse="raise")
    with pytest.raises(GateRefusal):
        governed()


def test_aristotle_governed_decorator_factory() -> None:
    client, _ = make_client(lambda _r: (200, ALLOW))
    govern = aristotle_governed(client=client, ward_id="w", subject="s")

    @govern("send_email")
    def send_email(to: str) -> str:
        return f"sent to {to}"

    assert send_email("alice") == "sent to alice"
    assert send_email.__name__ == "send_email"


def test_kwargs_extraction_preserves_param_names() -> None:
    seen_bodies: List[bytes] = []

    def handler(req: httpx.Request) -> Tuple[int, Any]:
        seen_bodies.append(req.read())
        return (200, ALLOW)

    def transfer(from_id: str, to_id: str, amount: int) -> str:
        return f"{amount} from {from_id} to {to_id}"

    client, _ = make_client(handler)
    governed = govern_tool_function(transfer, name="transfer", client=client, ward_id="w", subject="s")
    governed(from_id="A", to_id="B", amount=100)
    body = seen_bodies[0].decode()
    assert "from_id" in body and "to_id" in body and "amount" in body


def test_run_context_first_arg_is_stripped_from_params() -> None:
    """When using @agent.tool (not tool_plain), the first arg is a RunContext.
    We should strip it from the gate's view of params."""
    class RunContext:  # structural fake of pydantic_ai's RunContext
        pass

    seen_bodies: List[bytes] = []

    def handler(req: httpx.Request) -> Tuple[int, Any]:
        seen_bodies.append(req.read())
        return (200, ALLOW)

    def my_tool(ctx: RunContext, query: str) -> str:
        return f"r:{query}"

    client, _ = make_client(handler)
    governed = govern_tool_function(my_tool, name="my_tool", client=client, ward_id="w", subject="s")
    governed(RunContext(), query="hello")
    body = seen_bodies[0].decode()
    # ctx should be stripped from params; only query should remain
    assert "query" in body and "hello" in body
    assert "RunContext" not in body  # the param name shouldn't bleed


def test_passthrough_skips_gate() -> None:
    handler_called: List[bool] = []

    def handler(_r: httpx.Request) -> Tuple[int, Any]:
        handler_called.append(True)
        return 500, {"error": "x"}

    def t() -> str:
        return "ok"

    client, _ = make_client(handler)
    governed = govern_tool_function(t, name="t", client=client, ward_id="w", subject="s", passthrough=True)
    assert governed() == "ok"
    assert handler_called == []


def test_action_type_for_routes_vertical() -> None:
    seen_bodies: List[bytes] = []

    def handler(req: httpx.Request) -> Tuple[int, Any]:
        seen_bodies.append(req.read())
        return (200, ALLOW)

    def transfer_title(vin: str) -> str:
        return "ok"

    client, _ = make_client(handler)
    governed = govern_tool_function(transfer_title, name="transfer_title", client=client, ward_id="w", subject="s", action_type_for=lambda _n: "title.transfer")
    governed(vin="V")
    assert "title.transfer" in seen_bodies[0].decode()


def test_on_decision_telemetry_fires() -> None:
    seen: List[Dict[str, Any]] = []

    def t() -> str:
        return "ok"

    client, _ = make_client(lambda _r: (200, ALLOW))
    governed = govern_tool_function(t, name="t", client=client, ward_id="w", subject="s", on_decision=lambda **info: seen.append(info))
    governed()
    assert seen[0]["tool_name"] == "t"
    assert seen[0]["decision"]["decision"] == "ALLOW"
    assert isinstance(seen[0]["elapsed_ms"], float)


@pytest.mark.asyncio
async def test_async_govern_function() -> None:
    async def send(to: str) -> str:
        return f"sent to {to}"

    client, _ = make_client(lambda _r: (200, ALLOW))
    governed = govern_tool_function(send, name="send", client=client, ward_id="w", subject="s")
    assert inspect.iscoroutinefunction(governed)
    result = await governed("alice")
    assert result == "sent to alice"


def test_govern_pydantic_ai_tool_wraps_function_field() -> None:
    """Structural fake: a Pydantic model with a function field."""
    from pydantic import BaseModel, ConfigDict

    def real_send(to: str) -> str:
        return f"sent to {to}"

    class FakeTool(BaseModel):
        model_config = ConfigDict(arbitrary_types_allowed=True)
        name: str
        description: str = ""
        function: Any

    tool = FakeTool(name="send", function=real_send)
    client, _ = make_client(lambda _r: (200, ALLOW))
    governed_tool = govern_pydantic_ai_tool(tool, client=client, ward_id="w", subject="s")
    assert governed_tool.name == "send"
    assert governed_tool.function is not real_send
    assert governed_tool.function("alice") == "sent to alice"


def test_constructor_refuses_missing_required() -> None:
    client, _ = make_client(lambda _r: (200, ALLOW))
    def t() -> str:
        return "ok"
    with pytest.raises(ValueError, match="name"):
        govern_tool_function(t, name="", client=client, ward_id="w", subject="s")
    with pytest.raises(ValueError, match="ward_id"):
        govern_tool_function(t, name="t", client=client, ward_id="", subject="s")
    with pytest.raises(ValueError, match="subject"):
        govern_tool_function(t, name="t", client=client, ward_id="w", subject="")
