"""Govern Semantic Kernel function invocations with AristotleOS.

Provides :func:`govern_kernel_function` to wrap a function decorated with
``@kernel_function``, and :func:`aristotle_governed` as a decorator factory
to stack with ``@kernel_function``.

``semantic-kernel`` is an OPTIONAL dependency.
"""

from ._govern import (
    AristotleSemanticKernelError,
    GateEscalation,
    GateRefusal,
    aristotle_governed,
    govern_kernel_function,
)

__version__ = "0.1.0"

__all__ = [
    "__version__",
    "AristotleSemanticKernelError",
    "GateEscalation",
    "GateRefusal",
    "aristotle_governed",
    "govern_kernel_function",
]
