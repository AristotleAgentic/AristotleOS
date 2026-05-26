"""Sync client tests against a mock httpx transport."""

from __future__ import annotations

import json
from typing import Any, Callable, Dict, List, Tuple

import httpx
import pytest

from aristotle import AristotleApiError, AristotleClient


def make_recording_transport(
    handler: Callable[[httpx.Request], Tuple[int, Any]],
) -> Tuple[httpx.MockTransport, List[httpx.Request]]:
    recorded: List[httpx.Request] = []

    def _handle(request: httpx.Request) -> httpx.Response:
        recorded.append(request)
        status, body = handler(request)
        return httpx.Response(status, json=body if not isinstance(body, str) else None, text=body if isinstance(body, str) else None)

    return httpx.MockTransport(_handle), recorded


def make_client(handler: Callable[[httpx.Request], Tuple[int, Any]], *, token: str = "tok-operator", api_key: str | None = None) -> Tuple[AristotleClient, List[httpx.Request]]:
    transport, recorded = make_recording_transport(handler)
    client = AristotleClient(base_url="https://gate.internal/", token=token, api_key=api_key, transport=transport)
    return client, recorded


ACTION: Dict[str, Any] = {
    "action_id": "act-1",
    "ward_id": "w1",
    "subject": "agent:demo",
    "action_type": "drone.takeoff",
    "params": {"altitude_m": 60},
}


def test_evaluate_posts_action_and_sends_bearer_token() -> None:
    client, recorded = make_client(
        lambda _req: (200, {"decision": "ALLOW", "reason_codes": [], "canonical_action_hash": "h", "gel_record": {"record_id": "r1", "record_hash": "rh"}, "warrant": {"warrant_id": "wr1"}})
    )
    result = client.evaluate(ACTION, now="2026-05-26T00:00:00.000Z")
    assert result["decision"] == "ALLOW"
    assert result["warrant"]["warrant_id"] == "wr1"

    assert len(recorded) == 1
    req = recorded[0]
    assert req.url.path == "/v1/execution-control/evaluate"
    assert req.method == "POST"
    assert req.headers.get("authorization") == "Bearer tok-operator"
    assert req.headers.get("content-type", "").startswith("application/json")
    assert json.loads(req.content) == {"action": ACTION, "now": "2026-05-26T00:00:00.000Z"}


def test_api_key_is_sent_as_x_api_key_and_get_carries_no_body() -> None:
    client, recorded = make_client(lambda _req: (200, {"ward_id": "w1"}), token=None, api_key="k-123")
    client.context()
    req = recorded[0]
    assert req.url.path == "/v1/execution-control/context"
    assert req.method == "GET"
    assert req.headers.get("x-api-key") == "k-123"
    assert req.content == b""


def test_governance_routes() -> None:
    seen: List[str] = []

    def handler(req: httpx.Request) -> Tuple[int, Any]:
        seen.append(req.url.path)
        return 200, {
            "manifest_version": "v1",
            "hashes": {"ward_hash": "", "authority_envelope_hash": "", "manifest_hash": "m"},
            "validation": {"ok": True, "errors": []},
            "entries": [],
            "summary": {"total": 0, "weakening": 0, "requires_review": False},
            "ward_id": "w1",
            "authority_envelope_id": "ae",
            "allowed_actions": [],
            "denied_actions": [],
            "samples": [],
        }

    client, _ = make_client(handler)
    client.compile_governance({"ward": {}, "authority_envelope": {}})
    client.diff_governance(before={}, after={})
    client.explain_governance({"sample_actions": []})
    assert seen == [
        "/v1/execution-control/governance/compile",
        "/v1/execution-control/governance/diff",
        "/v1/execution-control/governance/explain",
    ]


def test_audit_tail_builds_limit_query_and_audit_verify_parses_result() -> None:
    def handler(req: httpx.Request) -> Tuple[int, Any]:
        if "verify" in req.url.path:
            return 200, {"ok": True, "count": 7}
        return 200, {"items": []}

    client, recorded = make_client(handler)
    client.audit_tail(5)
    verify = client.audit_verify()
    assert recorded[0].url.path == "/v1/execution-control/audit/tail"
    assert recorded[0].url.params["limit"] == "5"
    assert verify["ok"] is True
    assert verify["count"] == 7


def test_non_2xx_raises_AristotleApiError_with_status_and_body() -> None:
    client, _ = make_client(lambda _req: (403, {"error": "forbidden", "required": "operator"}))
    with pytest.raises(AristotleApiError) as excinfo:
        client.evaluate(ACTION)
    assert excinfo.value.status == 403
    assert excinfo.value.body == {"error": "forbidden", "required": "operator"}


def test_metrics_approvals_decide_and_admin_routes() -> None:
    seen: List[Tuple[str, str]] = []

    def handler(req: httpx.Request) -> Tuple[int, Any]:
        seen.append((req.method, req.url.path))
        return 200, {
            "items": [],
            "ok": True,
            "status": "approved",
            "votes": [],
            "scope": "global",
            "action": "arm",
            "applied_at": "t",
            "envelope_id": "env-1",
            "revoked_at": "t",
            "warrants_today": 42,
            "gate_latency_ms": 7.1,
        }

    client, _ = make_client(handler)
    client.metrics()
    client.approvals()
    client.decide_approval(request_id="ap-1", decision="approve", reason="verified")
    client.kill_switch(scope="global", action="arm", reason="incident")
    client.revoke_envelope(envelope_id="env-1", reason="issuer compromise")
    assert seen == [
        ("GET", "/v1/execution-control/metrics"),
        ("GET", "/v1/execution-control/approvals"),
        ("POST", "/v1/execution-control/approvals/decide"),
        ("POST", "/v1/execution-control/admin/kill"),
        ("POST", "/v1/execution-control/admin/revoke"),
    ]


def test_govern_and_execute_allow_runs_executor_and_returns_warrant() -> None:
    client, _ = make_client(
        lambda _req: (200, {"decision": "ALLOW", "reason_codes": [], "canonical_action_hash": "h", "warrant": {"warrant_id": "wr1"}, "gel_record": {"record_id": "r1", "record_hash": "rh"}})
    )
    captured: Dict[str, Any] = {}

    def executor(decision: Dict[str, Any]) -> Dict[str, Any]:
        captured["warrant_id"] = decision["warrant"]["warrant_id"]
        return {"ok": True}

    out = client.govern_and_execute(ACTION, executor)
    assert out["decision"] == "ALLOW"
    assert out["result"] == {"ok": True}
    assert out["warrant"]["warrant_id"] == "wr1"
    assert captured["warrant_id"] == "wr1"


def test_govern_and_execute_refuse_throws_and_executor_never_runs() -> None:
    client, _ = make_client(
        lambda _req: (200, {"decision": "REFUSE", "reason_codes": ["ACTION_DENIED", "WARRANT_NOT_ISSUED"], "canonical_action_hash": "h", "gel_record": {"record_id": "r1", "record_hash": "rh"}})
    )
    executor_ran = False

    def executor(_decision: Dict[str, Any]) -> Dict[str, Any]:
        nonlocal executor_ran
        executor_ran = True
        return {"ok": True}

    with pytest.raises(AristotleApiError) as excinfo:
        client.govern_and_execute(ACTION, executor)
    assert excinfo.value.status == 403
    assert "ACTION_DENIED" in str(excinfo.value)
    assert "WARRANT_NOT_ISSUED" in str(excinfo.value)
    assert executor_ran is False


def test_govern_and_execute_escalate_returns_handle_and_executor_never_runs() -> None:
    client, _ = make_client(
        lambda _req: (200, {"decision": "ESCALATE", "reason_codes": ["DUAL_CONTROL_REQUIRED"], "canonical_action_hash": "h", "gel_record": {"record_id": "r1", "record_hash": "rh"}})
    )
    executor_ran = False

    def executor(_decision: Dict[str, Any]) -> Dict[str, Any]:
        nonlocal executor_ran
        executor_ran = True
        return {"ok": True}

    out = client.govern_and_execute(ACTION, executor)
    assert out["decision"] == "ESCALATE"
    assert out["reason_codes"] == ["DUAL_CONTROL_REQUIRED"]
    assert out["record"]["record_id"] == "r1"
    assert executor_ran is False


def test_title_action_builds_namespaced_canonical_action() -> None:
    a = AristotleClient.title_action(
        action_id="act-mt-7",
        ward_id="ward-title",
        subject="agent:lender-orchestrator",
        action_type="title.lien_release",
        vin="1HGCM82633A123456",
        jurisdiction="MT",
        transaction_type="lien-release",
        params={"lienholder_id": "lender:demo-bank-mt"},
    )
    assert a["action_type"] == "title.lien_release"
    assert a["params"]["vin"] == "1HGCM82633A123456"
    assert a["params"]["jurisdiction"] == "MT"
    assert a["params"]["transaction_type"] == "lien-release"
    assert a["params"]["lienholder_id"] == "lender:demo-bank-mt"


def test_title_action_rejects_non_title_action_type() -> None:
    with pytest.raises(ValueError, match="title."):
        AristotleClient.title_action(
            action_id="act-1",
            ward_id="w1",
            subject="s",
            action_type="drone.takeoff",  # not in title.* namespace
            vin="V",
            jurisdiction="MT",
            transaction_type="lien-release",
        )


def test_constructor_rejects_missing_base_url() -> None:
    with pytest.raises(ValueError, match="base_url"):
        AristotleClient(base_url="")


def test_client_is_context_manager() -> None:
    transport, _ = make_recording_transport(lambda _req: (200, {"ok": True}))
    with AristotleClient(base_url="https://gate.internal", token="t", transport=transport) as client:
        client.health()
