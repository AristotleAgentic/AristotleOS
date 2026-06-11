"""Govern CrewAI tool calls with AristotleOS.

Two integration shapes are provided:

* :func:`govern_run` — wrap a CrewAI ``BaseTool._run`` callable. Use when you
  want minimal magic: keep your existing tool class, wire governance on the
  instance.
* :func:`govern_crewai_tool` — wrap an existing CrewAI ``BaseTool`` instance
  and return a same-shape governed instance. Use when you want to govern a
  third-party tool you didn't author.

Both routes call the same gate logic. ``crewai`` is an OPTIONAL dependency
(install ``aristotle-crewai[crewai]``); the wrappers are pure Python and
have no compile-time dependency on CrewAI.

Quick start::

    from crewai.tools import BaseTool
    from aristotle import AristotleClient
    from aristotle_crewai import govern_run

    aos = AristotleClient(base_url="http://127.0.0.1:8181")

    class SendEmailTool(BaseTool):
        name: str = "send_email"
        description: str = "Send an email."

        def _run(self, to: str, body: str) -> str:
            return _real_send(to, body)

    tool = SendEmailTool()
    tool._run = govern_run(
        tool._run, name=tool.name, client=aos,
        ward_id="ward-agent-ops", subject="agent:assistant-1",
    )
"""

from ._govern import (
    AristotleCrewaiError,
    GateRefusal,
    GateEscalation,
    govern_arun,
    govern_crewai_tool,
    govern_run,
)

__version__ = "0.1.0"

__all__ = [
    "__version__",
    "AristotleCrewaiError",
    "GateRefusal",
    "GateEscalation",
    "govern_arun",
    "govern_crewai_tool",
    "govern_run",
]
