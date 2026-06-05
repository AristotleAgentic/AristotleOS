# aristotle-semantic-kernel

**Govern Semantic Kernel function invocations with AristotleOS.**

```sh
pip install aristotle-semantic-kernel
pip install aristotle-semantic-kernel[semantic-kernel]
```

## Quickstart

Stack `@aristotle_governed` ABOVE `@kernel_function` (so SK metadata is set when the wrapper copies it):

```python
from semantic_kernel.functions import kernel_function
from aristotle import AristotleClient
from aristotle_semantic_kernel import aristotle_governed

aos = AristotleClient(base_url="http://127.0.0.1:8181")
govern = aristotle_governed(client=aos, ward_id="ward-ops", subject="agent:1")

class MyPlugin:
    @govern("send_email")
    @kernel_function(name="send_email", description="Send an email.")
    async def send_email(self, to: str, body: str) -> str:
        return await _real_send(to, body)
```

The wrapper preserves the function's signature AND any `__kernel_function_*` metadata attributes set by `@kernel_function`. Sync + async auto-detected.

Same decision mapping + options as the other adapters.

## License

Proprietary. See `LICENSE` and `NOTICE`.
