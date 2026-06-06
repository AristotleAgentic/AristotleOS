# aristotle-pydantic-ai

**Govern Pydantic AI tool calls with AristotleOS.** Three integration shapes that route every tool invocation through the AristotleOS Commit Gate before it runs.

```sh
pip install aristotle-pydantic-ai
pip install aristotle-pydantic-ai[pydantic-ai]   # also installs pydantic-ai
```

## Quickstart — decorator factory

```python
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

@agent.tool_plain
@govern("search_db")
def search_db(query: str) -> str:
    return _real_search(query)
```

## Quickstart — wrap a function

```python
from aristotle_pydantic_ai import govern_tool_function

@agent.tool_plain
def send_email(to: str, body: str) -> str:
    return _real_send(to, body)

send_email = govern_tool_function(
    send_email, name="send_email", client=aos, ward_id="ward-ops", subject="agent:1"
)
```

## Quickstart — wrap a `Tool` instance

```python
from pydantic_ai.tools import Tool
from aristotle_pydantic_ai import govern_pydantic_ai_tool

tool = Tool(my_func, name="send_email")
governed = govern_pydantic_ai_tool(tool, client=aos, ward_id="...", subject="...")
agent = Agent("openai:gpt-4o", tools=[governed])
```

## Decision mapping

| Aristotle Gate | Wrapper returns / raises |
|---|---|
| `ALLOW` | invokes the wrapped function, returns its output |
| `REFUSE` | returns refusal message (default) or raises `GateRefusal` with `on_refuse="raise"` |
| `ESCALATE` | returns escalation message (default) or raises `GateEscalation` with `on_escalate="raise"` |
| Gate unreachable | raises (default) or returns error message with `on_error="return_message"` |

## RunContext handling

When using `@agent.tool` (not `tool_plain`), the first arg is a `RunContext`. The wrapper detects this and strips it from the gate's view of `params` so the canonical action only carries the actual tool arguments.

## Customizable mapping

Identical to the other six adapters: `action_type_prefix`, `action_type_for`, `build_action`, `passthrough`, `on_decision`, plus the per-adapter `on_refuse`/`on_escalate`/`on_error` knobs.

## License

Apache-2.0. See `LICENSE` and `NOTICE`.
