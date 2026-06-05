# aristotle-crewai

**Govern CrewAI tool calls with AristotleOS.** Route every tool invocation through the AristotleOS execution-control Commit Gate before it runs. Same vertical-routing recipe as the TypeScript adapters — a tool named `transfer_title` lands in the Title vertical's full rule pack with one line of config.

Both **sync** (`govern_run`, `govern_crewai_tool`) and **async** (`govern_arun`) wrappers are provided. The wrappers have no compile-time dependency on `crewai`; install it separately when you use it in a real agent.

```sh
pip install aristotle-crewai             # just the wrappers (no crewai dependency)
pip install aristotle-crewai[crewai]     # also installs crewai
```

Python 3.9+.

## Quickstart — wrap a CrewAI tool's `_run`

```python
from crewai.tools import BaseTool
from aristotle import AristotleClient
from aristotle_crewai import govern_run

aos = AristotleClient(base_url="http://127.0.0.1:8181", token="...")

class SendEmailTool(BaseTool):
    name: str = "send_email"
    description: str = "Send an email."
    def _run(self, to: str, body: str) -> str:
        return _real_send(to, body)

tool = SendEmailTool()
tool._run = govern_run(
    tool._run,
    name=tool.name,
    client=aos,
    ward_id="ward-agent-ops",
    subject="agent:assistant-1",
)
```

Now every time the agent calls `send_email`, the action first becomes a CanonicalAction (`action_type: "tool.send_email"`), goes to the Commit Gate, and runs only on ALLOW.

## Quickstart — wrap a third-party tool you didn't author

```python
from aristotle_crewai import govern_crewai_tool
from somebody_elses_lib import ScaryDeleteTool

raw = ScaryDeleteTool()
safe = govern_crewai_tool(
    raw,
    client=aos,
    ward_id="ward-agent-ops",
    subject="agent:assistant-1",
)

crew = Crew(agents=[...], tasks=[...], tools=[safe])
```

`safe` is a dynamic subclass of `type(raw)` with the **same** `name`, `description`, and `args_schema`, so the agent sees no change in its tool catalog. The original `raw` is untouched.

## Decision mapping

| Aristotle Gate | Wrapper returns / raises | What the agent sees |
|---|---|---|
| `ALLOW` | invokes the wrapped `_run` and returns its output | tool runs normally |
| `REFUSE` | returns refusal message (default) — or raises `GateRefusal` with `on_refuse="raise"` | refusal string with reason codes + GEL record id |
| `ESCALATE` | returns escalation message (default) — or raises `GateEscalation` with `on_escalate="raise"` | escalation string the agent can incorporate |
| Gate unreachable | raises the underlying exception (default) — or returns error message with `on_error="return_message"` | error propagates or string returned |

## Async (`_arun`)

```python
from aristotle import AsyncAristotleClient
from aristotle_crewai import govern_arun

aos = AsyncAristotleClient(base_url="http://127.0.0.1:8181")

class FetchTool(BaseTool):
    name: str = "fetch_url"
    description: str = "Fetch a URL."
    async def _arun(self, url: str) -> str:
        async with httpx.AsyncClient() as c:
            return (await c.get(url)).text

tool = FetchTool()
tool._arun = govern_arun(
    tool._arun, name=tool.name, client=aos,
    ward_id="ward-agent-ops", subject="agent:assistant-1",
)
```

## Recipe — route a vertical's tool calls

```python
title_tool = govern_crewai_tool(
    raw_transfer_title_tool,
    client=aos,
    ward_id="ward-title-transaction-ops",
    subject="agent:title-orchestrator",
    action_type_for=lambda name:
        "title.transfer"      if name == "transfer_title" else
        "title.lien_release"  if name == "release_lien" else
        f"tool.{name.lower()}",
)
```

The Title vertical's `JURISDICTION_RULE_PRESETS`, NMVTIS pre-checks, dual-control rules, and demonstration-only warnings all apply automatically.

## Recipe — passthrough read-only tools

```python
safe = govern_crewai_tool(
    raw, client=aos, ward_id="w", subject="s",
    passthrough_tools={"search_docs", "read_kb"},
)
```

The named tools bypass the gate; everything else still routes through.

## Recipe — telemetry / audit

```python
def on_decision(*, tool_name, tool_input, action, decision, elapsed_ms):
    metrics.gate_observed(tool=tool_name, ms=elapsed_ms, decision=decision.get("decision"))

tool._run = govern_run(
    tool._run, name=tool.name, client=aos,
    ward_id="w", subject="s",
    on_decision=on_decision,
)
```

`on_decision` fires after every gate call (including errors). Same shape as the TS adapters.

## API

```python
from aristotle_crewai import (
    govern_run,         # wrap a CrewAI _run callable
    govern_arun,        # wrap a CrewAI _arun coroutine function
    govern_crewai_tool, # wrap a CrewAI BaseTool INSTANCE
    GateRefusal,        # raised by govern_run/govern_arun when on_refuse="raise"
    GateEscalation,     # raised when on_escalate="raise"
    AristotleCrewaiError,  # base class for both
)
```

### `govern_run(inner_run, *, name, client, ward_id, subject, ...) -> Callable`

Wrap a CrewAI `BaseTool._run` callable. The returned callable has the same signature.

Options (all keyword-only):

- `agent_name` — for telemetry.
- `action_type_prefix` — default `"tool"`. Forms `"<prefix>.<lower(name)>"`.
- `action_type_for` — `Callable[[str], str]` to map specific tool names into vertical namespaces.
- `build_action` — `Callable[..., dict]` to override the entire CanonicalAction.
- `passthrough` — `True` to skip the gate entirely.
- `on_refuse` — `"return_message"` (default) or `"raise"`.
- `on_escalate` — `"return_message"` (default) or `"raise"`.
- `on_error` — `"raise"` (default — propagate the underlying exception) or `"return_message"`.
- `on_decision` — telemetry callback fired after every gate call (including errors).

### `govern_arun(...) -> Callable[..., Awaitable]`

Same options as `govern_run`, but expects `client: AsyncAristotleClient` and an async `inner_arun`.

### `govern_crewai_tool(tool, *, client, ward_id, subject, ...) -> tool`

Returns a same-shape governed twin of `tool`. Accepts `passthrough_tools: set[str]` instead of `passthrough: bool`.

## Notes

- The package has **no compile-time dependency on `crewai`**. The wrappers are pure Python and exercise the gate via `aristotle-os-sdk`. CrewAI is an optional extra (`aristotle-crewai[crewai]`).
- `govern_crewai_tool` works against any Pydantic v2-based BaseTool — proven by tests that use a structural fake. CrewAI's real `BaseTool` (from `crewai.tools`) has the exact same shape and is supported transparently.
- The same `action_type_for` recipe used in `@aristotle/claude-agents`, `@aristotle/langchain`, and `@aristotle/openai-agents` works here unchanged.

## License

Proprietary. See `LICENSE` and `NOTICE`.
