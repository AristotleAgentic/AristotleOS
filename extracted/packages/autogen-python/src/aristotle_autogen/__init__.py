"""Govern AutoGen tool calls with AristotleOS.

Provides:

* :func:`govern_autogen_function` — wrap a plain tool function before
  passing it to ``FunctionTool(func, description=...)``.
* :func:`govern_autogen_tool` — wrap a constructed
  ``autogen_core.tools.FunctionTool`` and return a same-shape governed
  twin.
* :func:`aristotle_governed` — decorator factory for tool functions.

``autogen-core`` is an OPTIONAL dependency.

Quick start::

    from autogen_core.tools import FunctionTool
    from aristotle import AristotleClient
    from aristotle_autogen import govern_autogen_function

    aos = AristotleClient(base_url="http://127.0.0.1:8181")

    async def send_email(to: str, body: str) -> str:
        return await _real_send(to, body)

    governed = govern_autogen_function(
        send_email, name="send_email", client=aos,
        ward_id="ward-ops", subject="agent:1",
    )
    tool = FunctionTool(governed, description="Send an email")
"""

from ._govern import (
    AristotleAutogenError,
    GateEscalation,
    GateRefusal,
    aristotle_governed,
    govern_autogen_function,
    govern_autogen_tool,
)

__version__ = "0.1.0"

__all__ = [
    "__version__",
    "AristotleAutogenError",
    "GateEscalation",
    "GateRefusal",
    "aristotle_governed",
    "govern_autogen_function",
    "govern_autogen_tool",
]
