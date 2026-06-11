# aristotle-llamaindex

**Govern LlamaIndex tool calls with AristotleOS.**

```sh
pip install aristotle-llamaindex
pip install aristotle-llamaindex[llamaindex]
```

## Quickstart

```python
from llama_index.core.tools import FunctionTool
from aristotle import AristotleClient
from aristotle_llamaindex import govern_tool_function

aos = AristotleClient(base_url="http://127.0.0.1:8181")

def search_db(query: str) -> str:
    return _real_search(query)

governed = govern_tool_function(search_db, name="search_db", client=aos, ward_id="w", subject="agent:1")
tool = FunctionTool.from_defaults(fn=governed, name="search_db")
```

Or wrap a constructed FunctionTool:

```python
from aristotle_llamaindex import govern_llamaindex_tool

tool = FunctionTool.from_defaults(fn=search_db, name="search_db")
tool = govern_llamaindex_tool(tool, client=aos, ward_id="w", subject="agent:1")
```

Same decision mapping and options as the other adapters.

## License

Apache-2.0. See `LICENSE` and `NOTICE`.
