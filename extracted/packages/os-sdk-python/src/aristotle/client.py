"""Synchronous client for the AristotleOS execution-control boundary."""

from __future__ import annotations

from typing import Any, Awaitable, Callable, Dict, List, Literal, Optional, Union

import httpx

from ._base import _build_auth_headers, _normalize_base_url, _query, _title_action
from .errors import AristotleApiError
from .types import (
    ApprovalDecisionResult,
    ApprovalItem,
    AuditVerifyResult,
    CanonicalAction,
    ConflictSummary,
    DegradationStatus,
    EvaluateResponse,
    GovernanceDiffResult,
    GovernanceManifest,
    KillSwitchResult,
    MetricsSnapshot,
    PolicyExplanation,
    ReconciliationReport,
    RevokeEnvelopeResult,
    ShadowReport,
    TitleCanonicalAction,
)


class AristotleClient:
    """Typed synchronous client for the AristotleOS execution-control boundary.

    Args:
        base_url: HTTPS URL of the boundary, e.g. ``https://gate.internal:8181``.
        token: Bearer / OIDC token.
        api_key: Static API key (sent as ``X-API-Key``).
        timeout: Per-request timeout in seconds. Defaults to 30.
        transport: Inject an :class:`httpx.BaseTransport` (e.g.
            :class:`httpx.MockTransport`) — useful in tests.

    Authentication:
        Provide ``token``, ``api_key``, or both. Both headers are sent when
        both are provided.

    Errors:
        Any non-2xx response raises :class:`AristotleApiError` carrying the
        HTTP status and the parsed response body.
    """

    def __init__(
        self,
        *,
        base_url: str,
        token: Optional[str] = None,
        api_key: Optional[str] = None,
        timeout: float = 30.0,
        transport: Optional[httpx.BaseTransport] = None,
    ) -> None:
        self._base_url = _normalize_base_url(base_url)
        self._auth_headers = _build_auth_headers(token, api_key)
        self._client = httpx.Client(
            base_url=self._base_url,
            timeout=timeout,
            transport=transport,
            headers={"accept": "application/json", **self._auth_headers},
        )

    # ----------------------------------------------------------------------
    # context manager
    # ----------------------------------------------------------------------

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "AristotleClient":
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    # ----------------------------------------------------------------------
    # request plumbing
    # ----------------------------------------------------------------------

    def _request(self, method: str, pathname: str, body: Optional[Any] = None) -> Any:
        headers: Dict[str, str] = {}
        if body is not None:
            headers["content-type"] = "application/json"
        res = self._client.request(method, pathname, json=body if body is not None else None, headers=headers)
        try:
            parsed = res.json() if res.content else None
        except ValueError:
            parsed = res.text
        if res.status_code >= 400:
            raise AristotleApiError(
                res.status_code,
                f"AristotleOS {method} {pathname} -> {res.status_code}",
                parsed,
            )
        return parsed

    # ----------------------------------------------------------------------
    # Commit Gate
    # ----------------------------------------------------------------------

    def evaluate(
        self,
        action: CanonicalAction,
        *,
        runtime_register: Optional[Dict[str, Any]] = None,
        now: Optional[str] = None,
    ) -> EvaluateResponse:
        """Evaluate an action at the Commit Gate.

        On ``ALLOW`` the response carries a single-use ``warrant`` and a
        signed ``gel_record``.
        """
        body: Dict[str, Any] = {"action": action}
        if runtime_register is not None:
            body["runtime_register"] = runtime_register
        if now is not None:
            body["now"] = now
        return self._request("POST", "/v1/execution-control/evaluate", body)

    def proxy(self, action: CanonicalAction) -> Any:
        """Govern-and-forward: only proxies on ``ALLOW`` + verified Warrant."""
        return self._request("POST", "/v1/execution-control/proxy", {"action": action})

    def context(self) -> Dict[str, Any]:
        """The boundary's current Ward/Authority context."""
        return self._request("GET", "/v1/execution-control/context")

    def health(self) -> Dict[str, Any]:
        return self._request("GET", "/health")

    def metrics(self) -> MetricsSnapshot:
        return self._request("GET", "/v1/execution-control/metrics")

    def degradation(self) -> DegradationStatus:
        return self._request("GET", "/v1/execution-control/degradation")

    # ----------------------------------------------------------------------
    # Evidence
    # ----------------------------------------------------------------------

    def audit_tail(self, limit: int = 20) -> Dict[str, Any]:
        return self._request("GET", f"/v1/execution-control/audit/tail{_query({'limit': limit})}")

    def audit_verify(self) -> AuditVerifyResult:
        return self._request("GET", "/v1/execution-control/audit/verify")

    # ----------------------------------------------------------------------
    # Governance authoring (operator)
    # ----------------------------------------------------------------------

    def compile_governance(self, draft: Dict[str, Any]) -> GovernanceManifest:
        return self._request("POST", "/v1/execution-control/governance/compile", draft)

    def diff_governance(self, *, before: Dict[str, Any], after: Dict[str, Any]) -> GovernanceDiffResult:
        return self._request("POST", "/v1/execution-control/governance/diff", {"before": before, "after": after})

    def explain_governance(self, input: Dict[str, Any]) -> PolicyExplanation:
        return self._request("POST", "/v1/execution-control/governance/explain", input)

    # ----------------------------------------------------------------------
    # Shadow + reconciliation + Conflict Inbox
    # ----------------------------------------------------------------------

    def shadow(self, input: Dict[str, Any]) -> ShadowReport:
        return self._request("POST", "/v1/execution-control/shadow", input)

    def reconcile(self, input: Dict[str, Any]) -> ReconciliationReport:
        return self._request("POST", "/v1/execution-control/reconcile", input)

    def ingest_conflicts(self, input: Dict[str, Any]) -> Dict[str, Any]:
        return self._request("POST", "/v1/execution-control/conflicts/ingest", input)

    def conflicts(self) -> Dict[str, Any]:
        return self._request("GET", "/v1/execution-control/conflicts")

    def resolve_conflict(
        self,
        *,
        action_id: str,
        action: Literal["accept", "reject", "escalate", "reconcile"],
        reason: Optional[str] = None,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {"action_id": action_id, "action": action}
        if reason is not None:
            body["reason"] = reason
        return self._request("POST", "/v1/execution-control/conflicts/resolve", body)

    # ----------------------------------------------------------------------
    # Dual-control approvals
    # ----------------------------------------------------------------------

    def approvals(self) -> Dict[str, Any]:
        return self._request("GET", "/v1/execution-control/approvals")

    def decide_approval(
        self,
        *,
        request_id: str,
        decision: Literal["approve", "reject"],
        reason: Optional[str] = None,
    ) -> ApprovalDecisionResult:
        body: Dict[str, Any] = {"request_id": request_id, "decision": decision}
        if reason is not None:
            body["reason"] = reason
        return self._request("POST", "/v1/execution-control/approvals/decide", body)

    # ----------------------------------------------------------------------
    # Ward Marshal
    # ----------------------------------------------------------------------

    def marshal_census(self, input: Dict[str, Any]) -> Dict[str, Any]:
        return self._request("POST", "/v1/execution-control/marshal/census", input)

    def marshal_behavior(self, input: Dict[str, Any]) -> Dict[str, Any]:
        return self._request("POST", "/v1/execution-control/marshal/behavior", input)

    # ----------------------------------------------------------------------
    # Admin
    # ----------------------------------------------------------------------

    def kill_switch(
        self,
        *,
        scope: str,
        action: Literal["arm", "disarm", "pause"],
        reason: Optional[str] = None,
    ) -> KillSwitchResult:
        body: Dict[str, Any] = {"scope": scope, "action": action}
        if reason is not None:
            body["reason"] = reason
        return self._request("POST", "/v1/execution-control/admin/kill", body)

    def revoke_envelope(self, *, envelope_id: str, reason: Optional[str] = None) -> RevokeEnvelopeResult:
        body: Dict[str, Any] = {"envelope_id": envelope_id}
        if reason is not None:
            body["reason"] = reason
        return self._request("POST", "/v1/execution-control/admin/revoke", body)

    # ----------------------------------------------------------------------
    # High-level helpers
    # ----------------------------------------------------------------------

    def govern_and_execute(
        self,
        action: CanonicalAction,
        executor: Callable[[EvaluateResponse], Any],
        *,
        runtime_register: Optional[Dict[str, Any]] = None,
        now: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Evaluate at the gate; on ALLOW run ``executor``; otherwise refuse.

        - ``ALLOW``: runs ``executor(decision)`` and returns
          ``{"decision": "ALLOW", "result": <executor return>, "warrant": ..., "record": ...}``
        - ``REFUSE``: raises :class:`AristotleApiError` (status 403); the executor never runs.
        - ``ESCALATE``: returns ``{"decision": "ESCALATE", "reason_codes": [...], "record": ...}``;
          the executor never runs.
        """
        verdict = self.evaluate(action, runtime_register=runtime_register, now=now)
        decision = verdict.get("decision")
        if decision == "REFUSE":
            raise AristotleApiError(
                403,
                f"AristotleOS REFUSED {action.get('action_type')}: {', '.join(verdict.get('reason_codes', []))}",
                verdict,
            )
        if decision == "ESCALATE":
            return {
                "decision": "ESCALATE",
                "reason_codes": verdict.get("reason_codes", []),
                "record": verdict.get("gel_record"),
            }
        result = executor(verdict)
        return {
            "decision": "ALLOW",
            "result": result,
            "warrant": verdict.get("warrant"),
            "record": verdict.get("gel_record"),
        }

    @staticmethod
    def title_action(
        *,
        action_id: str,
        ward_id: str,
        subject: str,
        action_type: str,
        vin: str,
        jurisdiction: str,
        transaction_type: str,
        params: Optional[Dict[str, Any]] = None,
        telemetry: Optional[Dict[str, Any]] = None,
    ) -> TitleCanonicalAction:
        """Build a canonical title action with the namespaced action_type and required params.

        ``action_type`` must start with ``"title."``.
        """
        return _title_action(
            action_id=action_id,
            ward_id=ward_id,
            subject=subject,
            action_type=action_type,
            vin=vin,
            jurisdiction=jurisdiction,
            transaction_type=transaction_type,
            params=params,
            telemetry=telemetry,
        )
