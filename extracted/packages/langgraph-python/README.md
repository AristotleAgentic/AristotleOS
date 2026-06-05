# aristotle-langgraph

**Govern LangGraph tool calls with AristotleOS.** A drop-in `wrap_tool_call` (and `awrap_tool_call`) middleware for LangGraph's `ToolNode` that routes every tool invocation through the AristotleOS execution-control Commit Gate before it runs.

LangGraph's `ToolNode` accepts a `wrap_tool_call` callable as a **first-class** middleware seam (added in LangGraph 0.2.x):

> *Sync wrapper function to intercept tool execution. Receives `ToolCallRequest` and execute callable, returns `ToolMessage` or `Command`. Enables retries, caching, request modification, and control flow.*

This adapter plugs directly into that seam — no monkey-patching, no shadow tools.

```sh
pip install aristotle-langgraph                       # just the wrappers
pip install aristotle-langgraph[langgraph]            # also install langgraph
```

Python 3.9+.

## Quickstart

```python
from langgraph.prebuilt import ToolNode
from langgraph.graph import StateGraph, MessagesState
from langchain_core.tools import tool
from aristotle import AristotleClient
from aristotle_langgraph import aristotle_tool_call_wrapper

aos = AristotleClient(base_url="http://127.0.0.1:8181", token=os.environ["AOS_TOKEN"])

@tool
def send_email(to: str, body: str) -> str:
    """Send an email."""
    return _real_send(to, body)

@tool
def search_db(query: str) -> str:
    """Search customer records."""
    return _real_search(query)

aristotle_gate = aristotle_tool_call_wrapper(
    client=aos,
    ward_id="ward-agent-ops",
    subject="agent:assistant-1",
)

tool_node = ToolNode(
    tools=[send_email, search_db],
    wrap_tool_call=aristotle_gate,
)

graph = StateGraph(MessagesState)
graph.add_node("tools", tool_node)
# ... rest of your graph
```

Every tool call routed through `tool_node` becomes a `CanonicalAction` (`action_type: "tool.send_email"`, `tool.search_db`, ...), goes to the gate, and runs only on `ALLOW`. The returned `ToolMessage` carries either the tool's real output (ALLOW) or a structured `AristotleToolOutcome` JSON in `content` with `status="error"` (REFUSE / ESCALATE / gate failure).

## Decision mapping

| Aristotle Gate | What the wrapper returns | What the agent sees |
|---|---|---|
| `ALLOW` | invokes `execute(request)` and returns its `ToolMessage` / `Command` | tool runs normally |
| `REFUSE` | returns a `ToolMessage` with `status="error"` and structured outcome in `content` (default) — or raises `GateRefusal` with `on_refuse="raise"` | error tool result the LLM can incorporate, OR exception |
| `ESCALATE` | returns a `ToolMessage` with structured outcome (default) — or calls `langgraph.types.interrupt()` to pause the graph with `on_escalate="interrupt"` — or raises `GateEscalation` with `on_escalate="raise"` | error result OR graph pauses for human approval OR exception |
| Gate unreachable | raises the underlying `httpx`/`AristotleApiError` (default, fail-closed) — or returns `ToolMessage` with `on_error="tool_message"` | exception OR error result |

`AristotleToolOutcome` content shape (returned as the `ToolMessage.content` JSON string on non-ALLOW):

```json
{
  "__aristotle": "REFUSE",
  "tool_name": "send_email",
  "reason_codes": ["ACTION_DENIED", "PHYSICAL_INVARIANT_FAILED"],
  "message": "aristotle: REFUSE on send_email - ACTION_DENIED, ... - record rec-1",
  "gel_record_id": "rec-1",
  "warrant_id": null
}
```

## Mapping: tool call → CanonicalAction

By default, a LangGraph tool call becomes:

```python
{
  "action_id":    tool_call_id,                   # from ToolCallRequest.tool_call["id"]
  "ward_id":      <options.ward_id>,
  "subject":      <options.subject>,
  "action_type":  f"tool.{name.lower()}",
  "params":       <tool_call["args"] as dict>,
  "requested_at": <ISO now>,
  "telemetry":    {"agent_runtime": "langgraph"}
}
```

Customize:

- `action_type_prefix="agent.ops.tool"` — change the default `"tool"` prefix.
- `action_type_for=lambda name: "title.transfer" if name == "transfer_title" else f"tool.{name.lower()}"` — route specific tools into a vertical namespace.
- `build_action=lambda **kwargs: {...}` — take full control of the CanonicalAction shape.
- `passthrough_tools={"search_docs", "read_kb"}` — skip the gate for read-only tools.
- `on_decision(**info)` — telemetry callback (`tool_name`, `tool_input`, `action`, `decision`, `elapsed_ms`).

## Async (`awrap_tool_call`)

```python
from aristotle import AsyncAristotleClient
from aristotle_langgraph import aristotle_atool_call_wrapper

aos = AsyncAristotleClient(base_url="http://127.0.0.1:8181")

tool_node = ToolNode(
    tools=[send_email_async, search_db_async],
    awrap_tool_call=aristotle_atool_call_wrapper(
        client=aos, ward_id="ward-agent-ops", subject="agent:assistant-1",
    ),
)
```

Same options as the sync wrapper. Pass an `AsyncAristotleClient`; both the gate call and `await execute(request)` are awaited.

## Recipe — ESCALATE pauses the graph for human approval

LangGraph has a first-class `interrupt()` primitive. The wrapper can leverage it so an ESCALATE pauses the running graph and surfaces the decision to the host, which resumes via `Command(resume=...)`.

```python
gate = aristotle_tool_call_wrapper(
    client=aos, ward_id="...", subject="...",
    on_escalate="interrupt",
)

# In the host:
state = graph.invoke(initial_state, config)
for chunk in state.get("__interrupt__", []):
    payload = chunk.value
    if payload["kind"] == "aristotle.escalate":
        print(f"{payload['tool_name']}: {payload['reason_codes']}")
        # decide externally, then resume:
        graph.invoke(Command(resume={"approve": True}), config)
```

If the resume payload is `{"approve": True}` the wrapper calls `execute(request)` to run the tool; anything else is treated as a refusal.

## Recipe — route a vertical's tool calls through that vertical's authority

```python
gate = aristotle_tool_call_wrapper(
    client=aos,
    ward_id="ward-title-transaction-ops",
    subject="agent:title-orchestrator",
    action_type_for=lambda n:
        "title.transfer"     if n == "transfer_title" else
        "title.lien_release" if n == "release_lien" else
        f"tool.{n.lower()}",
)
```

Tools using this wrapper trip the Title vertical's `JURISDICTION_RULE_PRESETS`, NMVTIS pre-checks, dual-control rules, and demonstration-only warnings.

## Recipe — telemetry

```python
def on_decision(*, tool_name, tool_input, action, decision, elapsed_ms):
    metrics.gate_observed(tool=tool_name, ms=elapsed_ms, decision=decision.get("decision"))

gate = aristotle_tool_call_wrapper(client=aos, ward_id="w", subject="s", on_decision=on_decision)
```

## API

```python
from aristotle_langgraph import (
    aristotle_tool_call_wrapper,    # sync wrap_tool_call middleware
    aristotle_atool_call_wrapper,   # async awrap_tool_call middleware
    AristotleToolOutcome,           # structured outcome dataclass
    GateRefusal,                    # raised on REFUSE when on_refuse="raise"
    GateEscalation,                 # raised on ESCALATE when on_escalate="raise"
    AristotleLanggraphError,        # base class
)
```

## Notes

- **No compile-time langgraph dependency.** The wrappers import `langchain_core.messages.ToolMessage` (and `langgraph.types.interrupt`) lazily at runtime. Tests run against a structural dict fallback when those packages aren't installed.
- The `ToolCallRequest` shape is read structurally — both langchain's `ToolCall` `TypedDict` (`{"name", "args", "id", "type"}`) and a Pydantic model shape are supported.
- The same options surface used in `aristotle-crewai` and the four TS adapters (`@aristotle/claude-agents`, `@aristotle/langchain`, `@aristotle/openai-agents`, `@aristotle/vercel-ai`) works here unchanged.

## License

Proprietary. See `LICENSE` and `NOTICE`.
