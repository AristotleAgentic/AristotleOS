"""Tests for govern_crewai_tool against a Pydantic-shaped fake of CrewAI BaseTool.

We avoid installing the full ``crewai`` package (which has heavy native deps
and Python-version constraints) by building a fake BaseTool from pydantic
that satisfies the structural contract govern_crewai_tool needs.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Tuple, Type

import httpx
import pytest
from pydantic import BaseModel, Field, ConfigDict

from aristotle import AristotleClient
from aristotle_crewai import GateRefusal, govern_crewai_tool


# ---------------------------------------------------------------------------
# A pydantic-shaped fake of CrewAI's BaseTool.
# ---------------------------------------------------------------------------

class FakeBaseTool(BaseModel):
    """Mirror of crewai.tools.BaseTool's structural contract."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    name: str
    description: str
    args_schema: Type[BaseModel] | None = None

    def _run(self, *args: Any, **kwargs: Any) -> str:
        raise NotImplementedError


class SendEmailInput(BaseModel):
    to: str = Field(...)
    body: str = Field(...)


class SendEmailTool(FakeBaseTool):
    name: str = "send_email"
    description: str = "Send an email."
    args_schema: Type[BaseModel] | None = SendEmailInput

    def _run(self, to: str, body: str) -> str:
        return f"sent to {to}: {body}"


# ---------------------------------------------------------------------------
# httpx mock plumbing
# ---------------------------------------------------------------------------

def make_transport(handler: Callable[[httpx.Request], Tuple[int, Any]]) -> Tuple[httpx.MockTransport, List[httpx.Request]]:
    recorded: List[httpx.Request] = []

    def _handle(request: httpx.Request) -> httpx.Response:
        recorded.append(request)
        status, body = handler(request)
        return httpx.Response(status, json=body if not isinstance(body, str) else None, text=body if isinstance(body, str) else None)

    return httpx.MockTransport(_handle), recorded


def make_client(handler: Callable[[httpx.Request], Tuple[int, Any]]) -> Tuple[AristotleClient, List[httpx.Request]]:
    transport, calls = make_transport(handler)
    return AristotleClient(base_url="https://gate.internal", token="t", transport=transport), calls


ALLOW = {"decision": "ALLOW", "reason_codes": [], "canonical_action_hash": "h", "warrant": {"warrant_id": "wr-1"}, "gel_record": {"record_id": "rec-1", "record_hash": "rh"}}
REFUSE = {"decision": "REFUSE", "reason_codes": ["ACTION_DENIED"], "canonical_action_hash": "h", "gel_record": {"record_id": "rec-1", "record_hash": "rh"}}


def test_governed_tool_preserves_name_description_and_args_schema() -> None:
    tool = SendEmailTool()
    client, _ = make_client(lambda _r: (200, ALLOW))
    governed = govern_crewai_tool(tool, client=client, ward_id="ward-ops", subject="agent:1")
    assert governed.name == "send_email"
    assert governed.description == "Send an email."
    assert governed.args_schema is SendEmailInput


def test_governed_tool_is_an_instance_of_the_original_class() -> None:
    """So the CrewAI agent runtime continues to recognize it as a tool."""
    tool = SendEmailTool()
    client, _ = make_client(lambda _r: (200, ALLOW))
    governed = govern_crewai_tool(tool, client=client, ward_id="w", subject="s")
    assert isinstance(governed, SendEmailTool)
    assert isinstance(governed, FakeBaseTool)


def test_governed_tool_run_calls_inner_on_allow() -> None:
    tool = SendEmailTool()
    client, calls = make_client(lambda _r: (200, ALLOW))
    governed = govern_crewai_tool(tool, client=client, ward_id="ward-ops", subject="agent:1")

    result = governed._run(to="alice@example.com", body="hi")
    assert result == "sent to alice@example.com: hi"
    assert len(calls) == 1
    body = calls[0].read().decode()
    assert "tool.send_email" in body
    assert "ward-ops" in body
    assert "alice@example.com" in body


def test_governed_tool_run_returns_refuse_message_on_refuse() -> None:
    tool = SendEmailTool()
    client, _ = make_client(lambda _r: (200, REFUSE))
    governed = govern_crewai_tool(tool, client=client, ward_id="w", subject="s")
    out = governed._run(to="alice", body="hi")
    assert isinstance(out, str)
    assert "REFUSE" in out
    assert "ACTION_DENIED" in out


def test_governed_tool_run_raises_on_refuse_when_configured() -> None:
    tool = SendEmailTool()
    client, _ = make_client(lambda _r: (200, REFUSE))
    governed = govern_crewai_tool(tool, client=client, ward_id="w", subject="s", on_refuse="raise")
    with pytest.raises(GateRefusal):
        governed._run(to="alice", body="hi")


def test_governed_tool_passthrough_set_skips_the_gate() -> None:
    tool = SendEmailTool()
    seen = []

    def handler(req: httpx.Request) -> Tuple[int, Any]:
        seen.append(True)
        return (500, {"error": "should not be reached"})

    client, _ = make_client(handler)
    governed = govern_crewai_tool(
        tool, client=client, ward_id="w", subject="s",
        passthrough_tools={"send_email"},
    )
    result = governed._run(to="alice", body="hi")
    assert result == "sent to alice: hi"
    assert seen == []


def test_governed_tool_action_type_for_routes_vertical() -> None:
    seen_bodies: List[bytes] = []

    def handler(req: httpx.Request) -> Tuple[int, Any]:
        seen_bodies.append(req.read())
        return (200, ALLOW)

    tool = SendEmailTool()
    client, _ = make_client(handler)
    governed = govern_crewai_tool(
        tool, client=client, ward_id="w", subject="s",
        action_type_for=lambda n: "communications.send_message",
    )
    governed._run(to="x", body="y")
    body = seen_bodies[0].decode()
    assert "communications.send_message" in body


def test_original_tool_instance_is_unchanged() -> None:
    """govern_crewai_tool must NOT mutate the input — important for sharing
    a tool registry between governed and ungoverned runs."""
    tool = SendEmailTool()
    client, _ = make_client(lambda _r: (200, REFUSE))
    govern_crewai_tool(tool, client=client, ward_id="w", subject="s")
    # The original tool still runs unimpeded.
    assert tool._run(to="alice", body="hi") == "sent to alice: hi"
