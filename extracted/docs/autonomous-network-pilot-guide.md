# Autonomous Network Pilot Guide for CSPs

This guide gives a communication service provider a practical AristotleOS pilot path for governed autonomous network execution.

The pilot doctrine is simple:

- authority before consequence
- warrant before execution
- evidence after every decision

## Pilot Outcome

By the end of the pilot, a NOC team should be able to:

- define a telecom Ward for a bounded network domain
- bind an autonomous network agent to a scoped Authority Envelope
- evaluate OSS/BSS, NETCONF, gNMI/gNOI, and O-RAN changes through the Commit Gate
- issue a Warrant only on ALLOW
- refuse or escalate unsafe actions before adapter execution
- export a telecom Evidence Bundle for audit and executive review
- run carrier-scale benchmark and reconnect-storm drills

## Reference Files

Telecom pilot files live under `examples/telecom`:

- `ward.ran_region_west.yaml`
- `authority_envelope.noc_change_orchestrator.yaml`
- `policy/ran_region_west.apl`
- `actions/tmf_service_order_patch.json`
- `actions/netconf_edit_config.json`
- `actions/gnmi_set_qos.json`
- `actions/oran_a1_policy_put.json`
- `actions/refuse_cell_shutdown.json`

## 1. Verify the Telecom Runtime

```bash
npm run test:telecom
```

This proves the typed telecom adapters, Ward/Authority evaluation, Warrant issuance, GEL append, telecom Evidence Bundle export, reconnect-storm simulation, and multi-region ledger soak primitives.

## 2. Inspect Templates and Adapter Surfaces

```bash
npm run aristotle -- telecom templates
npm run aristotle -- telecom adapters
```

The current adapter surfaces are:

- TM Forum Open API for OSS/BSS mutations
- NETCONF/YANG for device configuration edits
- gNMI/gNOI for set operations and controlled device operations
- O-RAN A1/R1 for RIC policy and model deployment requests

These are typed AristotleOS boundaries. They do not execute carrier systems directly until the Commit Gate has admitted the action and a Warrant verifies.

## 3. Evaluate a Governed Network Action

```bash
npm run aristotle -- execution-control evaluate \
  --ward examples/telecom/ward.ran_region_west.yaml \
  --envelope examples/telecom/authority_envelope.noc_change_orchestrator.yaml \
  --action examples/telecom/actions/tmf_service_order_patch.json \
  --ledger .tmp/telecom.gel.jsonl \
  --now 2026-05-25T15:00:00.000Z
```

Expected result:

- `decision=ALLOW`
- `warrant_id=wrn-...`
- `ledger_verification=ok`

Run a refusal path:

```bash
npm run aristotle -- execution-control evaluate \
  --ward examples/telecom/ward.ran_region_west.yaml \
  --envelope examples/telecom/authority_envelope.noc_change_orchestrator.yaml \
  --action examples/telecom/actions/refuse_cell_shutdown.json \
  --ledger .tmp/telecom.gel.jsonl \
  --now 2026-05-25T15:00:00.000Z
```

Expected result:

- `decision=REFUSE`
- `reason_codes=ACTION_DENIED`
- no Warrant is issued
- the refusal is still recorded in the GEL

## 4. Export a Telecom Evidence Bundle

```bash
npm run aristotle -- telecom evidence export \
  --ward examples/telecom/ward.ran_region_west.yaml \
  --envelope examples/telecom/authority_envelope.noc_change_orchestrator.yaml \
  --ledger .tmp/telecom.gel.jsonl \
  --out .tmp/telecom-evidence.json \
  --ticket CHG-2026-0517 \
  --operator operator:netops-west \
  --scope ran-market-west \
  --service mobile-broadband \
  --rollback "confirmed rollback in change ticket" \
  --redact imsi \
  --redact msisdn
```

The exported bundle contains:

- selected GEL record
- Ward and Authority context
- Warrant material when the selected decision was admitted
- NOC change ticket and operator context
- impacted services
- standards profile
- redaction manifest
- verification result and bundle hashes

## 5. Run Carrier-Scale Drills

```bash
npm run bench:telecom
npm run soak:telecom
```

For a smaller local run:

```bash
npm run aristotle -- telecom benchmark \
  --ward examples/telecom/ward.ran_region_west.yaml \
  --envelope examples/telecom/authority_envelope.noc_change_orchestrator.yaml \
  --count 500 \
  --out reports/telecom-carrier-benchmark.json
```

Reconnect storm:

```bash
npm run aristotle -- telecom reconnect-storm \
  --ward examples/telecom/ward.ran_region_west.yaml \
  --envelope examples/telecom/authority_envelope.noc_change_orchestrator.yaml \
  --edge-nodes 25 \
  --records-per-node 100 \
  --out reports/telecom-reconnect-storm.json
```

Multi-region soak:

```bash
npm run aristotle -- telecom ha-soak \
  --ward examples/telecom/ward.ran_region_west.yaml \
  --envelope examples/telecom/authority_envelope.noc_change_orchestrator.yaml \
  --regions east,central,west \
  --decisions-per-region 500 \
  --out reports/telecom-ha-soak.json
```

## 6. Operator Workflow

Use the Command Center NOC tab to walk the buyer through:

1. Create governed network mission.
2. Bind change ticket, maintenance window, NOC operator, and precheck registers.
3. Profile proposed actions in Shadow Mode.
4. Route high-impact network mutations to dual-control approval.
5. Admit the action at the Commit Gate.
6. Verify the Warrant before adapter execution.
7. Export the telecom Evidence Bundle.

The operator story should never say "the adapter decided." The Commit Gate decides. The adapter executes only after Warrant verification.

## Pilot Exit Criteria

The pilot is credible when the CSP can see:

- a live or replayed autonomous network change admitted through the Commit Gate
- a denied high-risk action blocked before execution
- a telecom Evidence Bundle that verifies offline
- benchmark results for decision latency and ledger integrity
- reconnect-storm results with operator-resolvable conflicts
- a documented failure posture for stale authority, partitions, and replay divergence
