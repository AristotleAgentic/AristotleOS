"""Asynchronous client for the AristotleOS execution-control boundary.

Mirrors :class:`aristotle.AristotleClient`; method names and parameters are
identical, return shapes are identical, but every method is a coroutine.

Use this from async agent frameworks (LangChain async, OpenAI agents,
Anthropic SDK async, etc.).
"""

from __future__ import annotations

from typing import Any, Awaitable, Callable, Dict, Literal, Optional

import httpx

from ._base import _build_auth_headers, _normalize_base_url, _query, _title_action
from .errors import AristotleApiError
from .types import (
    ApprovalDecisionResult,
    AuditVerifyResult,
    CanonicalAction,
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


class AsyncAristotleClient:
    """Typed async client for the AristotleOS execution-control boundary.

    Same surface as :class:`AristotleClient`; every I/O-bearing method
    returns a coroutine. Use ``async with`` to ensure the underlying
    httpx client closes cleanly.
    """

    def __init__(
        self,
        *,
        base_url: str,
        token: Optional[str] = None,
        api_key: Optional[str] = None,
        timeout: float = 30.0,
        transport: Optional[httpx.AsyncBaseTransport] = None,
    ) -> None:
        self._base_url = _normalize_base_url(base_url)
        self._auth_headers = _build_auth_headers(token, api_key)
        self._client = httpx.AsyncClient(
            base_url=self._base_url,
            timeout=timeout,
            transport=transport,
            headers={"accept": "application/json", **self._auth_headers},
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> "AsyncAristotleClient":
        return self

    async def __aexit__(self, *_exc: object) -> None:
        await self.aclose()

    async def _request(self, method: str, pathname: str, body: Optional[Any] = None) -> Any:
        headers: Dict[str, str] = {}
        if body is not None:
            headers["content-type"] = "application/json"
        res = await self._client.request(method, pathname, json=body if body is not None else None, headers=headers)
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

    # Commit Gate -----------------------------------------------------------

    async def evaluate(
        self,
        action: CanonicalAction,
        *,
        runtime_register: Optional[Dict[str, Any]] = None,
        now: Optional[str] = None,
    ) -> EvaluateResponse:
        body: Dict[str, Any] = {"action": action}
        if runtime_register is not None:
            body["runtime_register"] = runtime_register
        if now is not None:
            body["now"] = now
        return await self._request("POST", "/v1/execution-control/evaluate", body)

    async def proxy(self, action: CanonicalAction) -> Any:
        return await self._request("POST", "/v1/execution-control/proxy", {"action": action})

    async def context(self) -> Dict[str, Any]:
        return await self._request("GET", "/v1/execution-control/context")

    async def health(self) -> Dict[str, Any]:
        return await self._request("GET", "/health")

    async def metrics(self) -> MetricsSnapshot:
        return await self._request("GET", "/v1/execution-control/metrics")

    async def degradation(self) -> DegradationStatus:
        return await self._request("GET", "/v1/execution-control/degradation")

    # Evidence --------------------------------------------------------------

    async def audit_tail(self, limit: int = 20) -> Dict[str, Any]:
        return await self._request("GET", f"/v1/execution-control/audit/tail{_query({'limit': limit})}")

    async def audit_verify(self) -> AuditVerifyResult:
        return await self._request("GET", "/v1/execution-control/audit/verify")

    # Governance ------------------------------------------------------------

    async def compile_governance(self, draft: Dict[str, Any]) -> GovernanceManifest:
        return await self._request("POST", "/v1/execution-control/governance/compile", draft)

    async def diff_governance(self, *, before: Dict[str, Any], after: Dict[str, Any]) -> GovernanceDiffResult:
        return await self._request("POST", "/v1/execution-control/governance/diff", {"before": before, "after": after})

    async def explain_governance(self, input: Dict[str, Any]) -> PolicyExplanation:
        return await self._request("POST", "/v1/execution-control/governance/explain", input)

    # Shadow + reconciliation + conflicts -----------------------------------

    async def shadow(self, input: Dict[str, Any]) -> ShadowReport:
        return await self._request("POST", "/v1/execution-control/shadow", input)

    async def reconcile(self, input: Dict[str, Any]) -> ReconciliationReport:
        return await self._request("POST", "/v1/execution-control/reconcile", input)

    async def ingest_conflicts(self, input: Dict[str, Any]) -> Dict[str, Any]:
        return await self._request("POST", "/v1/execution-control/conflicts/ingest", input)

    async def conflicts(self) -> Dict[str, Any]:
        return await self._request("GET", "/v1/execution-control/conflicts")

    async def resolve_conflict(
        self,
        *,
        action_id: str,
        action: Literal["accept", "reject", "escalate", "reconcile"],
        reason: Optional[str] = None,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {"action_id": action_id, "action": action}
        if reason is not None:
            body["reason"] = reason
        return await self._request("POST", "/v1/execution-control/conflicts/resolve", body)

    # Approvals -------------------------------------------------------------

    async def approvals(self) -> Dict[str, Any]:
        return await self._request("GET", "/v1/execution-control/approvals")

    async def decide_approval(
        self,
        *,
        request_id: str,
        decision: Literal["approve", "reject"],
        reason: Optional[str] = None,
    ) -> ApprovalDecisionResult:
        body: Dict[str, Any] = {"request_id": request_id, "decision": decision}
        if reason is not None:
            body["reason"] = reason
        return await self._request("POST", "/v1/execution-control/approvals/decide", body)

    # Marshal ---------------------------------------------------------------

    async def marshal_census(self, input: Dict[str, Any]) -> Dict[str, Any]:
        return await self._request("POST", "/v1/execution-control/marshal/census", input)

    async def marshal_behavior(self, input: Dict[str, Any]) -> Dict[str, Any]:
        return await self._request("POST", "/v1/execution-control/marshal/behavior", input)

    # Admin -----------------------------------------------------------------

    async def kill_switch(
        self,
        *,
        scope: str,
        action: Literal["arm", "disarm", "pause"],
        reason: Optional[str] = None,
    ) -> KillSwitchResult:
        body: Dict[str, Any] = {"scope": scope, "action": action}
        if reason is not None:
            body["reason"] = reason
        return await self._request("POST", "/v1/execution-control/admin/kill", body)

    async def revoke_envelope(self, *, envelope_id: str, reason: Optional[str] = None) -> RevokeEnvelopeResult:
        body: Dict[str, Any] = {"envelope_id": envelope_id}
        if reason is not None:
            body["reason"] = reason
        return await self._request("POST", "/v1/execution-control/admin/revoke", body)

    # High-level helpers ----------------------------------------------------

    async def govern_and_execute(
        self,
        action: CanonicalAction,
        executor: Callable[[EvaluateResponse], Awaitable[Any]],
        *,
        runtime_register: Optional[Dict[str, Any]] = None,
        now: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Async govern-and-execute.

        Same contract as the sync version, but ``executor`` must be a
        coroutine function.
        """
        verdict = await self.evaluate(action, runtime_register=runtime_register, now=now)
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
        result = await executor(verdict)
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
