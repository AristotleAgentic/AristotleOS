"""Typed Python client for the AristotleOS execution-control boundary.

Govern autonomous actions before they cross into consequence:
evaluate -> warrant -> execute -> evidence.

Mirrors the @aristotle/os-sdk TypeScript client's HTTP surface and
high-level helpers. Both a synchronous and an asynchronous client are
provided; use whichever matches your stack.

Quick start::

    from aristotle import AristotleClient

    aos = AristotleClient(base_url="https://gate.internal:8181", token="...")
    decision = aos.evaluate({
        "action_id": "act-1",
        "ward_id": "ward-finance",
        "subject": "agent:analyst",
        "action_type": "warehouse.read",
        "params": {"table": "customers"},
    })
    assert decision["decision"] == "ALLOW"
"""

from .client import AristotleClient
from .async_client import AsyncAristotleClient
from .errors import AristotleApiError
from .types import (
    ApprovalDecisionResult,
    ApprovalItem,
    AuditVerifyResult,
    CanonicalAction,
    ConflictSummary,
    DegradationStatus,
    EvaluateResponse,
    ExecutionControlDecision,
    GovernanceDiffResult,
    GovernanceManifest,
    KillSwitchResult,
    MetricsSnapshot,
    PolicyExplanation,
    ReconciliationReport,
    RevokeEnvelopeResult,
    ShadowReport,
    TitleCanonicalAction,
    TitleSubmissionReceipt,
)

__version__ = "0.1.0"

__all__ = [
    "__version__",
    "AristotleClient",
    "AsyncAristotleClient",
    "AristotleApiError",
    "ApprovalDecisionResult",
    "ApprovalItem",
    "AuditVerifyResult",
    "CanonicalAction",
    "ConflictSummary",
    "DegradationStatus",
    "EvaluateResponse",
    "ExecutionControlDecision",
    "GovernanceDiffResult",
    "GovernanceManifest",
    "KillSwitchResult",
    "MetricsSnapshot",
    "PolicyExplanation",
    "ReconciliationReport",
    "RevokeEnvelopeResult",
    "ShadowReport",
    "TitleCanonicalAction",
    "TitleSubmissionReceipt",
]
