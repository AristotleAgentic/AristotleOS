# aristotle-autogen

**Govern AutoGen tool calls with AristotleOS.** Wraps the function before it goes into `FunctionTool`, so AutoGen's schema introspection sees a normal function and every invocation routes through the Commit Gate.

```sh
pip install aristotle-autogen
pip install aristotle-autogen[autogen]
```

## Quickstart

```python
from autogen_core.tools import FunctionTool
from aristotle import AristotleClient
from aristotle_autogen import govern_autogen_function

aos = AristotleClient(base_url="http://127.0.0.1:8181")

async def send_email(to: str, body: str) -> str:
    return await _real_send(to, body)

governed = govern_autogen_function(send_email, name="send_email", client=aos, ward_id="w", subject="agent:1")
tool = FunctionTool(governed, description="Send an email")
```

Or via the decorator factory:

```python
from aristotle_autogen import aristotle_governed

govern = aristotle_governed(client=aos, ward_id="w", subject="agent:1")

@govern("send_email")
async def send_email(to: str, body: str) -> str: ...

tool = FunctionTool(send_email, description="Send an email")
```

Same decision mapping and options as the other six adapters.

## License

Apache-2.0. See `LICENSE` and `NOTICE`.
