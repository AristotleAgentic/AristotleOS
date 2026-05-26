"""Shared helpers for the sync and async clients."""

from __future__ import annotations

from typing import Any, Dict, Optional
from urllib.parse import urlencode


def _build_auth_headers(token: Optional[str], api_key: Optional[str]) -> Dict[str, str]:
    headers: Dict[str, str] = {}
    if token:
        headers["authorization"] = f"Bearer {token}"
    if api_key:
        headers["x-api-key"] = api_key
    return headers


def _normalize_base_url(base_url: str) -> str:
    if not base_url:
        raise ValueError("AristotleClient requires a base_url")
    return base_url.rstrip("/")


def _query(params: Dict[str, Any]) -> str:
    encoded = urlencode({k: v for k, v in params.items() if v is not None})
    return f"?{encoded}" if encoded else ""


def _title_action(
    action_id: str,
    ward_id: str,
    subject: str,
    action_type: str,
    vin: str,
    jurisdiction: str,
    transaction_type: str,
    params: Optional[Dict[str, Any]] = None,
    telemetry: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    if not action_type.startswith("title."):
        raise ValueError(
            f"title_action requires action_type to be in the 'title.*' namespace, got {action_type!r}"
        )
    merged_params: Dict[str, Any] = {
        "vin": vin,
        "jurisdiction": jurisdiction,
        "transaction_type": transaction_type,
    }
    if params:
        merged_params.update(params)
    out: Dict[str, Any] = {
        "action_id": action_id,
        "ward_id": ward_id,
        "subject": subject,
        "action_type": action_type,
        "params": merged_params,
    }
    if telemetry is not None:
        out["telemetry"] = telemetry
    return out
