"""Govern AG2 tool calls with AristotleOS.

AG2 is the community fork of Microsoft AutoGen and ships nearly the same
tool / function-registration API (``ConversableAgent.register_for_llm`` /
``register_for_execution`` accept plain Python callables, the same
``FunctionTool`` shape from ``autogen_core.tools`` is used).

This package exposes the same wrapper surface as ``aristotle-autogen`` —
:func:`govern_ag2_function`, :func:`govern_ag2_tool`,
:func:`aristotle_governed` — with AG2-specific telemetry tagging
(``agent_runtime="ag2"``) and naming. Internally the wrappers preserve
the wrapped function's signature so AG2's schema introspection sees no
change.

Quick start::

    from aristotle import AristotleClient
    from aristotle_ag2 import aristotle_governed

    aos = AristotleClient(base_url="http://127.0.0.1:8181")
    govern = aristotle_governed(client=aos, ward_id="w", subject="agent:1")

    @govern("send_email")
    async def send_email(to: str, body: str) -> str:
        return await _real_send(to, body)

    # Then register with your AG2 ConversableAgent:
    # agent.register_for_llm()(send_email)
    # agent.register_for_execution()(send_email)
"""

from ._govern import (
    AristotleAg2Error,
    GateEscalation,
    GateRefusal,
    aristotle_governed,
    govern_ag2_function,
    govern_ag2_tool,
)

__version__ = "0.1.0"

__all__ = [
    "__version__",
    "AristotleAg2Error",
    "GateEscalation",
    "GateRefusal",
    "aristotle_governed",
    "govern_ag2_function",
    "govern_ag2_tool",
]
