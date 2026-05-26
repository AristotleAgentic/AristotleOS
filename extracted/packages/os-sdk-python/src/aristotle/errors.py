"""Errors raised by the AristotleOS Python client."""

from __future__ import annotations

from typing import Any, Optional


class AristotleApiError(Exception):
    """Raised on any non-2xx response from the execution-control boundary.

    Carries the HTTP status and the parsed response body so callers can
    decide whether to retry, escalate, or surface to a human.
    """

    def __init__(self, status: int, message: str, body: Optional[Any] = None) -> None:
        super().__init__(message)
        self.status = status
        self.body = body

    def __repr__(self) -> str:
        return f"AristotleApiError(status={self.status}, message={self.args[0]!r})"
