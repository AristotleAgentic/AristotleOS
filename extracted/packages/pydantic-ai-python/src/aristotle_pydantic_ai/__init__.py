"""Govern Pydantic AI tool calls with AristotleOS.

Provides three integration shapes:

* :func:`govern_tool_function` — wrap a plain tool function (sync or async).
* :func:`govern_pydantic_ai_tool` — wrap a constructed ``pydantic_ai.tools.Tool``.
* :func:`aristotle_governed` — decorator factory for use with ``@agent.tool``.

``pydantic-ai`` is an OPTIONAL dependency; the wrappers don't import it at
module load time.

Quick start::

    from pydantic_ai import Agent
    from aristotle import AristotleClient
    from aristotle_pydantic_ai import aristotle_governed

    aos = AristotleClient(base_url="http://127.0.0.1:8181")
    govern = aristotle_governed(client=aos, ward_id="ward-ops", subject="agent:1")

    agent = Agent("openai:gpt-4o")

    @agent.tool_plain
    @govern("send_email")
    def send_email(to: str, body: str) -> str:
        return _real_send(to, body)
"""

from ._govern import (
    AristotlePydanticAiError,
    GateEscalation,
    GateRefusal,
    aristotle_governed,
    govern_pydantic_ai_tool,
    govern_tool_function,
)

__version__ = "0.1.0"

__all__ = [
    "__version__",
    "AristotlePydanticAiError",
    "GateEscalation",
    "GateRefusal",
    "aristotle_governed",
    "govern_pydantic_ai_tool",
    "govern_tool_function",
]
