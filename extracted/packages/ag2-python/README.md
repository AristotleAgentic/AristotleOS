# aristotle-ag2

**Govern AG2 tool calls with AristotleOS.** AG2 is the community fork of Microsoft AutoGen and shares the same tool-registration API. This package is a thin AG2-native sibling of `aristotle-autogen` — same surface, AG2 telemetry tag.

```sh
pip install aristotle-ag2
pip install aristotle-ag2[ag2]
```

## Quickstart

```python
from aristotle import AristotleClient
from aristotle_ag2 import aristotle_governed

aos = AristotleClient(base_url="http://127.0.0.1:8181")
govern = aristotle_governed(client=aos, ward_id="w", subject="agent:1")

@govern("send_email")
async def send_email(to: str, body: str) -> str:
    return await _real_send(to, body)

# Register with your AG2 ConversableAgent:
# agent.register_for_llm()(send_email)
# agent.register_for_execution()(send_email)
```

Same decision mapping + options as the other adapters.

## License

Proprietary. See `LICENSE` and `NOTICE`.
