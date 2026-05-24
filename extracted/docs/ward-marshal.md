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

## Clean-Room Note

Ward Marshal is an AristotleOS-native design. It uses original AristotleOS schemas, examples, terminology, tests, and implementation. It does not copy, vendor, import, or imitate third-party source code, schemas, examples, tests, policy syntax, or branding.
