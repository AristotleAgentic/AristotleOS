# Framework Adapters

AristotleOS governs action requests, not one AI framework.

Examples live in `examples/framework-adapters`:

- OpenAI-style tool calls
- Anthropic-style tool use
- LangChain tool wrapper
- AutoGen/CrewAI-style pre-tool hook
- MCP tool call
- Plain HTTP API mutation
- Kubernetes deployment action
- Drone/robotics action

Each example follows the same contract:

1. Translate framework intent into an AristotleOS action intent.
2. Call the Governance Plane before execution.
3. Execute only when the decision is `PERMIT`.
4. Require a warrant for consequential action.
5. Preserve the GEL record for replay and audit.
