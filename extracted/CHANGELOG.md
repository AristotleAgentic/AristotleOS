# Changelog

## v0.1.55 - Verticals Registry UI (all 15 verticals visible in console-ui)
- **New Verticals section** in the operator console showing every
  industry vertical on the branch (15 total) in one place. Closes the
  gap where only Title had a dedicated panel.
- **`verticals/registry.ts`** -- static VerticalConfig registry with
  id, name, regulatory framing, purpose, citation chips, typed adapter
  rows, hard-interlock action types, demonstration preset states, test
  surface, hasDedicatedConsole flag.
- **`VerticalsRegistryConsole.tsx`** -- grid of all 15 cards with
  icons, regulatory framing, adapter/interlock/preset counts; hero KPIs;
  guarantees panel; pre-coordination disclaimer.
- **`VerticalDetailConsole.tsx`** -- generic detail view for verticals
  without a dedicated *OpsConsole (aviation, mining, pipeline, robotics,
  space, swarm). Tables for adapter boundaries, hard interlocks
  (red-bordered chips), demonstration presets; evidence + tests panel.
- **Click routing**: registry cards go to dedicated *OpsConsole when
  available (9 of 15: fleet, grid, healthcare, logistics, port, rail,
  noc=telecom, title, water), generic detail view otherwise.
- **store.ts**: SectionId += "verticals" | "vertical-detail";
  selectedVerticalId state + selectVertical action.
- **CommandCenter.tsx**: NAV entry (LayoutGrid icon between Title and
  Adopt), SECTION_META entries, switch cases.
- **Verified**: console-ui tsc --noEmit clean; governance-core 41/41,
  execution-control-runtime 75/75 (no regressions).

## v0.1.54 - Space launch vertical (15th industry vertical)
- **New `space` vertical** on the shared branch -- 15th vertical
  alongside automotive, aviation, grid, healthcare, logistics, mining,
  pipeline, port, rail, robotics, swarm, telecom, title, water.
  Covers consequential launch, range-safety, FTS, propellant, ignition,
  payload-deploy, and downrange-asset actions.
- **Regulatory framing** (alignment, not substitution): 14 CFR Part 450,
  Part 415/417, FAA AST license + permit conditions, USSF SLD-30 /
  SLD-45 range safety, NASA NPR 8715.5, ITAR USML Cat IV + XV, EAR,
  FCC Part 25/87, ITU radio licensing, UN Outer Space Treaty +
  Registration + Liability Convention.
- **`space.ts` runtime module**: SPACE_ADAPTER_CATALOG (13 typed
  boundaries), SPACE_JURISDICTION_RULE_PRESETS for CCSFS / Vandenberg /
  Wallops / Starbase / Kodiak / Mojave (all `demonstration_only: true`),
  SpaceRuntimeSnapshot, adapter request types + builders for each
  family, evaluateSpaceSafetyInvariants, exportSpaceEvidenceBundle /
  verifySpaceEvidenceBundle.
- **`index.ts` wiring**: 16 new space-specific `physical_bounds` fields,
  hard interlocks at gate level for space.disable_flight_termination /
  fts.disable, space.override_range_safety, space.bypass_collision_avoidance,
  space.ignite_outside_window, space.bypass_wind_limits,
  space.override_propellant_limits, space.bypass_pad_interlocks,
  space.payload_deploy_outside_primary.
- **Naming**: avoided collisions with aviation/title --
  PayloadRequest -> SpacePayloadRequest, payloadToAction ->
  spacePayloadToAction, JURISDICTION_RULE_PRESETS ->
  SPACE_JURISDICTION_RULE_PRESETS.
- **space.test.ts 12/12 pass**: canonical action builders, ALLOW path,
  REFUSE on range-not-clear / wind / FTS-not-armed, 4 hard-interlock
  refusals, dual-control ignite (ESCALATE without approvals, ALLOW with
  two), Evidence Bundle round-trip + tamper detection.
- **Examples**: ward.ccsfs_launch_ops.yaml,
  authority_envelope.launch_orchestrator.yaml, policy APL,
  3 sample actions (allow_propellant_load, refuse_wind_over_limit,
  refuse_disable_fts).
- **Docs**: docs/space.md + space-ward-templates.md +
  space-threat-model.md, each with the explicit demonstration-only
  disclaimer + production-onboarding checklist (per-range coordination,
  AST licensee approval, signed LoA).
- **DEMONSTRATION ONLY** at every surface: presets have NOT been
  coordinated with FAA AST, USSF SLD-30/45, NASA range safety, or
  counsel. Real deployments require promotion past `rule_validation_state:
  "demonstration"`.
- **No regressions**: governance-core 41/41, execution-control 75/75,
  title 22/22. Space 12/12 brings branch-wide test count to **327, 0
  failures**.

## v0.1.53 - Ultimate mode: 7 framework adapters in one batch
- **Faramesh framework coverage closes from 6/14 -> 13/14 explicit + 1
  via MCP.** Gap -7 -> -1 (only Anthropic Claude Code is left, which is
  effectively covered already via the existing @aristotle/claude-agents
  adapter — Claude Code's tool runtime is a superset of the Agent SDK's
  hook surface). The pattern is empirically proven runtime- and
  SDK-agnostic across 13 explicit integrations.
- **Seven new adapters land together in this batch**:
  1. `aristotle-pydantic-ai` (Python, 12/12 tests) — decorator factory
     stacked above @agent.tool/tool_plain; RunContext first-arg
     auto-stripped from gate params.
  2. `aristotle-autogen` (Python, 10/10 tests) — wraps function before
     FunctionTool(func, description=...).
  3. `aristotle-semantic-kernel` (Python, 9/9 tests) — preserves
     __kernel_function_* metadata attributes; stack ABOVE
     @kernel_function.
  4. `aristotle-llamaindex` (Python, 9/9 tests) — wraps fn AND async_fn
     in FunctionTool.from_defaults.
  5. `@aristotle/bedrock` (TS, 11/11 tests) — makeBedrockToolDispatcher
     for Converse-API toolUse blocks. AWS SDK is NOT a peer.
  6. `aristotle-ag2` (Python, 9/9 tests) — thin AG2 sibling of
     aristotle-autogen with ag2 telemetry tag.
  7. `@aristotle/mastra` (TS, 12/12 tests) — wraps Tool.execute.
     Passthrough preserves tool IDENTITY for SDK identity checks.
- **Same options surface across all 13 adapters**: `client`, `wardId`,
  `subject`, `actionTypePrefix`, `actionTypeFor(name)`, `buildAction`,
  `passthrough(_tools)`, `onDecision`, plus per-adapter
  `on{Refuse,Escalate,Error}` defaults that match each SDK's idiomatic
  error model.
- **Cross-runtime + cross-SDK proof now complete**:
  - 7 TS adapters: claude-agents, langchain, openai-agents, vercel-ai,
    bedrock, mastra, plus @aristotle/os-cli for the gate boundary
  - 7 Python adapters: os-sdk + crewai + langgraph + pydantic-ai +
    autogen + semantic-kernel + llamaindex + ag2
- **Verified test counts** (running each package's test script
  individually then in a single sweep): pydantic-ai 12, autogen 10,
  semantic-kernel 9, llamaindex 9, bedrock 11, ag2 9, mastra 12 = 72
  new tests pass in this batch. Combined with pre-existing:
  governance-core 41, execution-control 75, TS os-sdk 15, claude-agents
  13, langchain 14, openai-agents 13, vercel-ai 13, Python os-sdk 20,
  crewai 24, langgraph 15. **Grand total 315 across all suites on the
  branch (no regressions).** Note: the 22-test title vertical suite
  (title.test.ts) is exercised as part of execution-control's 75-test
  scope; not separately counted.
- **Packaging consistency**: every package ships Apache-2.0 with
  LICENSE + NOTICE; py.typed marker for Python; publishConfig.access
  public for TS; sideEffects:false; engines.node:>=18 for TS;
  Python 3.9+ for the Python packages.

## v0.1.52 - LangGraph integration (aristotle-langgraph, Python)
- **Sixth agent-framework integration ships, SECOND Python adapter.**
  Faramesh framework coverage now 6/14 explicit (Claude Agent SDK,
  LangChain.js, OpenAI Agents SDK, CrewAI, Vercel AI SDK, LangGraph) +
  1 via MCP. Gap -8 -> -7. Python side now 2 adapters (CrewAI + LangGraph)
  alongside 4 TS adapters.
- **`aristotle_tool_call_wrapper(client=..., ward_id=..., subject=..., ...)
  -> Callable`** builds a sync ``wrap_tool_call`` middleware suitable for
  LangGraph's ``ToolNode``. Plug it straight into
  ``ToolNode(tools=[...], wrap_tool_call=aristotle_gate)`` — no
  monkey-patching, no shadow tools. Uses LangGraph 0.2.x's FIRST-CLASS
  middleware seam.
- **`aristotle_atool_call_wrapper(client=AsyncAristotleClient, ...) ->
  Callable[..., Awaitable]`** is the async counterpart for
  ``awrap_tool_call``. Both gate call and inner ``execute(request)`` are
  awaited.
- **Type signatures verified against the installed langgraph package**
  (langgraph.prebuilt.tool_node):
  - ``ToolCallRequest`` fields: ``tool_call`` (langchain ToolCall dict),
    ``tool`` (BaseTool | None), ``state`` (Any), ``runtime``
    (ToolRuntime).
  - ``ToolCallWrapper`` signature: ``Callable[[ToolCallRequest,
    Callable[[ToolCallRequest], ToolMessage | Command]], ToolMessage |
    Command]`` — confirmed by reading the runtime ``_CallableGenericAlias``.
  - ``AsyncToolCallWrapper`` signature: same shape with awaitables.
  - ``interrupt()`` from ``langgraph.types`` for human-in-the-loop pause.
- **Decision mapping**:
  - ``ALLOW``     -> invokes ``execute(request)`` and returns its
    ``ToolMessage`` / ``Command`` unchanged
  - ``REFUSE``    -> returns a ``ToolMessage`` with ``status="error"``
    and structured ``AristotleToolOutcome`` JSON in ``content`` (default)
    OR raises ``GateRefusal`` with ``on_refuse="raise"``
  - ``ESCALATE``  -> returns ``ToolMessage`` (default) OR calls
    ``langgraph.types.interrupt()`` to pause the graph with
    ``on_escalate="interrupt"`` (resume with ``{"approve": True}`` to
    admit) OR raises ``GateEscalation`` with ``on_escalate="raise"``
  - Gate unreachable -> raises the underlying exception (default,
    fail-closed) OR returns ``ToolMessage`` with
    ``on_error="tool_message"``
- **`interrupt` mode** is the unique LangGraph-specific feature: ESCALATE
  pauses graph execution and surfaces a payload to the host; the host
  resumes with ``Command(resume={"approve": True})`` to admit the tool
  call or anything else to refuse. Maps Aristotle's dual-control
  semantics onto LangGraph's first-class human-in-the-loop primitive.
- **`AristotleToolOutcome`** (new dataclass): ``kind`` ("REFUSE" |
  "ESCALATE" | "GATE_UNREACHABLE"), ``tool_name``, ``reason_codes``,
  ``message``, ``gel_record_id``, ``warrant_id``. Serializes to JSON for
  inclusion in ``ToolMessage.content``.
- **Errors**: ``AristotleLanggraphError`` base + ``GateRefusal``,
  ``GateEscalation`` subclasses carrying ``tool_name``, ``reason_codes``,
  ``gel_record_id``, and full decision dict.
- **Customizable mapping identical to the other adapters**:
  ``action_type_prefix``, ``action_type_for``, ``build_action``,
  ``passthrough_tools``, ``on_decision``.
- **Argument extraction**: reads ``tool_call`` structurally — both
  langchain's ``ToolCall`` TypedDict (``{"name", "args", "id", "type"}``)
  and a Pydantic model shape are supported.
- **Tests (15/15 pass)**:
  - ALLOW invokes inner execute and returns its output
  - REFUSE returns ToolMessage with status="error" + structured outcome;
    inner never runs
  - REFUSE raises GateRefusal when ``on_refuse="raise"``
  - ESCALATE returns ToolMessage by default with structured outcome
  - ESCALATE raises GateEscalation when configured
  - Gate-unreachable raises by default (fail-closed)
  - Gate-unreachable returns ToolMessage when ``on_error="tool_message"``
  - ``passthrough_tools`` skips the gate entirely
  - ``action_type_for`` routes specific tools into vertical namespace
  - ``build_action`` overrides the canonical action shape
  - ``on_decision`` telemetry fires with elapsed_ms and verdict
  - Constructor refuses missing required options
  - Async: ALLOW awaits inner execute
  - Async: REFUSE returns ToolMessage by default
  - Async: REFUSE raises when configured
  All tests run WITHOUT installing langgraph or langchain-core — they
  use a structural dict fallback for ToolMessage that the wrapper
  produces when langchain isn't importable.
- **Packaging**:
  - dependencies: aristotle-os-sdk>=0.1.0
  - optional-dependencies.langgraph: langgraph>=0.2,<2.0,
    langchain-core>=0.3,<1.0
  - LICENSE + NOTICE via PEP 639 license-files
  - py.typed marker
  - Wheel: 8 entries, LICENSE + NOTICE under dist-info/licenses/
- **README**: install + quickstart + decision-mapping table + canonical
  mapping table + async section + three recipes (interrupt-mode HIL
  approval; vertical routing; telemetry) + API reference + notes +
  Apache-2.0 footer.
- **Cross-runtime symmetry strengthened**: same options surface across
  4 TS adapters + 2 Python adapters. The pattern is proven generic.
- **No regressions**: governance-core 51/51, execution-control 75/75,
  TS os-sdk 15/15, claude-agents 13/13, langchain 14/14, openai-agents
  13/13, vercel-ai 13/13 = 194 TS tests. Python: os-sdk 20/20 + crewai
  24/24 + langgraph 15/15 = 59 Python tests.
  **Total 275/275 across all suites on the branch.**

## v0.1.51 - Vercel AI SDK integration (@aristotle/vercel-ai)
- **Fifth agent-framework integration ships, third TS adapter, fourth
  active framework on the JS side.** Faramesh framework coverage now
  5/14 explicit (Claude Agent SDK, LangChain.js, OpenAI Agents SDK,
  CrewAI, Vercel AI SDK) + 1 via MCP. Gap −9 -> −8.
- **`governTool(name, tool, options)` and `governTools(tools, options)`**:
  wrap a single tool or an entire `tools` record passed to `generateText`
  / `streamText` / `Agent`. The wrapper replaces `tool.execute` so every
  invocation routes through the Aristotle Commit Gate before running.
  Pure tools (no `execute`, e.g. provider-defined ones) are passed
  through unchanged. Every other field on the tool (`description`,
  `title`, `inputSchema`, `metadata`, `providerOptions`, `needsApproval`,
  `toModelOutput`) is preserved.
- **Vercel-AI-specific design choice**: in the Vercel AI SDK the tool's
  NAME comes from the record key in `tools: { name: tool({...}) }`,
  NOT from a field on the tool itself. `governTool` therefore takes
  the name as the first argument; `governTools` extracts it from the
  record keys automatically — almost all users want the second.
- **Decision mapping**:
  - `ALLOW`    -> invokes the wrapped `execute` and returns its output
  - `REFUSE`   -> returns `AristotleToolOutcome` (default) or throws
    `AristotleGateError("REFUSE", ...)` with `onRefuse: "throw"`
  - `ESCALATE` -> returns `AristotleToolOutcome` (default) or throws
    `AristotleGateError("ESCALATE", ...)` with `onEscalate: "throw"`
  - Gate unreachable -> throws `AristotleGateError("GATE_UNREACHABLE", ...)`
    (default, fail-closed -- prevents a downed gate from letting the
    model invent its own answer) or returns outcome with
    `onError: "return-error"`
  - The default for `onRefuse` / `onEscalate` is `return-error` because
    the AI SDK serializes the returned outcome back to the model as a
    structured `tool-result` part, which the model can reason about
    more usefully than a generic `tool-error`. The default for
    `onError` is `throw` so a downed gate fails closed instead.
- **AristotleToolOutcome** (new type returned on REFUSE/ESCALATE/error
  by default): discriminated union with `__aristotle: "REFUSE" |
  "ESCALATE" | "GATE_UNREACHABLE"`, `toolName`, `reasonCodes`,
  `message`, `gelRecordId`, `warrantId`. Lets the agent's reply code
  detect Aristotle decisions explicitly.
- **AristotleGateError** (new error class for throw mode): carries
  `kind`, `toolName`, `reasonCodes`, `gelRecordId`, the full
  `EvaluateResponse`. Surfaced via the SDK's `tool-error` part.
- **Customizable mapping identical to the other four adapters**:
  `actionTypePrefix`, `actionTypeFor(name)`, `buildAction({...})`,
  `passthroughTools`, `onDecision({...})`.
- **Type signatures verified against installed @ai-sdk/provider-utils
  d.ts files**: `Tool<INPUT, OUTPUT>` with `description?`, `title?`,
  `inputSchema`, `execute?`, `needsApproval?`, `toModelOutput?`,
  `metadata?`, `providerOptions?`, plus `ToolExecutionOptions` with
  `toolCallId`, `messages`, `abortSignal`, `experimental_context`.
  Adapter defines structural types locally so it compiles without `ai`
  installed -- forward-compatible with the documented public surface.
- **Tests (13/13 pass)**:
  - ALLOW invokes inner and returns its output unchanged
  - REFUSE returns a structured AristotleToolOutcome by default;
    inner execute never runs
  - REFUSE throws AristotleGateError when onRefuse:'throw'
  - ESCALATE returns outcome by default; throws when configured
  - Gate-unreachable throws by default (fail-closed);
    onError:'return-error' returns outcome instead
  - passthroughTools returns the original tool unchanged (gate not
    called); the wrapper's identity check confirms it's the SAME
    object, so SDK identity comparisons keep working
  - actionTypeFor routes specific tools into a vertical namespace
  - buildAction takes full control over the canonical action shape
  - onDecision telemetry fires with verdict and elapsedMs
  - Non-object input (string, number) normalizes into
    `params: { input: value }` (matches CrewAI's normalization)
  - governTools wraps every tool in the record using the same options
  - A tool with no execute (e.g. provider-defined) is returned
    unchanged
  - Constructor refuses missing required options
- **Packaging**:
  - `dependencies`: `@aristotle/os-sdk` (workspace)
  - `peerDependencies`: `ai` (>=5.0.0 <7.0.0, optional)
  - LICENSE + NOTICE copied into the package
  - `npm pack --dry-run`: 8 files, ~45 kB tarball
    (LICENSE, NOTICE, README, dist/index.{js,d.ts} + source maps,
    package.json)
  - `publishConfig.access: public`, `engines.node: >=18`,
    `sideEffects: false`
- **README**: install + 2 quickstarts (wrap the whole tools record;
  wrap a single tool) + decision-mapping table + canonical mapping
  table + four recipes (vertical routing, handling outcomes in the
  agent's reply, telemetry, streaming + agent loops) + exports +
  notes + Apache-2.0 footer.
- **Cross-language symmetry now stronger**: 4 TS adapters
  (claude-agents, langchain, openai-agents, vercel-ai) + 1 Python
  adapter (crewai), all sharing the same options surface
  (`client`, `wardId`, `subject`, `actionTypeFor`, `buildAction`,
  `passthroughTools`, `onDecision`, plus per-adapter
  `on{Refuse,Escalate,Error}` defaults that match each SDK's
  idiomatic error model).
- **No regressions**: governance-core 51/51, execution-control 75/75,
  TS os-sdk 15/15, claude-agents 13/13, langchain 14/14,
  openai-agents 13/13, vercel-ai 13/13 = 194 TS tests.
  Python: os-sdk 20/20 + crewai 24/24 = 44 Python tests.
  **Total 238/238 across all suites on the branch.**

## v0.1.50 - CrewAI integration (aristotle-crewai, Python)
- **Fourth agent-framework integration ships, and the FIRST Python adapter.**
  Faramesh framework coverage now 4/14 explicit (Claude Agent SDK, LangChain.js,
  OpenAI Agents SDK, CrewAI) + 1 via MCP. Proves the canonical-action
  pattern works in BOTH JS and Python runtimes — same shape, same
  decision mapping, same vertical-routing recipe.
- **Lives at `packages/crewai-python/` as `aristotle-crewai`** on PyPI.
  Apache-2.0. No compile-time dependency on `crewai` — the wrappers are
  pure Python and exercise the gate via `aristotle-os-sdk`. CrewAI is an
  optional extra (`pip install aristotle-crewai[crewai]`).
- **Three integration shapes** (matches how Python users actually wire
  governance into existing tools):
  - `govern_run(inner_run, *, name, client, ...) -> Callable` — wrap any
    CrewAI `BaseTool._run` callable. Returns a same-signature callable.
    Easiest path: `tool._run = govern_run(tool._run, name=tool.name, ...)`.
  - `govern_arun(inner_arun, *, name, client, ...)` — async variant for
    `_arun`. Expects `AsyncAristotleClient`.
  - `govern_crewai_tool(tool, *, client, ...) -> tool` — wraps a CrewAI
    `BaseTool` INSTANCE and returns a same-shape governed twin
    (dynamic subclass of `type(tool)`, preserves `name` / `description`
    / `args_schema`). Useful for third-party tools you didn't author.
    The original instance is left UNTOUCHED (proven by test) so the
    same registry can be used for governed and ungoverned runs.
- **Decision mapping**:
  - `ALLOW` -> invokes the wrapped `_run` and returns its output
  - `REFUSE` -> returns refusal message (default) or raises `GateRefusal`
    (`on_refuse="raise"`)
  - `ESCALATE` -> returns escalation message (default) or raises
    `GateEscalation` (`on_escalate="raise"`)
  - Gate unreachable -> raises (default) or returns error message
    (`on_error="return_message"`)
- **Customizable mapping identical to the JS adapters**:
  - `action_type_prefix` — default `"tool"`
  - `action_type_for(name)` — vertical routing
    (e.g. `"transfer_title"` -> `"title.transfer"`)
  - `build_action(**kwargs)` — full CanonicalAction control
  - `passthrough` (or `passthrough_tools={...}`) — skip the gate for
    read-only / safe tools
  - `on_decision(**info)` — telemetry callback
- **Argument normalization**: CrewAI's `_run(*args, **kwargs)` is
  normalized into the action's `params` field: pure kwargs -> dict;
  single positional -> `{"input": arg}`; multiple positional -> `{"_args": [...]}`.
- **Errors**: new `AristotleCrewaiError` base + `GateRefusal` and
  `GateEscalation` subclasses carrying `tool_name`, `reason_codes`,
  `gel_record_id`, and the full decision dict for inspection.
- **Tests (24/24 pass)**, split across two files:
  - `test_govern_run.py` (17 tests):
    - ALLOW invokes inner and returns its output
    - REFUSE returns message by default, inner never runs
    - REFUSE raises `GateRefusal` when `on_refuse="raise"`
    - ESCALATE returns message by default
    - ESCALATE raises `GateEscalation` when configured
    - Gate-error raises `AristotleApiError` by default
    - Gate-error returns message when `on_error="return_message"`
    - `passthrough=True` skips the gate entirely
    - `action_type_for` routes specific tools into a vertical
    - `build_action` overrides the canonical action shape
    - `on_decision` telemetry fires with `elapsed_ms` and verdict
    - Constructor refuses missing required options
    - Positional single arg normalizes into `params={"input": ...}`
    - Async: `govern_arun` ALLOW awaits inner and returns
    - Async: `govern_arun` REFUSE returns message by default
    - Async: `govern_arun` REFUSE raises when configured
  - `test_govern_crewai_tool.py` (7 tests, against a Pydantic-shaped
    fake of CrewAI's BaseTool so tests run WITHOUT installing CrewAI):
    - Governed tool preserves `name` / `description` / `args_schema`
    - Governed tool is an instance of the original class
      (so the CrewAI runtime recognizes it as a tool)
    - `_run` calls inner on ALLOW
    - `_run` returns refusal message on REFUSE
    - `_run` raises on REFUSE when configured
    - `passthrough_tools` set skips the gate for named tools
    - `action_type_for` routes vertical namespace
    - Original tool instance is unchanged
- **Packaging**:
  - `dependencies`: `aristotle-os-sdk>=0.1.0`
  - `optional-dependencies.crewai`: `crewai>=0.40,<2.0`
  - `optional-dependencies.dev`: `pytest`, `pytest-asyncio`, `pydantic`
  - LICENSE + NOTICE shipped via PEP 639 `license-files = ["LICENSE", "NOTICE"]`
  - Wheel inspection: 8 entries, including the `py.typed` marker;
    LICENSE + NOTICE under `dist-info/licenses/` (PEP 639 placement)
- **README**: install + 2 quickstarts (wrap your own tool's `_run`;
  wrap a third-party tool you didn't author) + decision-mapping table
  + async (`govern_arun`) example + three recipes (vertical routing,
  passthrough read-only tools, telemetry) + full API reference +
  Notes (no compile-time CrewAI dep; the wrappers work against ANY
  Pydantic v2 BaseTool, proven by structural-fake tests) + Apache-2.0
  footer.
- **Cross-language symmetry now proven**: the same options dict shape
  works in TS (`@aristotle/claude-agents`, `@aristotle/langchain`,
  `@aristotle/openai-agents`) and Python (`aristotle-crewai`). The
  remaining 10 frameworks follow this exact pattern.
- **No regressions**: governance-core 51/51, execution-control 75/75,
  TS os-sdk 15/15, claude-agents 13/13, langchain 14/14,
  openai-agents 13/13 = 181 TS tests. Python: os-sdk 20/20 + crewai
  24/24 = 44 Python tests.

## v0.1.49 - OpenAI Agents SDK integration (@aristotle/openai-agents)
- **Third agent-framework integration ships.** Faramesh framework
  coverage now 3/14 explicit (Claude Agent SDK, LangChain.js,
  OpenAI Agents SDK) — the three anchor TypeScript agent frameworks
  in market — plus MCP-over-stdio reachable from Claude Code, Cursor,
  Zed, etc.
- **`aristotleToolInputGuardrail(options)` returns a real
  `ToolInputGuardrailDefinition`** matching the OpenAI Agents SDK's
  first-class guardrail primitive from `@openai/agents-core@0.11.x`.
  Type signatures verified against the installed `.d.ts` files —
  `ToolGuardrailBehavior`, `ToolGuardrailFunctionOutput`,
  `ToolInputGuardrailData`, `SdkFunctionCall` are all defined locally
  to match the SDK structurally, so the adapter compiles without the
  peer.
- **Decision mapping using the SDK's own behavior union**:
  - `ALLOW`    → `{ type: "allow" }` + `outputInfo: { warrantId,
    gelRecordId }` so they show up in the agent run trace
  - `REFUSE`   → `{ type: "rejectContent", message: "..." }` carrying
    the gate's reason_codes; agent sees a structured refusal it can
    incorporate
  - `ESCALATE` → `{ type: "rejectContent", message: "..." }`
    (default) or `{ type: "throwException" }` with
    `onEscalate: "throwException"`
  - Gate unreachable → `{ type: "rejectContent", message: "..." }`
    (default, fail-closed) or `{ type: "throwException" }` with
    `onError: "throwException"`
- **No monkey-patching, no tool wrapping.** Plugs into the SDK's
  first-class `toolInputGuardrails: [...]` option on each tool — fully
  traced by the SDK's runtime, visible in the run history.
- **JSON-argument parsing**: the SDK's `FunctionCallItem.arguments`
  is a JSON-encoded string; the adapter parses it back into a
  `Record<string, unknown>` for the canonical action's `params`.
  Non-JSON arguments (legacy / freeform) are normalized into
  `params: { input: "..." }` (proven by test).
- **Customizable mapping** identical to the other two adapters:
  `guardrailName`, `actionTypePrefix`, `actionTypeFor(toolName)`,
  `buildAction({...})`, `passthroughTools`, `onDecision({...})`.
- **Reusable across tools**: the guardrail is stateless; build it once
  and spread it into every tool's `toolInputGuardrails: [gate]`.
- **Packaging**:
  - `dependencies`: `@aristotle/os-sdk` (workspace)
  - `peerDependencies`: `@openai/agents` (>=0.11.0 <1.0.0, optional)
  - LICENSE + NOTICE copied into the package
  - `npm pack --dry-run`: 8 files, ~42 kB tarball (LICENSE, NOTICE,
    README, dist/index.{js,d.ts} + source maps, package.json)
  - `publishConfig.access: public`, `engines.node: >=18`,
    `sideEffects: false`
- **Tests (13/13 pass)**:
  - ALLOW returns `behavior: "allow"` with warrant + GEL record id
    in outputInfo
  - REFUSE returns `behavior: "rejectContent"` with reason codes
  - ESCALATE returns `behavior: "rejectContent"` by default
  - `onEscalate: "throwException"` raises the runner instead
  - Custom actionTypeFor routes into vertical namespaces
  - buildAction overrides the canonical-action shape (and receives the
    agent name from `data.agent`)
  - passthroughTools skips the gate call entirely
  - onDecision telemetry fires with elapsedMs and the verdict
  - Gate-unreachable defaults to fail-closed rejectContent
  - `onError: "throwException"` raises the runner on gate failure
  - Non-JSON tool arguments normalize into `params: { input: ... }`
  - Resulting guardrail has the right name, type, run function
  - Constructor refuses missing required options
- **README**: install + working `tool({...})` + `Agent({...})` +
  `Runner.run(...)` example + decision-mapping table + canonical
  mapping table + three recipes (vertical routing, escalation
  handling at the agent level, telemetry) + exports + Apache-2.0
  footer.
- **No regressions**: governance-core 51/51, execution-control 75/75,
  TS os-sdk 15/15, claude-agents 13/13, langchain 14/14, openai-agents
  13/13 = 181/181. Python SDK 20/20 unaffected.

## v0.1.48 - LangChain.js integration (@aristotle/langchain)
- **Second agent-framework integration ships.** LangChain.js is the
  single biggest agent framework in market; closing it after the
  Claude Agent SDK was the highest-leverage next gap. The
  Faramesh-style "14 framework integrations" coverage column moves
  from 1/14 to 2/14, and the pattern is now demonstrably reusable
  across frameworks (not Claude-specific).
- **`governTool(tool, options)` + `governTools(tools, options)`** wrap
  any LangChain.js tool (the value returned by `tool()`, a
  `StructuredTool` subclass, or any `{ name, description, invoke }`)
  with a governance check on `invoke()`. The original tool is NEVER
  mutated; a new object is returned with the same shape and a wrapped
  invoke method.
- **Decision mapping** (proven by tests):
  - `ALLOW` → underlying tool's `invoke(input, config)` runs with the
    original input + config; warrant id available via `onDecision`
  - `REFUSE` → throws `ToolGovernanceError` carrying `toolName`,
    `action`, `reasonCodes`, `gelRecordId`; the underlying tool
    NEVER runs
  - `ESCALATE` → throws `ToolEscalationError` (default); or with
    `onEscalate: "return"` returns a marker string so the agent
    itself sees a structured response; the underlying tool NEVER runs
  - Gate unreachable → `ToolGovernanceError` (fail-closed default);
    opt into `onError: "escalate"` or `onError: "throw"` for other
    behaviors
- **Two exported error classes** so consumers can write idiomatic
  `try { ... } catch (err) { if (err instanceof ToolEscalationError)
  ... }` blocks at the AgentExecutor level:
  - `ToolGovernanceError` (REFUSE; gate said no)
  - `ToolEscalationError` (ESCALATE; route to dual-control)
- **Customizable mapping** identical to the Claude adapter:
  `actionTypePrefix`, `actionTypeFor(toolName)`, `buildAction({...})`,
  `passthroughTools`, `onDecision({...})` telemetry callback.
- **Input normalization**: LangChain tools accept string OR object
  input; the adapter normalizes both into `params: Record<string,
  unknown>` for the canonical action — string `"alice"` becomes
  `params: { input: "alice" }` (proven by test).
- **Vertical routing recipe**: `actionTypeFor: (n) => n ===
  "transfer_title" ? "title.transfer" : "tool." + n.toLowerCase()`
  routes specific tool calls into the Title vertical's
  `JURISDICTION_RULE_PRESETS` + NMVTIS + dual-control gates with no
  other code change — the same recipe `@aristotle/claude-agents`
  exposes, now portable to LangChain.
- **Packaging**:
  - `dependencies`: `@aristotle/os-sdk` (workspace)
  - `peerDependencies`: `@langchain/core` (>=0.3.0 <1.0.0), marked
    `optional: true` because the adapter doesn't import from the
    peer at compile time -- it defines a minimal `LangChainToolLike`
    structural type locally
  - LICENSE + NOTICE copied into the package
  - `npm pack --dry-run`: 8 files, ~42 kB tarball — LICENSE, NOTICE,
    README, dist/index.{js,d.ts} + maps, package.json
  - `publishConfig.access: public`, `engines.node: >=18`,
    `sideEffects: false`
- **Tests (14/14 pass)**:
  - ALLOW runs underlying tool with original input + config
  - REFUSE throws ToolGovernanceError; underlying tool never runs
  - ESCALATE throws ToolEscalationError by default; tool never runs
  - `onEscalate: "return"` returns a marker string instead of throwing
  - Default action_type is `tool.<lowercased>`
  - Custom actionTypeFor routes into vertical namespaces
  - buildAction overrides the full canonical-action shape
  - passthroughTools skips the gate call entirely
  - onDecision telemetry fires with elapsedMs and the verdict
  - Gate-unreachable defaults to fail-closed deny
  - `onError: "escalate"` raises ToolEscalationError on gate failure
  - governTools maps an array preserving each tool's shape
  - Original tool is not mutated; governTool returns a new object
  - String input is normalized into `params: { input: "..." }`
  - Constructor refuses missing required options
- **README**: install + quickstart with a working `tool()` example +
  decision-mapping table + canonical mapping table + four recipes
  (vertical routing, passthrough read-only tools, catch escalations
  in AgentExecutor, telemetry) + exports list + immutability note +
  Apache-2.0 footer.
- **No regressions**: governance-core 51/51, execution-control 75/75,
  TS os-sdk 15/15, claude-agents 13/13, langchain 14/14 = 168/168.
  Python SDK 20/20 unaffected.

## v0.1.47 - @aristotle/os-cli 0.2.0 (single-binary install, 30-second eval)
- **Closes follow-up #4 from the Faramesh comparison: package the
  runtime as a single binary.** A user evaluating AristotleOS can now
  install the CLI in one command and have a real Commit Gate boundary
  running in ~30 seconds, with no `git clone`, no `pnpm install`, and
  no TypeScript toolchain on their machine.
- **`@aristotle/os-cli` is now publish-ready.** Removed `private: true`,
  added `publishConfig.access: "public"`, version bumped 0.1.8 -> 0.2.0,
  `prepublishOnly` runs the bundle build. `npm pack --dry-run` ships a
  ~119 kB tarball: LICENSE, NOTICE, README, dist/index.js (the bundle),
  examples/execution_control/*.yaml (sample Ward + Authority Envelope),
  package.json. Seven files, no source-tree leakage, no symlinks to
  workspace packages -- it's a self-contained binary.
- **Single 538.5 kB ESM bundle.** `node build.mjs` uses esbuild to
  inline every workspace dep into `dist/index.js` with a `#!/usr/bin/env
  node` shebang and 0755 perms. The bundle includes the full execution-
  control runtime (governance-core + execution-control-runtime + all
  10+ verticals from the branch), the operator CLI, the MCP-over-stdio
  bridge, the boundary HTTP server, and every subcommand the project
  exposes.
- **Bundled sample fixtures.** The `execution-control dev` command now
  uses `resolveBundledFixture(...)` to find the sample Ward +
  Authority Envelope YAMLs relative to the bundle (preferring the copy
  shipped inside the installed package), with a CWD-relative fallback
  for workspace dev mode. Verified end-to-end: from a fresh
  `/tmp/aristotle-fresh-cwd`, `node dist/index.js execution-control
  dev` boots the boundary on `http://127.0.0.1:8181` and serves
  /evaluate, /proxy, /audit/verify, /metrics with the sample Ward
  `montana-drone-test-range` and Authority Envelope `ae-drone-survey-001`.
- **Documented install paths** in the root README:
  - `npm install -g @aristotle/os-cli && aristotle execution-control dev`
  - `npm install @aristotle/os-sdk` (TypeScript SDK) -- with a 4-line
    quickstart against the dev boundary
  - `pip install aristotle-os-sdk` (Python SDK) -- with a 4-line
    quickstart
  - `npm install @aristotle/claude-agents` (Claude Agent SDK
    integration) -- with the query() wiring example
- **CLI README updated**: install + 30-second eval section that boots
  the boundary, then submits/curls against it; existing 'governed
  project' quickstart preserved below.
- **LICENSE + NOTICE copied into the CLI package** so the npm tarball
  carries the Apache-2.0 text + the demonstration-material disclaimer.
  Same pattern used for the TS SDK, Python SDK, and Claude Agents
  adapter.
- **Tarball + bundle verified**:
  - `node build.mjs`: dist/index.js 538.5 kB (Done in ~1.5s)
  - `npm pack --dry-run`: 118.7 kB packed, 7 files
  - `node /path/to/dist/index.js execution-control dev` from a fresh
    cwd: boundary listens on 127.0.0.1:8181 with sample Ward + Envelope
    loaded
  - `node /path/to/dist/index.js --help` from a fresh cwd: full command
    surface listed
- **Pre-existing test environment gap acknowledged**: the CLI's
  `tsx src/index.test.ts` script fails in this workspace because
  `@aristotle/*` deps are resolved via tsconfig paths rather than
  symlinks (a known tsx + pnpm workspace mismatch documented in the
  memory note). The runtime libraries the bundle inlines all pass:
  governance-core 41/41, execution-control-runtime 75/75. The bundle
  produced by esbuild handles path resolution natively and runs cleanly.
- **No code regressions in the runtime libraries.** governance-core
  41/41 + 4/4 + 6/6 = 51/51, execution-control-runtime 75/75, TS SDK
  15/15, claude-agents 13/13. Python SDK 20/20 unaffected.
- **Series complete.** All four Faramesh-comparison follow-ups are
  now closed: license (Apache-2.0), TS SDK, Python SDK, Claude Agent
  SDK integration, single-binary install path.

## v0.1.46 - Claude Agent SDK integration (@aristotle/claude-agents)
- **`@aristotle/claude-agents` 0.1.0 ships the first agent-framework
  integration.** Closes follow-up #3 from the Faramesh comparison: pick
  ONE agent framework to integrate first. The Claude Agent SDK is the
  natural first target — Anthropic-native, the canonical reference
  implementation for AI agents calling tools.
- **Drop-in `PreToolUse` hook.** Every tool the agent invokes — `Bash`,
  `Write`, `Edit`, `Read`, MCP tools — first becomes a `CanonicalAction`
  (`action_type: "tool.bash"`, etc.), gets sent to the Aristotle Commit
  Gate, and runs only on `ALLOW`. The reason string returned to the agent
  carries the `warrant_id` + `gel_record_id` so the agent can cite them.
- **Decision mapping**:
  - `ALLOW`  -> `permissionDecision: "allow"`  (tool runs, reason cites warrant + GEL record)
  - `REFUSE` -> `permissionDecision: "deny"`  (tool blocked, reason cites reason_codes)
  - `ESCALATE` -> `permissionDecision: "ask"`  (Claude SDK routes to user / approval workflow)
  - Gate unreachable -> fail-closed `deny` by default; opt into `onError: "ask"`
  - Non-PreToolUse event -> `{}` no-op (defensive guard)
- **Configurable mapping**:
  - `actionTypePrefix` -> change the default `"tool"` namespace
  - `actionTypeFor(toolName)` -> route specific tools into a vertical
    (e.g. `mcp__title__lien_release` -> `title.lien_release`)
  - `buildAction({...})` -> take full control over the CanonicalAction shape
  - `passthroughTools` -> set of tool names to allow without hitting the gate
  - `onDecision({...})` -> telemetry/audit callback fired after every gate
    decision (including errors), with elapsed time
- **Packaging**:
  - `dependencies`: `@aristotle/os-sdk` (workspace; pulls in the typed client)
  - `peerDependencies`: `@anthropic-ai/claude-agent-sdk@>=0.3.0 <1.0.0`
    (matches the actually-published v0.3.150 surface; the SDK types
    are not imported at compile time, so the package compiles even if
    the peer isn't installed -- only required at runtime)
  - LICENSE + NOTICE copied into the package; `npm pack --dry-run`
    emits a clean tarball (LICENSE, NOTICE, README, dist/index.{js,d.ts}
    + maps, package.json)
  - `publishConfig.access: public`, `engines.node: >=18`,
    `sideEffects: false`
- **Tests (13/13 pass)**:
  - ALLOW maps to `permissionDecision: "allow"` and surfaces warrant + GEL record id
  - REFUSE maps to `permissionDecision: "deny"` with reason codes
  - ESCALATE maps to `permissionDecision: "ask"`
  - Default action_type is `tool.<toolname-lowercased>`; tool_input
    becomes params; session_id becomes request_id; tool_use_id becomes
    action_id
  - `actionTypeFor` routes specific tools into vertical namespaces
  - `buildAction` overrides the default mapping entirely
  - `passthroughTools` skips the gate call for the specified tools
  - `onDecision` telemetry fires with verdict + elapsed time
  - Gate-unreachable fails closed (deny) by default
  - `onError: "ask"` routes failures to user instead of denying
  - Non-PreToolUse events return `{}` (defensive)
  - `hooksConfig` is a ready-made registration object to spread into
    `query({ options })`
  - Constructor refuses missing required options (client / wardId / subject)
- **README**: install + quickstart + decision-mapping table + mapping
  table + four recipes (passthrough read-only tools, route a vertical's
  tool calls through that vertical's authority, telemetry/audit,
  fail-closed vs ask-on-error) + auth + exports + Apache-2.0 footer.
- **No regressions**: governance-core 41/41, execution-control 75/75,
  TS os-sdk 15/15, claude-agents 13/13, Python SDK 20/20.

## v0.1.45 - Python SDK 0.1.0 (aristotle-os-sdk on PyPI, sync + async)
- **`aristotle-os-sdk` Python package is now publish-ready.** Lives at
  `packages/os-sdk-python/`, built with hatchling + PEP 621 metadata,
  Apache-2.0 license, `py.typed` marker, single runtime dependency
  (`httpx>=0.27,<1.0`). `python -m build` emits a clean wheel
  (`aristotle_os_sdk-0.1.0-py3-none-any.whl`, ~14 kB) and sdist with
  LICENSE + NOTICE embedded under PEP 639 `dist-info/licenses/`.
- **Two clients, same surface**:
  - **`AristotleClient`** (sync) — uses `httpx.Client`, supports context
    manager.
  - **`AsyncAristotleClient`** (async) — uses `httpx.AsyncClient`,
    supports `async with`. Every method `await`-ed.
  Mirrors the TypeScript SDK's HTTP surface with Python-idiomatic
  snake_case naming (`evaluate`, `audit_tail`, `decide_approval`,
  `kill_switch`, `govern_and_execute`, `title_action`, etc.).
- **High-level helpers**:
  - `govern_and_execute(action, executor, *, runtime_register=None,
    now=None)` — evaluate → ALLOW runs executor → REFUSE raises
    `AristotleApiError` → ESCALATE returns escalation handle. Sync
    expects a sync callable; async expects an async coroutine function.
    Executor never runs on non-ALLOW (proven by tests in both clients).
  - `AristotleClient.title_action(...)` / `AsyncAristotleClient.title_action(...)`
    — static builder for Title vertical canonical actions; raises
    `ValueError` if `action_type` is not in the `title.*` namespace.
- **Typed surface**: `TypedDict` shapes mirror the TS SDK's interfaces:
  `EvaluateResponse`, `ApprovalItem`, `ApprovalDecisionResult`,
  `KillSwitchResult`, `RevokeEnvelopeResult`, `MetricsSnapshot`,
  `DegradationStatus`, `ShadowReport`, `ReconciliationReport`,
  `GovernanceManifest`, `GovernanceDiffResult`, `PolicyExplanation`,
  `AuditVerifyResult`, `ConflictSummary`, `CanonicalAction`,
  `TitleCanonicalAction`, `TitleSubmissionReceipt`. `py.typed` marker
  installed so downstream type checkers see the SDK as fully typed.
- **Tests (20/20 pass, sync + async)**:
  - 13 sync tests: evaluate posts action + bearer token, api_key as
    X-API-Key, governance compile/diff/explain, audit_tail query +
    audit_verify, non-2xx raises typed exception, metrics + approvals +
    decide_approval + kill_switch + revoke_envelope, govern_and_execute
    ALLOW / REFUSE (executor never runs) / ESCALATE (executor never
    runs), title_action namespacing + namespace refusal, context
    manager.
  - 7 async tests: async evaluate, async non-2xx raises, async
    govern_and_execute ALLOW / REFUSE / ESCALATE, async context
    manager, static title_action.
- **Mock transport via `httpx.MockTransport`** — no real network needed
  in tests; the SDK exposes a `transport` constructor parameter for the
  same reason (sync + async).
- **README**: install + quickstart (sync and async), four recipes
  (govern-and-execute, dual-control approval, shadow-mode profiling,
  kill switch), full API surface tables, auth + transport injection +
  license footer.
- **No regressions**: governance-core 41/41, execution-control 75/75,
  TS SDK 15/15, Python SDK 20/20.
- **This closes the second of the four Faramesh-comparison follow-ups.**
  Next: pick ONE agent framework to integrate first (Claude Agents SDK).

## v0.1.44 - TypeScript SDK 0.2.0 (publish-ready, expanded surface)
- **`@aristotle/os-sdk` is now publish-ready.** Removed `private: true`, added
  `publishConfig.access: "public"`, expanded `files` to include LICENSE +
  NOTICE (now copied into the package directory), added repository / bugs /
  homepage / keywords metadata, declared `engines.node: ">=18"` and
  `sideEffects: false`. `npm pack --dry-run` ships a 11.3 kB tarball
  containing LICENSE, NOTICE, README.md, dist/index.{js,d.ts}, package.json
  — no source, no tests, no secrets.
- **Bumped version** 0.1.8 → 0.2.0 to mark the surface expansion.
- **Added 5 endpoints** previously missing from the SDK that exist on the
  execution-control boundary:
  - `metrics()` → `GET /v1/execution-control/metrics`
  - `approvals()` → `GET /v1/execution-control/approvals`
  - `decideApproval({request_id, decision, reason?})` →
    `POST /v1/execution-control/approvals/decide`
  - `killSwitch({scope, action, reason?})` →
    `POST /v1/execution-control/admin/kill` (admin)
  - `revokeEnvelope({envelope_id, reason?})` →
    `POST /v1/execution-control/admin/revoke` (admin)
- **`governAndExecute(action, executor, opts?)`** high-level helper: evaluates
  at the Commit Gate, runs `executor(decision)` ONLY on ALLOW (with the
  warrant in hand), throws `AristotleApiError` on REFUSE, returns an
  escalation handle on ESCALATE. Never runs the executor on a non-ALLOW
  outcome — proven by tests.
- **`AristotleClient.titleAction({...})`** static builder for Title vertical
  canonical actions; produces a `CanonicalAction` with `action_type: "title.*"`
  and the required `params` already namespaced (`vin`, `jurisdiction`,
  `transaction_type`).
- **New types exported**: `ApprovalItem`, `ApprovalDecisionResult`,
  `KillSwitchResult`, `RevokeEnvelopeResult`, `MetricsSnapshot`,
  `TitleCanonicalAction`, `TitleSubmissionReceipt` (mirrors the runtime's
  hash-bound receipt shape so callers can verify submission receipts
  client-side before binding them into evidence).
- **+7 SDK tests** (`packages/os-sdk/src/index.test.ts` now 15/15):
  metrics, approvals + decideApproval, killSwitch + revokeEnvelope,
  governAndExecute on ALLOW / REFUSE (executor never runs) / ESCALATE
  (executor never runs), titleAction builder.
- **Expanded README**: copy-paste quickstart, four recipe sections
  (govern-and-execute, dual-control approval, shadow-mode profiling,
  kill switch), full API surface table organized by area, auth + custom
  fetch sections, license footer.
- **Workspace**: `packages/*` added to `pnpm-workspace.yaml` so the SDK is a
  proper workspace member; `corepack pnpm --filter @aristotle/os-sdk` now
  resolves correctly.
- **No regressions**: governance-core 41/41, execution-control 75/75, title
  vertical 22/22, console-ui typecheck clean.
- **Note on Python SDK** (next commit in this series): same boundary, same
  shape, translated to Python — explicit follow-up.

## v0.1.43 - License: Apache-2.0
- **AristotleOS is now licensed under Apache License 2.0.** Replaces the
  previous proprietary all-rights-reserved license. The Apache-2.0 license
  is permissive, includes an explicit patent grant, and matches the license
  posture commonly expected by enterprise adopters and OSS distributors.
- **`LICENSE`** at the repo root now carries the canonical Apache-2.0 text
  (the 2004 version, including the appendix boilerplate). The previous
  proprietary file has been removed and is no longer in effect for any
  AristotleOS-original material in this repository.
- **`NOTICE`** (new) carries the Apache-2.0 attribution, a pointer to
  third-party dependency manifests for transitive license info, and the
  demonstration-material disclaimer (the Title vertical's MT/OR/CA/TX/FL
  rule packs, demonstration outbound transport, and sample APL policies
  remain explicitly labeled demonstration material and are not legal advice).
- **Every workspace `package.json` declares `"license": "Apache-2.0"`** (19
  manifests total: root + 3 apps + 1 packages + 8 services + 5 shared +
  adapters/http-gateway). Three previously declared `"UNLICENSED"`; the
  rest had no license field. All updated to `"Apache-2.0"` consistently.
- **`README.md`** gains a "License" section pointing at LICENSE + NOTICE
  and reiterating the demonstration-material caveat.
- **`docs/release-checklist.md`** "License posture" item updated from
  proprietary/UNLICENSED to Apache-2.0; CLI `private: true` flag note
  preserved for accidental-publish guard.
- **`packages/os-sdk/README.md`** footer updated from "Proprietary /
  UNLICENSED" to "Licensed under Apache-2.0".
- **No code, test, or runtime change.** governance-core 51/51,
  execution-control 75/75, title 22/22, console-ui typecheck clean.

## v0.1.42 - Issuer→key binding (security hardening, all verticals)
- **Closes the #1 security gap from `docs/security-review-followups.md`.**
  Before this change, `verifyObjectSignatures` accepted any signature whose `keyId`
  was in the gate's keyring. In a multi-tenant deployment that shares a keyring
  (an `HmacKeyring` with multiple tenants, or a JWKS that aggregates trust
  anchors), tenant B's key could be used to sign tenant A's Ward, Authority
  Envelope, or Warrant — and validation passed.
- **`verifyObjectSignatures(keyring, obj, allowedKeyIds?)`** in
  `shared/governance-core/src/hash.ts` gains an optional `allowedKeyIds:
  ReadonlySet<string>`. When provided, ANY signature with `keyId ∉ allowedKeyIds`
  fails verification BEFORE the cryptographic check. The check is all-or-nothing
  on the signature set, so one foreign signature in a mixed set refuses the
  whole artifact.
- **`maeAllowedKeyIds(mae)`** helper in
  `shared/governance-core/src/validators.ts` derives the set from
  `mae.signing_keys`. Passed at all four call sites: `validateMae`,
  `validateWardUnderMae`, `validateEnvelopeUnderWard`, `validateWarrant`. The
  MAE is treated as the constitutional root of its tenant — every artifact
  beneath it must be signed by a key the MAE declares.
- **Backward compatible.** When `mae.signing_keys` is empty/undefined, the
  helper returns `undefined` and the legacy "any keyring-known key is
  acceptable" behavior is preserved. Existing fixtures populate
  `signing_keys` already, so no test fixture needed changes.
- **Tests: `validators.security.test.ts`** stages the cross-tenant forge
  attack at every level:
  - MAE forge (signed by foreign key) → refused with `mae-signature-invalid`
  - Ward forge → refused with `ward-signature-invalid`
  - Envelope forge → refused with `envelope-signature-invalid`
  - Warrant forge → refused with `warrant-signature-invalid`
  - Unit test for `verifyObjectSignatures` with/without `allowedKeyIds`,
    including the all-or-nothing rule on mixed signature sets.
  - Backward-compat test: empty `mae.signing_keys` does NOT raise the new
    `*-signature-invalid` violation (legacy mode preserved).
- **No regressions.** governance-core 41/41 + 4/4 (constraints security) +
  6/6 (new validators security) = 51/51 tests pass. execution-control 75/75.
  title vertical 22/22. Title UI typecheck clean.
- **Remaining follow-ups in `docs/security-review-followups.md`** (request-level
  replay store, atomic warrant consumption, monetary currency checks,
  `parent_mae_id` lineage, signed revocation lists, JWKS fail-static pairing)
  are unchanged.

## v0.1.41 - Title outbound submission adapter (demonstration transport)
- **`TitleSubmissionTransport` interface + `DemonstrationTitleSubmissionTransport`.**
  AristotleOS gates the action; the outbound adapter actually delivers the resulting
  packet to a state ELT / DMV / dealer endpoint. The shipped demonstration transport
  is deterministic, never touches the network, and reports `production_validated:
  false` so the orchestrator refuses to ship a fictional receipt into a real evidence
  bundle by accident.
- **`submitTitlePacket(packet, authz, transport, opts)` orchestrator.** Enforces
  defense-in-depth before invoking the transport: refuses MISSING_AUTHORIZATION,
  WARRANT_NOT_CONSUMED, JURISDICTION_MISMATCH, TRANSACTION_TYPE_MISMATCH,
  DEMONSTRATION_ONLY_BLOCKED (unless `allowDemonstrationTransport: true`), and
  surfaces transport exceptions as TRANSPORT_UNREACHABLE rather than throwing.
- **`TitleSubmissionReceipt` cryptographically bound to the authorizing Warrant.**
  Each receipt carries `warrant_id`, `action_hash`, `remote_receipt_id`, `ack_at`,
  `ack_kind`, and a `receipt_hash` covering the rest. `verifyTitleSubmissionReceipt()`
  re-checks the receipt out-of-band before it is bound into evidence.
- **`TitleEvidenceContext.submission_receipt?: TitleSubmissionReceipt`.** The receipt
  is embedded INSIDE the title context, so the existing `title_context_hash` and
  `title_bundle_hash` cover it. Substituting or mutating a receipt post-export fails
  `verifyTitleEvidenceBundle()` — proven by the new tamper-detection test.
- **+7 new tests** (`title.test.ts` now 22/22, up from 15/15) covering: missing-authz
  refusal, unconsumed-warrant refusal, jurisdiction / transaction-type mismatch,
  demonstration-only block, hash-bound receipt, transport rejection + exception
  handling, evidence-bundle binding with tamper detection.
- **Docs.** New "Outbound submission adapter (demonstration)" section in
  `docs/title.md` documenting the binding chain and the explicit production-onboarding
  checklist (per-state credentials, payload format, certification environment,
  counsel review, transport promotion).
- **No new dependencies.** Reuses existing `sha256` + `stableStringify` from index.ts.
- **No regressions.** governance-core suite 75/75, title vertical 22/22.
- All jurisdiction rule presets remain DEMONSTRATION ONLY. The transport contract is
  stable; only per-jurisdiction transport implementations change for production use.

## v0.1.40 - Aristotle Verified Title Transaction Layer (vehicle title / registration / ELT)
- **Vehicle title transaction governance vertical.** New
  `shared/execution-control-runtime/src/title.ts` governs consequential title, lien,
  registration, and DMV-document actions BEFORE they cross into legal effect.
  Positioned alongside Vitu / CVR / Dealertrack / DDI Technology / Reynolds & Reynolds:
  those platforms move bits to government endpoints; Aristotle proves every action was
  authorized, state-rule compliant, fraud-checked, and audit-ready.
- **`TITLE_ADAPTER_CATALOG`** — 10 typed boundaries: ELT lien, title transaction,
  registration, digital signature, dealer workflow, lender workflow, DMV submission,
  fraud check, NMVTIS, historian.
- **`JURISDICTION_RULE_PRESETS`** for **MT, OR, CA, TX, FL** (SAMPLE / DEMONSTRATION
  ONLY — not legal advice). Each declares ELT support, digital-signature support,
  odometer-disclosure requirement, VIN-inspection requirement, NMVTIS requirement,
  fraud-escalation threshold, identity-confidence floor, permitted transaction types,
  and required forms by transaction type.
- **Gate enforcement:** new `physical_bounds` (jurisdictions/transaction-types/
  organization-kinds, fraud-risk / identity-confidence thresholds, warrant freshness,
  require_* flags for signer/NMVTIS/theft/odometer/identity/envelope/warrant/forms/
  VIN-inspection/ELT/digital-signature/lien-exists/lien-release-authority/dealer-
  license/lender-active/lender-elt-participant) and hard interlocks for bypass-NMVTIS,
  bypass-theft-check, bypass-state-rules, override-dealer-license, override-odometer-
  disclosure, disable-identity-verification, signature-bypass-jurisdiction-acceptance,
  and `warrant.reuse_attempt`.
- **Aligned with (DEMO):** state ELT programs, NMVTIS, 49 CFR Part 580 (odometer),
  ESIGN / UETA, AAMVA DLDV, UCC Article 9, state motor-vehicle codes, state dealer-
  licensing statutes. Signed Title Evidence Bundles (`aristotle.title-evidence.v1`).
- **15/15 title tests** pass — covers all 7 named demo scenarios (clean MT lien
  release ALLOW; unauthorized signer REFUSE; interstate transfer ESCALATE; revoked
  envelope REFUSE; fraud over threshold REFUSE; title correction ESCALATE; suspended
  dealer license REFUSE), 18-condition refuse sweep, hard interlocks,
  `warrant.reuse_attempt`, dual-control escalate->approve, Title Evidence Bundle
  round-trip, and **GEL chain tamper detection**. No regressions across healthcare 6,
  swarm 8, logistics 6, aviation 7, robotics 7, pipeline 6, mining 6, port 6, water 6,
  grid 6, rail 6, gate-property 2, execution-control 75.

## v0.1.38 - UAV-swarm governance for disconnected operations
- **Swarm-first, not high-altitude-first.** New `shared/execution-control-runtime/src/swarm.ts`
  module: intermittent connectivity is not a corner case — delegated authority must
  remain enforceable locally, safety must degrade predictably, and accountability must be
  provable after the fact. High-altitude balloon / mothership (14 CFR Part 101) is the
  EXTREME STRESS CASE.
- **Primitives:** Swarm Authority Envelope, Disconnected Commit Gate, Mesh Revocation
  Protocol, Flight Warrant Service, Fluidity Token (time-bounded degraded-comms
  authority), Airspace Authority Compiler, Launch Readiness Gate, GEL Mission
  Reconstruction. `SWARM_ADAPTER_CATALOG` exposes 10 typed boundaries;
  `nextSwarmFlightState` realizes the disconnected state machine (connected -> degraded
  -> mesh-relay -> hold-safe -> recover -> evidence-sync). Mission classes: wildfire,
  disaster-response, temporary-comms-mesh, agriculture, range-ops,
  infrastructure-inspection, defense-perimeter, reconnaissance, high-altitude-launch.
- **Gate enforcement:** new `physical_bounds` (swarm size/radius/separation, mesh link
  quality/hops, lost-link seconds, authority sync age, fluidity-token validity, launch
  readiness, recovery plan, balloon position-monitor + envelope) and hard interlocks for
  disable-mesh, override-lost-link-failsafe, bypass-launch-readiness, override-fluidity-
  token, force-payload-release, balloon position-monitor / envelope-protection disable.
- **Built to meet and exceed:** 14 CFR Part 107 + waivers, Part 108 (BVLOS), Part 101
  (unmanned free balloons), Part 89 (Remote ID), Part 91, LAANC, ASTM F3548 (UTM), and
  SORA. Signed Swarm Evidence Bundles (`aristotle.swarm-evidence.v1`) for Mission
  Reconstruction.
- 8/8 swarm tests pass; full regression green: logistics 6, aviation 7, robotics 7,
  pipeline 6, mining 6, port 6, water 6, grid 6, rail 6, gate-property 2,
  execution-control 75.

## v0.1.39 - Healthcare clinical-operations execution-control vertical
- **Healthcare pilot path**: typed adapters (FHIR resource, HL7 message, EHR
  writeback, pharmacy workflow, prior authorization, claims, imaging RIS/PACS,
  medical-device command, patient messaging, research export) -> Canonical
  Governed Actions; clinical and privacy invariants enforced at the gate
  (patient-context hash, consent/TPO basis, clinician privilege, allergy and
  medication-interaction checks, chart lock, device safety limits, alarm posture,
  PHI minimization, claim attestation, de-identification, audit context);
  Healthcare Evidence Bundles preserve hashes and redaction material instead of
  raw PHI by default; a Clinical Ops console workflow; `aristotle healthcare`
  CLI; `examples/healthcare/` + docs (overview, threat model, pilot guide, Ward
  templates).
- **Patient-consequence hardening**: allergy override, controlled-substance
  force-dispense, device alarm/safety-limit disable, patient-record deletion,
  PHI export without consent, claim force-submit, identified research export,
  order force without clinician authority, and patient-context-free EHR mutation
  are hard-refused even when an envelope is misconfigured; medication-list,
  dispense, PHI export, device update, and research export actions require
  plural authority before Warrant issuance.

## v0.1.37 - Trucking and logistics execution-control vertical
- **Logistics pilot path**: typed adapters (TMS dispatch, broker/carrier tender,
  carrier vetting, ELD/HOS, telematics route, WMS release, YMS dock/gate, fuel
  advance, accessorial/payment, cold-chain, hazmat routing, DVIR, customs /
  cross-border) -> Canonical Governed Actions; logistics physical and operational
  invariants enforced at the gate (HOS/ELD freshness, carrier authority,
  insurance, driver qualification, route/geofence, trailer seal, cargo securement,
  temperature range, appointment/dock/gate state, fuel/payment caps, fraud score,
  double-broker risk); Logistics Evidence Bundles; a Logistics Ops console
  workflow; `aristotle logistics` CLI; `examples/logistics/` + docs (overview,
  threat model, pilot guide, ward templates).
- **Freight safety and fraud hardening**: dispatch-over-HOS, ELD disable, carrier
  or driver qualification override, hazmat route override, cold-chain alarm
  override, forced POD/payment release, unbounded fuel advance, forced yard gate,
  double-broker override, and telematics spoof override are hard-refused even when
  an envelope is misconfigured; tender, fuel, payment, hazmat, and cold-chain
  actions require dual control and fail closed when approval state is unavailable.

## v0.1.36 - Robotics / humanoid execution-control vertical
- **Robotics pilot path**: typed adapters (motion-control, manipulation, mobile-base,
  humanoid-locomotion, teleoperation, human-robot-interaction, safety-config, fleet,
  historian) -> Canonical Governed Actions; robotics physical invariants enforced at
  the gate (workcell/zone/operating-mode/state, TCP speed, force/torque/power
  biomechanical limits, separation distance, center-of-mass deviation and step height
  for humanoids, payload, fresh telemetry, and readiness flags for e-stop, protective
  stop, SSM, PFL, collision detection, safety scanner, humanoid balance controller and
  fall protection, teleop link, operator qualification, plus collaborative-mode-when-
  human-present) plus hard interlocks (disable e-stop / protective stop / collision
  detection / safety scanner, override SSM / PFL / safety zone, humanoid balance-
  controller and fall-protection disable); signed Robotics Evidence Bundles with a
  regulatory profile and collaboration risk class; `examples/robotics/` ward, envelope,
  policy, and allow/refuse actions runnable via `execution-control evaluate`; docs
  (overview, ward templates, threat model). Designed to meet and exceed ISO 10218-1/-2,
  ISO/TS 15066, ANSI/RIA R15.06/.08, ISO 3691-4, ISO 13482, and ISO 13849 / IEC 61508.

## v0.1.35 - Aviation / UAV / eVTOL execution-control vertical
- **Aviation pilot path**: typed adapters (UTM/USS, flight-control/autopilot,
  geofence, payload, vertiport, detect-and-avoid, C2-link, Remote ID, ground
  control station, historian) -> Canonical Governed Actions; aviation physical
  invariants enforced at the gate (airspace id/class/operation-volume/flight-state,
  altitude AGL ceiling, groundspeed, battery RTL reserve, wind/visibility/ceiling,
  payload mass, fresh telemetry, and readiness flags for geofence, Remote ID,
  detect-and-avoid, C2 link health, airspace authorization, no-active-TFR,
  VLOS/waiver, RTL availability, vertiport clearance, weather, RPIC qualification)
  plus hard interlocks (disable geofence / detect-and-avoid / Remote ID / return-to-
  home, override airspace authorization / C2 link-loss failsafe / active-TFR, eVTOL
  flight-envelope-protection disable); signed Aviation Evidence Bundles with a
  regulatory profile and SORA risk class; `examples/aviation/` ward, envelope,
  policy, and allow/refuse actions runnable via `execution-control evaluate`; docs
  (overview, ward templates, threat model). Designed to meet and exceed 14 CFR Part
  107/108/91/135, Part 89 (Remote ID), LAANC, ASTM F3548 (UTM), and SORA.

## v0.1.34 - Mining execution-control vertical
- **Mining pilot path**: typed adapters (autonomous-haulage/AHS, ventilation,
  blasting, tailings/TSF, gas-monitoring, hoist, Modbus, DNP3, OPC-UA, historian)
  -> Canonical Governed Actions; mining physical invariants enforced at the gate
  (site/zone/state, methane/CO/oxygen action levels, minimum airflow, haulage
  speed ceiling, tailings pond level & freeboard, hoist load, fresh SCADA, and
  readiness flags for proximity detection, exclusion-zone & personnel clearance,
  ground control, gas monitoring, ventilation, operator qualification) plus hard
  interlocks (disable proximity detection / gas monitoring / ventilation / ground-
  control monitoring / tailings monitoring, disable hoist overspeed protection,
  blast force-initiate); signed Mining Evidence Bundles with a regulatory profile
  (MSHA 30 CFR 56/57/75/77, methane, proximity detection, ISO 17757, ICMM GISTM,
  ground-control plan, blast clearance); `examples/mining/` ward, envelope, policy,
  and allow/refuse actions runnable via `execution-control evaluate`; docs
  (overview, ward templates, threat model). Designed to meet and exceed MSHA 30 CFR
  56/57/75/77, ISO 17757, and ICMM GISTM.
## v0.1.33 - Port and water infrastructure execution-control verticals
- **Water/wastewater pilot path**: typed adapters (SCADA/plant control, PLC/RTU,
  pump station, valve/pressure-zone, chemical dosing, lab/LIMS, historian, AMI,
  tank/reservoir, lift station, UV/disinfection, wastewater discharge) ->
  Canonical Governed Actions; water physical invariants enforced at the gate
  (system/facility/pressure zone/process area, chlorine dose/residual, pH,
  turbidity, pressure, tank/wetwell level, flow, UV intensity, sensor/lab
  freshness, backflow, disinfection, chemical inventory, pump availability,
  valve interlock, discharge permit window, bypass posture); Water Evidence
  Bundles; a Water Ops console workflow; `aristotle water` CLI;
  `examples/water/` + docs (overview, threat model, pilot guide, ward templates).
- **Utility safety hardening**: disinfection disable, chemical overfeed, PLC force
  override, valve force-open, pump run-dry, and bypass force-open are hard-refused
  even when an envelope is misconfigured; chemical/PLC/valve/disinfection/
  discharge actions require dual control and fail closed when approval state is
  unavailable.

## v0.1.32 - Maritime port execution-control vertical
- **Port pilot path**: typed adapters (Terminal Operating System, Port Community /
  EDI, customs hold, VTS/AIS/PNT, crane automation, gate OCR/access, yard tractor,
  reefer, weighbridge/VGM, shore-power, bunkering/hazmat) -> Canonical Governed
  Actions; port physical invariants enforced at the gate (customs/security holds,
  VGM, PNT/AIS freshness, crane exclusion zone, berth conflict, tide/weather,
  truck appointment, driver identity, cold chain, shore-power, hazmat routing,
  vendor remote-session posture); Port Evidence Bundles; a Port Ops console
  workflow; `aristotle port` CLI; `examples/port/` + docs (overview, threat
  model, pilot guide, ward templates).
- **Terminal safety hardening**: crane interlock disable, exclusion-zone override,
  forced customs release, forced gate-open, shore-power forced energization, and
  PNT confidence override are hard-refused even when an envelope is misconfigured;
  crane/VTS/shore-power/hazmat actions require dual control and fail closed when
  approval state is unavailable.

## v0.1.32 - Pipeline (oil & gas / energy) execution-control vertical
- **Pipeline pilot path**: typed adapters (SCADA pump-control, SCADA compressor,
  valve-control, pressure-control, leak-detection/CPM, pig-launcher, Modbus, DNP3,
  OPC-UA, historian) -> Canonical Governed Actions; pipeline physical invariants
  enforced at the gate (segment/system-model/state, MAOP & %-of-MAOP pressure
  ceiling, min pressure, liquid/gas flow caps, fresh SCADA / Control Room
  Management, leak-detection armed, overpressure protection active, ESD ready,
  segment isolation ready, pump primed, operator qualified) plus hard interlocks
  (disable leak detection / overpressure protection / ESD, isolation bypass,
  relief disable, overpressure override, compressor safety-shutdown disable);
  signed Pipeline Evidence Bundles with a regulatory profile (PHMSA 192/195, CRM,
  OQ, Integrity Management, API 1164/1173/RP 1175); `examples/pipeline/` ward,
  envelope, policy, and allow/refuse actions runnable via `execution-control
  evaluate`; docs (overview, ward templates, threat model). Designed to meet and
  exceed 49 CFR 192/195, 192.631/195.446, 192.801/195.501, and the API standards.

## v0.1.31 - Railroad execution-control vertical
- **Railroad pilot path**: typed adapters (Dispatch/CAD, PTC back office, wayside
  signal, switch machine, grade crossing, locomotive telemetry, crew management,
  consist/hazmat, maintenance-of-way, yard automation) -> Canonical Governed
  Actions; rail physical invariants enforced at the gate (territory, movement
  authority, PTC active/fresh, signal aspect, switch proof, train separation,
  work-zone release, bulletin acknowledgement, consist hash, grade crossing
  protection, no conflicting authority); Rail Evidence Bundles; a Rail Ops
  console workflow; `aristotle rail` CLI; `examples/rail/` + docs (overview,
  threat model, pilot guide, ward templates).
- **Rail safety hardening**: PTC disable, enforcement override, signal force-clear,
  and switch force-unlock are hard-refused even when an envelope is misconfigured;
  route/signal/switch/PTC/hazmat actions require dual control and fail closed when
  approval state is unavailable.

## v0.1.30 - Electric-utility grid OT vertical
- **Grid/utility pilot path**: typed adapters (SCADA/EMS/ADMS, IEC 61850, DNP3,
  Modbus, OPC UA, DERMS, relay settings, firmware campaigns, historian writes)
  -> Canonical Governed Actions; grid physical invariants enforced at the gate
  (frequency, voltage, feeder/transformer loading, DER export caps, topology
  model, voltage class, protection state, SCADA freshness, crew clearance, manual
  fallback); grid Evidence Bundles; a Grid console workflow; `aristotle grid` CLI;
  `examples/grid/` + docs (overview, threat model, pilot guide, ward templates).
- **OT safety hardening**: protection-disable actions are refused by the Physical
  Invariant Gater even when an envelope is misconfigured; relay-setting changes
  require dual control and fail closed when approval state is unavailable.

All notable changes to AristotleOS (the Ward/Warrant execution-control boundary,
its operator console, SDK, and CLI). Dates are release tags on the
`ward-warrant-execution-control` branch. The doctrine is unchanged throughout:
*authority before consequence · warrant before execution · evidence after every
decision.*

## v0.1.29 — Autonomous-vehicle fleet vertical + dual-control fail-closed
- **Automotive/ADS pilot path**: typed adapters (ROS2/DDS, AUTOSAR Adaptive, OTA,
  map update, remote assist, fleet mgmt, simulation) → Canonical Governed Actions;
  vehicle-safety physical bounds enforced at the gate (`max_speed_mps`, ODD,
  road classes, map/localization/perception confidence, MRC availability); vehicle
  safety-evidence bundles; an AutomotiveFleet console; `aristotle automotive` CLI;
  `examples/automotive/` + docs (overview, threat model, pilot guide, ward templates).
- **Dual-control hardening**: a dual-controlled action with **no approval store
  configured** now fails closed (`DUAL_CONTROL_STORE_MISSING`) instead of silently
  bypassing plural authority. Full gate green; clean-room clean.

## v0.1.28 — Telecom pilot path (overview doc) + CHANGELOG refresh
- `docs/telecom.md` overview for the telecom autonomous-network pilot; CHANGELOG
  brought current through the dual-control + telecom work. Full gate green (37 suites).

## (telecom) — Telecom autonomous-network pilot path
- Typed carrier adapters (TM Forum Open API, NETCONF/YANG, gNMI/gNOI, O-RAN A1/R1)
  → Canonical Governed Actions; NOC evidence bundles (ticket/operator/redactions);
  carrier-scale benchmark, reconnect-storm reconciliation, and multi-region HA soak;
  `aristotle telecom` CLI + `examples/telecom/` + `docs/telecom-threat-model.md`.

## v0.1.27 — Approvals console
- Operator UI for dual control: a live M-of-N approval queue (vote progress, voters,
  approve/reject) reading `/approvals` with a sample fallback. Additive view.

## v0.1.26 — Dual-control surface
- APL `approve <a> requires N [within <dur>]`; `/approvals` + `/approvals/decide`
  endpoints; `aristotle dual-control` CLI.

## v0.1.25 — Dual control (M-of-N approval)
- The gravest actions get no Warrant on their own ALLOW — they ESCALATE and require
  N distinct approvers (never the requester) within a TTL. Pure state machine +
  file/in-memory ApprovalStore with separation of duties; gate-wired.

## v0.1.24 — Budget / quota governance
- Authority Envelopes can cap cost and/or call count per rolling window; over-budget
  actions are refused (`BUDGET_EXCEEDED`) and recorded. APL `budget` + governor.

## v0.1.23 — Performance pass
- Measured numbers published; cached public-key verification (helps batch chain/bundle
  verify); honest positioning vs a compiled gate (no rewrite).

## v0.1.22 — Cross-agent behavioral detection
- coordinated_denial, peer_anomaly, privilege_escalation, new_capability,
  credential_reuse — fleet-level signals routed into warrant-gated interdiction.

## v0.1.21 — Aristotle Policy Language (APL)
- Typed governance DSL compiling to the existing Ward/Authority manifests; `aristotle
  policy compile|check`.

## v0.1.15–v0.1.20 — Operator surface completeness
- Degradation health endpoint + full SDK coverage (v0.1.15); console degradation badge
  (v0.1.16); Ward Marshal host/process + MCP collectors (v0.1.17), discover CLI
  sources (v0.1.18), generic file-fed collector (v0.1.19); Conflict Inbox CLI (v0.1.20).

## v0.1.20 — Conflict Inbox CLI
- `aristotle conflicts ingest|list|resolve` over a durable file-backed inbox.
  `list` exits non-zero while a conflict is open (ops/CI gate); `resolve` applies
  the attributed state-machine transition. Completes the Conflict Inbox across
  store + endpoints + SDK + console + CLI.

## v0.1.19 — Generic file-fed discovery collector
- `fileObservationCollector` + `extractRecords` ingest an exported inventory JSON
  (CI / SaaS / network / API-gateway) via a field mapping — one collector for every
  export-shaped source. CLI: `ward-marshal discover --from-file <f> --source <s> --map field=key`.

## v0.1.18 — Discovery CLI sources
- `ward-marshal discover` gains `--process` (host/workstation/edge) and `--mcp`
  (MCP tool servers); sources combine, merge, and dedupe.

## v0.1.17 — Host/process + MCP collectors
- `processCollector`/`parseProcessList`/`parsePsText` (a `looksLikeAgent` heuristic
  keeps only candidate agents and extracts LLM egress) and `mcpCollector`/
  `parseMcpInventory` broaden Ward Marshal discovery beyond Kubernetes.

## v0.1.16 — Console surfaces degradation
- The Command Center shows a DEGRADED badge (from `GET /degradation`) when the
  boundary reports an active condition, naming the conditions and fail action.

## v0.1.15 — Degradation health endpoint + full SDK coverage
- `GET /v1/execution-control/degradation` reports live self-assessed health and the
  projected fail action. `@aristotle/os-sdk` now covers shadow, reconcile, conflicts,
  marshal census/behavior, and degradation with typed results.

## v0.1.14 — Self-driving degradation detectors
- `degradation.ts`: ledger-writability canary (on by default), control-plane
  staleness probe (shared with B2/T17), `predicateProbe`/`runWithTimeout` adapters.
  An unavailable ledger short-circuits to a *governed* degraded decision (never a
  500). Makes the B3 fail-mode policy self-driving.

## v0.1.13 — Self-verifying evaluator walkthrough
- `pnpm demo:evaluator`: a narrated, no-services proof of the whole doctrine
  (allow/refuse/escalate/invariant/replay/degraded + offline Evidence Bundle export
  & verify + tamper detection). 15 PASS/FAIL checks; runs in CI as `test:demo`.

## v0.1.12 — Per-Ward criticality fail-mode + gate-HA (B3)
- `fail-mode.ts`: a Ward's criticality (`safety_critical`…`best_effort`) decides the
  fail action under degradation conditions; `DEGRADED_MODE` gate precondition;
  HA-topology docs (stateless replicas over a serialized durable ledger).

## v0.1.11 — Supply-chain hardening (A4)
- Blocking dependency-audit gate (`audit-deps.mjs`; high+critical fail; triage
  allowlist with hard expiry) and a release workflow emitting SLSA build provenance
  + an SBOM attestation, verifiable with `gh attestation verify`.

## v0.1.10 — Durable Conflict Inbox + 5/5 live consoles
- `conflict-inbox.ts` (ingest/list/resolve, idempotent, resolutions survive
  re-ingest) with HTTP endpoints; the Conflict Inbox console reads it live —
  completing all five operator consoles on real backends.

## v0.1.9 — Live operator engines + real console wiring
- Operator engines exposed as operator-gated HTTP endpoints (shadow, reconcile,
  marshal census/behavior) with OpenAPI + server tests; Shadow Mode and Ward
  Marshal consoles render real engine output with labeled sample fallback.

## v0.1.5–v0.1.8 — Defense-hardening batches
- A1 gate property/oracle verification; A2 trusted-time + nonce-bound warrants;
  A3 asymmetric credential minter; B1 attested telemetry; B2 DDIL edge containment;
  B4 mTLS/PIV client-cert auth + admin-key gate; B5 FIPS-mode guard; B6 MLS
  classification labels + CDS boundary.

## v0.1.0–v0.1.4 — Foundation
- The execution-control runtime (Commit Gate, Ed25519 Warrants, hash-chained
  Governance Evidence Ledger, Evidence Bundles), CLI, console, HTTP gateway,
  pluggable durable ledgers (SQLite/Postgres), RBAC/OIDC, revocation, kill switch,
  Ward Marshal, and the security-audit packet.

---

See `docs/readiness-assessment.md` for the current defense-pilot posture and
`docs/defense-readiness.md` for the hardening map (A/B/C tiers).
