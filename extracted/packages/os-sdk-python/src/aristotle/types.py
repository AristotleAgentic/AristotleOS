"""Typed shapes mirroring the @aristotle/os-sdk TypeScript types.

Responses are returned as plain ``dict`` objects to stay zero-dep and
forward-compatible; these ``TypedDict`` shapes describe the keys you can
rely on, but the runtime may add fields without notice (forward-compatible
JSON contract).
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, TypedDict, Union


ExecutionControlDecision = Literal["ALLOW", "REFUSE", "ESCALATE"]


class CanonicalAction(TypedDict, total=False):
    action_id: str
    ward_id: str
    subject: str
    action_type: str
    target: str
    params: Dict[str, Any]
    requested_at: str
    request_id: str
    telemetry: Dict[str, Any]


class TitleCanonicalAction(CanonicalAction, total=False):
    """A canonical action whose ``action_type`` is in the ``title.*`` namespace.

    Use :meth:`AristotleClient.title_action` to build one.
    """


class _Warrant(TypedDict, total=False):
    warrant_id: str


class _GelRecord(TypedDict, total=False):
    record_id: str
    record_hash: str


class EvaluateResponse(TypedDict, total=False):
    decision: ExecutionControlDecision
    reason_codes: List[str]
    canonical_action_hash: str
    warrant: _Warrant
    gel_record: _GelRecord


class GovernanceManifest(TypedDict, total=False):
    manifest_version: str
    hashes: Dict[str, str]
    validation: Dict[str, Any]


class _DiffEntry(TypedDict, total=False):
    path: str
    kind: str
    weakening: bool
    note: str


class GovernanceDiffResult(TypedDict, total=False):
    entries: List[_DiffEntry]
    summary: Dict[str, Any]


class _PolicyExplanationSample(TypedDict, total=False):
    action_id: str
    action_type: str
    decision: ExecutionControlDecision
    reason_codes: List[str]


class PolicyExplanation(TypedDict, total=False):
    ward_id: str
    authority_envelope_id: str
    allowed_actions: List[str]
    denied_actions: List[str]
    samples: List[_PolicyExplanationSample]


class ShadowReport(TypedDict, total=False):
    ward_id: str
    authority_envelope_id: str
    count: int
    decisions: Dict[str, int]
    rollout: Dict[str, Any]


class ReconciliationReport(TypedDict, total=False):
    ward_id: str
    count: int
    agreements: int
    conflicts: int
    items: List[Dict[str, Any]]


class ConflictSummary(TypedDict, total=False):
    total: int
    open: int
    conflicts: int
    by_status: Dict[str, int]


DegradationCondition = Literal[
    "ledger_unavailable",
    "control_plane_stale",
    "quorum_lost",
    "dependency_timeout",
]


class DegradationStatus(TypedDict, total=False):
    ward_id: str
    criticality: Literal["safety_critical", "mission_critical", "routine", "best_effort"]
    healthy: bool
    conditions: List[DegradationCondition]
    fail_action: Literal["allow", "allow_degraded", "escalate", "refuse"]
    binding_condition: Optional[DegradationCondition]
    probes: int


class AuditVerifyResult(TypedDict, total=False):
    ok: bool
    count: int
    failure: str


class _ApprovalVote(TypedDict, total=False):
    operator_id: str
    decision: Literal["approve", "reject"]
    reason: str
    voted_at: str


class ApprovalItem(TypedDict, total=False):
    request_id: str
    action_id: str
    action_type: str
    ward_id: str
    required: int
    votes: List[_ApprovalVote]
    status: Literal["pending", "approved", "rejected"]
    created_at: str


class ApprovalDecisionResult(TypedDict, total=False):
    ok: bool
    status: Literal["pending", "approved", "rejected"]
    votes: List[_ApprovalVote]


class KillSwitchResult(TypedDict, total=False):
    ok: bool
    scope: str
    action: Literal["arm", "disarm", "pause"]
    applied_at: str


class RevokeEnvelopeResult(TypedDict, total=False):
    ok: bool
    envelope_id: str
    revoked_at: str


class MetricsSnapshot(TypedDict, total=False):
    warrants_today: int
    refusals_today: int
    escalations_today: int
    gate_latency_ms: float
    ledger_height: int


class TitleSubmissionReceipt(TypedDict, total=False):
    """Mirrors the runtime's hash-bound submission receipt.

    The receipt's ``receipt_hash`` covers ``warrant_id`` + ``action_hash`` +
    ``remote_receipt_id`` + ack metadata, so the receipt can be verified
    out-of-band before being bound into a Title Evidence Bundle.
    """

    packet_id: str
    jurisdiction: str
    transport: str
    channel: str
    remote_receipt_id: str
    ack_at: str
    ack_kind: Literal["accepted", "queued", "pending-review"]
    warrant_id: str
    action_hash: str
    receipt_hash: str
    production_validated: bool


# GovernAndExecute return shape — discriminated by the ``decision`` key.
GovernAndExecuteResult = Union[
    Dict[str, Any],  # {decision: "ALLOW", result, warrant, record}
    Dict[str, Any],  # {decision: "ESCALATE", reason_codes, record}
]
