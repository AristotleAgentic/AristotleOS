"""Govern LlamaIndex tool calls with AristotleOS.

LlamaIndex's :class:`FunctionTool.from_defaults` takes both a sync ``fn`` and
an optional ``async_fn``. The wrapper functions in this package preserve
signatures and can be passed straight into ``FunctionTool.from_defaults``.

``llama-index-core`` is an OPTIONAL dependency.
"""

from ._govern import (
    AristotleLlamaIndexError,
    GateEscalation,
    GateRefusal,
    aristotle_governed,
    govern_llamaindex_tool,
    govern_tool_function,
)

__version__ = "0.1.0"

__all__ = [
    "__version__",
    "AristotleLlamaIndexError",
    "GateEscalation",
    "GateRefusal",
    "aristotle_governed",
    "govern_llamaindex_tool",
    "govern_tool_function",
]
