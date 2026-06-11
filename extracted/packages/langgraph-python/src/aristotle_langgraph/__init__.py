"""Govern LangGraph tool calls with AristotleOS.

Provides :func:`aristotle_tool_call_wrapper` and
:func:`aristotle_atool_call_wrapper`, which return middleware suitable for
LangGraph's :class:`langgraph.prebuilt.ToolNode` ``wrap_tool_call`` /
``awrap_tool_call`` parameters. Every tool invocation in the node is routed
through the AristotleOS Commit Gate before it runs.

``langgraph`` is an OPTIONAL dependency (install
``aristotle-langgraph[langgraph]``); the wrappers don't import it at module
load time and only touch ``langchain_core.messages.ToolMessage`` /
``langgraph.types.interrupt`` lazily when needed at runtime.

Quick start::

    from langgraph.prebuilt import ToolNode
    from aristotle import AristotleClient
    from aristotle_langgraph import aristotle_tool_call_wrapper

    aos = AristotleClient(base_url="http://127.0.0.1:8181")

    node = ToolNode(
        tools=[my_tool, another_tool],
        wrap_tool_call=aristotle_tool_call_wrapper(
            client=aos, ward_id="ward-agent-ops", subject="agent:assistant-1"
        ),
    )
"""

from ._govern import (
    AristotleLanggraphError,
    AristotleToolOutcome,
    GateEscalation,
    GateRefusal,
    aristotle_atool_call_wrapper,
    aristotle_tool_call_wrapper,
)

__version__ = "0.1.0"

__all__ = [
    "__version__",
    "AristotleLanggraphError",
    "AristotleToolOutcome",
    "GateEscalation",
    "GateRefusal",
    "aristotle_atool_call_wrapper",
    "aristotle_tool_call_wrapper",
]
