# Ward Marshal

Ward Marshal is the AristotleOS subsystem for discovering undeclared autonomous execution and routing containment through governance.

It exists because an enterprise cannot govern agents it cannot see. Ward Marshal turns observed runtime signals into a deterministic Agent Census, assigns each finding to a Ward where possible, and requires any quarantine, credential revocation, tool disablement, scale-down, or termination action to pass the same execution-boundary doctrine as every other consequential action.

Core rule:

> Even containment requires authority, warrant, and evidence.

## Runtime Path

1. Agent observations arrive from Kubernetes, developer workstations, CI, MCP servers, SaaS automation, API gateways, network telemetry, or edge nodes.
2. Agent Census canonicalizes observations into stable findings.
3. The Rogue Register records subject, Ward, owner, observed tools, credentials, locations, risk signals, and evidence hash.
4. The operator or automation requests an interdiction action.
5. AristotleOS resolves the Ward and checks the Ward Marshal Authority Envelope.
6. The Commit Gate evaluates runtime registers, policy version, action scope, and delegated authority.
7. On `ALLOW`, AristotleOS issues a single-use Warrant.
8. The enforcement adapter may quarantine, revoke, disable, scale down, or terminate only after Warrant verification.
9. The Governance Evidence Ledger records the detection and decision context.

## Commands

Run the sample census:

```bash
npm run aristotle -- ward-marshal scan \
  --observations examples/ward_marshal/observations.enterprise.json \
  --registry examples/ward_marshal/agent-registry.json
```

Run a governed interdiction demo:

```bash
npm run ward-marshal:demo
```

The demo executes the credential-revocation adapter after `ALLOW` and writes a
file-backed revocation list to `.tmp/ward-marshal-credential-revocations.json`.

Submit an explicit interdiction:

```bash
npm run aristotle -- ward-marshal interdict \
  --observations examples/ward_marshal/observations.enterprise.json \
  --registry examples/ward_marshal/agent-registry.json \
  --ward examples/ward_marshal/ward.enterprise_autonomy.yaml \
  --envelope examples/ward_marshal/authority_envelope.ward_marshal.yaml \
  --kind revoke_credentials \
  --operator-ticket SEC-1042 \
  --interdiction-authority soc-commander \
  --ledger .tmp/ward-marshal.gel.jsonl
```

If required runtime registers are missing, the action escalates. If the Authority Envelope does not delegate the requested containment class, the action is refused and no Warrant is issued.

## Discovery collectors (ingestion)

The census needs to be fed. Collectors turn live environment signals into the
`AgentObservation` stream, using the same **injected-client** pattern as the
interdiction adapters — pure parsers (tested without a live cluster) plus a thin
collector that runs an injected command. AristotleOS imports no cloud/k8s SDK, and
the collector runs **inside your environment** so no telemetry leaves it.

- `kubernetesCollector` — `kubectl get pods` → observations, reading `aristotle.io/*`
  labels/annotations (agent-id, ward, tools, credentials) plus structural facts
  (namespace, image, service account, phase).
- `processCollector` / `parseProcessList` / `parsePsText` — host & workstation
  discovery: parse `ps -eo pid,user,comm,args`, keep only **candidate agents** (a
  `looksLikeAgent` heuristic: an agent runtime + agent-ish args, or any LLM egress),
  and extract LLM endpoints / outbound hosts from the command line. Catches the
  shadow agent running on a developer laptop or an edge node.
- `mcpCollector` / `parseMcpInventory` — MCP tool-server discovery: an inventory of
  servers → observations carrying the exposed tool surface, service account, and
  credentials (e.g. a `prod-shell` server with `shell.exec` + prod kubeconfig).
- `normalizeObservations` — map any other feed (CI, SaaS, network) into observations
  via a field mapping.
- `collectObservations` — run many collectors, merge + dedupe deterministically.

```bash
npm run aristotle -- ward-marshal discover --kubernetes --out .tmp/observations.json
npm run aristotle -- ward-marshal scan --observations .tmp/observations.json
```

Honest scope: shipping collectors to every cluster/host/SaaS/network tap is
operational work; what ships here is the real parsing + the explicit ingestion
boundary, not a turnkey fleet of sensors.

## Behavioral analysis

Census answers *which agents exist*. Behavioral analysis answers *what they are doing
over time* — and feeds the same warrant-gated interdiction. `analyzeAgentBehavior`
runs deterministic detectors over a time-ordered event stream and emits content-hashed
findings, each with a recommended disposition:

- **denial_burst** — a subject accumulating refusals (probing / misconfigured agent)
- **rate_spike** — a subject accelerating past its own baseline (runaway / cost spike)
- **first_seen** — a subject absent from the approved registry
- **off_hours** — activity outside allowed UTC hours
- **target_fanout** — one subject touching many distinct targets (lateral movement)
- **sequence_chain** — a configurable, optionally **cross-agent** ordered pattern where
  each step is individually compliant but the sequence is not (e.g. *read → external
  egress → delete* spread across three colluding agents)

It is AristotleOS-native in two ways: it can run directly over the **signed Governance
Evidence Ledger** (`behaviorEventsFromGel`) — the same tamper-evident record the gate
already produces — and a high/critical finding carries a disposition that routes
straight into warrant-gated interdiction. Detection is not the end state; **governed
response is.**

```bash
npm run aristotle -- ward-marshal behavior \
  --events examples/ward_marshal/behavior-events.sample.json \
  --rules examples/ward_marshal/behavior-rules.sample.json \
  --registry examples/ward_marshal/agent-registry.json \
  --allowed-hours 13-21
# or analyze the signed ledger itself:
npm run aristotle -- ward-marshal behavior --ledger .tmp/ward-marshal.gel.jsonl
```

The GEL stores the action *hash*, not the action body, so `sequence_chain` rules need
an enriched stream (action type/target, e.g. from the proxy/audit layer); the other
detectors run natively over the ledger.

## Real Adapters

Ward Marshal ships with three execution adapters. They never run from discovery
alone. The path is always: Commit Gate `ALLOW` -> verify Warrant -> execute
adapter -> signed adapter receipt.

### Kubernetes scale-down

Scales a Deployment, StatefulSet, or ReplicaSet to zero replicas with `kubectl`.

```bash
npm run aristotle -- ward-marshal interdict \
  --observations examples/ward_marshal/observations.enterprise.json \
  --registry examples/ward_marshal/agent-registry.json \
  --ward examples/ward_marshal/ward.enterprise_autonomy.yaml \
  --envelope examples/ward_marshal/authority_envelope.ward_marshal.yaml \
  --kind scale_to_zero \
  --execute \
  --adapter kubernetes-scale-down \
  --k8s-namespace payments \
  --k8s-kind deployment \
  --k8s-name shadow-agent \
  --operator-ticket SEC-1042 \
  --interdiction-authority soc-commander
```

### Credential revocation

Writes revoked credential references to an AristotleOS credential revocation
list. The credential broker refuses to inject any rule whose `credential_ref`
appears in that list.

```bash
npm run aristotle -- ward-marshal interdict \
  --observations examples/ward_marshal/observations.enterprise.json \
  --registry examples/ward_marshal/agent-registry.json \
  --kind revoke_credentials \
  --execute \
  --credential-revocations .aristotle/credential-revocations.json \
  --operator-ticket SEC-1042 \
  --interdiction-authority soc-commander
```

### Endpoint quarantine

Applies a Kubernetes `NetworkPolicy` with empty ingress and egress rules to
isolate pods matching the provided selector.

```bash
npm run aristotle -- ward-marshal interdict \
  --observations examples/ward_marshal/observations.enterprise.json \
  --registry examples/ward_marshal/agent-registry.json \
  --kind quarantine \
  --execute \
  --adapter endpoint-quarantine \
  --quarantine-namespace payments \
  --selector app=shadow-agent \
  --selector aristotleos.io/agent=rogue \
  --operator-ticket SEC-1042 \
  --interdiction-authority soc-commander
```

For Kubernetes adapters, pass `--kube-context <context>` or `--kubectl <path>`
when the operator needs an explicit cluster context or kubectl binary.

## Clean-Room Note

Ward Marshal is an AristotleOS-native design. It uses original AristotleOS schemas, examples, terminology, tests, and implementation. It does not copy, vendor, import, or imitate third-party source code, schemas, examples, tests, policy syntax, or branding.
