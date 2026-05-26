"""Async client tests against a mock httpx transport."""

from __future__ import annotations

import json
from typing import Any, Callable, Dict, List, Tuple

import httpx
import pytest

from aristotle import AristotleApiError, AsyncAristotleClient


def make_recording_transport(
    handler: Callable[[httpx.Request], Tuple[int, Any]],
) -> Tuple[httpx.MockTransport, List[httpx.Request]]:
    recorded: List[httpx.Request] = []

    def _handle(request: httpx.Request) -> httpx.Response:
        recorded.append(request)
        status, body = handler(request)
        return httpx.Response(status, json=body if not isinstance(body, str) else None, text=body if isinstance(body, str) else None)

    return httpx.MockTransport(_handle), recorded


def make_client(handler: Callable[[httpx.Request], Tuple[int, Any]]) -> Tuple[AsyncAristotleClient, List[httpx.Request]]:
    transport, recorded = make_recording_transport(handler)
    client = AsyncAristotleClient(base_url="https://gate.internal/", token="tok-operator", transport=transport)
    return client, recorded


ACTION: Dict[str, Any] = {
    "action_id": "act-1",
    "ward_id": "w1",
    "subject": "agent:demo",
    "action_type": "drone.takeoff",
    "params": {"altitude_m": 60},
}


@pytest.mark.asyncio
async def test_async_evaluate_posts_action_and_parses_decision() -> None:
    client, recorded = make_client(
        lambda _req: (200, {"decision": "ALLOW", "reason_codes": [], "canonical_action_hash": "h", "gel_record": {"record_id": "r1", "record_hash": "rh"}, "warrant": {"warrant_id": "wr1"}})
    )
    try:
        result = await client.evaluate(ACTION, now="2026-05-26T00:00:00.000Z")
    finally:
        await client.aclose()
    assert result["decision"] == "ALLOW"
    assert result["warrant"]["warrant_id"] == "wr1"
    req = recorded[0]
    assert req.url.path == "/v1/execution-control/evaluate"
    assert json.loads(req.content) == {"action": ACTION, "now": "2026-05-26T00:00:00.000Z"}


@pytest.mark.asyncio
async def test_async_non_2xx_raises_AristotleApiError() -> None:
    client, _ = make_client(lambda _req: (403, {"error": "forbidden"}))
    try:
        with pytest.raises(AristotleApiError) as excinfo:
            await client.evaluate(ACTION)
        assert excinfo.value.status == 403
        assert excinfo.value.body == {"error": "forbidden"}
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_async_govern_and_execute_allow_awaits_executor_and_returns_warrant() -> None:
    client, _ = make_client(
        lambda _req: (200, {"decision": "ALLOW", "reason_codes": [], "canonical_action_hash": "h", "warrant": {"warrant_id": "wr1"}, "gel_record": {"record_id": "r1", "record_hash": "rh"}})
    )
    try:
        async def executor(dec: Dict[str, Any]) -> Dict[str, Any]:
            return {"ok": True, "warrant_id": dec["warrant"]["warrant_id"]}

        out = await client.govern_and_execute(ACTION, executor)
        assert out["decision"] == "ALLOW"
        assert out["result"]["ok"] is True
        assert out["warrant"]["warrant_id"] == "wr1"
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_async_govern_and_execute_refuse_throws_and_executor_never_runs() -> None:
    client, _ = make_client(
        lambda _req: (200, {"decision": "REFUSE", "reason_codes": ["ACTION_DENIED"], "canonical_action_hash": "h", "gel_record": {"record_id": "r1", "record_hash": "rh"}})
    )
    executor_ran = False

    async def executor(_dec: Dict[str, Any]) -> Dict[str, Any]:
        nonlocal executor_ran
        executor_ran = True
        return {"ok": True}

    try:
        with pytest.raises(AristotleApiError) as excinfo:
            await client.govern_and_execute(ACTION, executor)
        assert excinfo.value.status == 403
        assert "ACTION_DENIED" in str(excinfo.value)
        assert executor_ran is False
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_async_govern_and_execute_escalate_returns_handle() -> None:
    client, _ = make_client(
        lambda _req: (200, {"decision": "ESCALATE", "reason_codes": ["DUAL_CONTROL_REQUIRED"], "canonical_action_hash": "h", "gel_record": {"record_id": "r1", "record_hash": "rh"}})
    )

    async def executor(_dec: Dict[str, Any]) -> Dict[str, Any]:
        raise AssertionError("executor must not run on ESCALATE")

    try:
        out = await client.govern_and_execute(ACTION, executor)
        assert out["decision"] == "ESCALATE"
        assert out["reason_codes"] == ["DUAL_CONTROL_REQUIRED"]
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_async_client_is_async_context_manager() -> None:
    transport, _ = make_recording_transport(lambda _req: (200, {"ok": True}))
    async with AsyncAristotleClient(base_url="https://gate.internal", token="t", transport=transport) as client:
        await client.health()


@pytest.mark.asyncio
async def test_async_title_action_static_builder_works_off_async_class() -> None:
    a = AsyncAristotleClient.title_action(
        action_id="act-mt-7",
        ward_id="ward-title",
        subject="agent:lender-orchestrator",
        action_type="title.transfer",
        vin="V",
        jurisdiction="MT",
        transaction_type="transfer",
    )
    assert a["action_type"] == "title.transfer"
    assert a["params"]["jurisdiction"] == "MT"
