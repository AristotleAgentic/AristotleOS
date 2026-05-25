# Telecom autonomous-network pilot path

Carrier networks are becoming agent-operated — NOC copilots and closed-loop
automation that change live RAN, core, and transport. AristotleOS governs those
changes at the same execution boundary as any other agent action: a telecom request
becomes a Canonical Governed Action, passes the Commit Gate (authority → physical/
service invariants → classification → budget → dual control), and only a single-use
Warrant + a hash-chained GEL record let it proceed. AristotleOS imports no vendor
SDK and executes nothing directly — it decides, evidences, and hands an authorized
action to the operator's existing automation.

## Typed adapter surfaces

`telecomAdapterToAction` turns the four dominant carrier interfaces into governed
actions, each with the runtime registers a change must present (`TELECOM_ADAPTER_CATALOG`):

| Adapter | Consequence boundary | Required registers |
|---|---|---|
| **TM Forum Open API** (`tmf-open-api`) | OSS/BSS service, resource, product, trouble-ticket, customer-impacting mutations | `change_ticket`, `noc_operator`, `maintenance_window` |
| **NETCONF/YANG** (`netconf-yang`) | element config edits, candidate/confirmed commits, rollback markers | `change_ticket`, `device_lock`, `rollback_plan` |
| **gNMI/gNOI** (`gnmi-gnoi`) | telemetry-bound set ops, diagnostics, cert rotation | `change_ticket`, `telemetry_fresh`, `device_identity` |
| **O-RAN A1/R1** (`oran-a1-r1`) | Non-RT RIC policy, rApp exposure, AI/ML model deploy, RAN optimization intent | `change_ticket`, `ric_policy_type`, `impact_assessment` |

`aristotle telecom adapters` lists them; `aristotle telecom templates` lists the
carrier Ward/policy/action fixtures under `examples/telecom/`.

## NOC evidence

`exportTelecomEvidenceBundle` wraps a standard Evidence Bundle with NOC context
(change ticket, operator, service, scope, rollback statement, and field redactions
such as `imsi`), so a change record is offline-verifiable by an auditor or regulator.

```bash
aristotle telecom evidence export \
  --ward telecom/ward.ran_region_west.yaml \
  --envelope telecom/authority_envelope.noc_change_orchestrator.yaml \
  --ledger .tmp/telecom.gel.jsonl --out telecom-evidence.json \
  --ticket CHG-2026-0517 --operator operator:netops-west \
  --service mobile-broadband --rollback "confirmed rollback in change ticket" --redact imsi
```

## Carrier-scale drills

Three deterministic simulations exercise the boundary at carrier shape (also runnable
as `bench:telecom` / `soak:telecom`):

- **`runCarrierScaleBenchmark`** (`telecom benchmark`) — Commit-Gate throughput + p50/p95/p99 over a batch of governed changes.
- **`runReconnectStormSimulation`** (`telecom reconnect-storm`) — many edge nodes reconnecting after a partition; reconciles their offline decisions against current policy (exits non-zero when conflicts remain — an ops gate).
- **`simulateMultiRegionLedgerSoak`** (`telecom ha-soak`) — multi-region GEL append + verify, confirming the chain stays intact across regions.

## Doctrine, unchanged

Telecom is a *source* of governed actions and evidence context — not a new trust
path. Every change still requires Commit Gate ALLOW, a single-use Warrant, and a GEL
record; the gravest changes (e.g. cell shutdowns) are refused or escalated, and can
be put under budget or M-of-N dual control like any other action. See
`docs/telecom-threat-model.md` for the carrier-specific threats and
`examples/telecom/` for runnable fixtures.
