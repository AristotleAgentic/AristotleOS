# Maritime Port Operator Pilot Guide

This guide describes a narrow, defensible AristotleOS pilot for a port authority,
container terminal operator, or maritime logistics operator.

## Pilot Doctrine

Autonomous or automated terminal actions are not trusted because they came from a
known agent, workflow, or vendor platform. They are admitted only when the Ward,
Authority Envelope, runtime registers, physical invariants, and Commit Gate all
agree. ALLOW produces a single-use Warrant; every decision commits evidence to
GEL.

## Recommended Pilot

Start with a simulator, test terminal lane, lab TOS integration, or replay feed.
Do not put AristotleOS directly in front of live crane/shore-power controllers
until the pilot has proven telemetry, fail-closed behavior, and operator
procedures.

Pilot actions:

1. Govern a TOS container release.
2. Refuse a release while customs or security hold is active.
3. Refuse a crane move while the exclusion zone is not clear.
4. Escalate berth clearance when PNT/AIS state is missing or stale.
5. Require dual-control for crane, shore-power, VTS, and hazmat actions.
6. Export a Port Evidence Bundle.

## Files

- `examples/port/ward.container_terminal_alpha.yaml`
- `examples/port/authority_envelope.terminal_orchestrator.yaml`
- `examples/port/policy/container_terminal_alpha.apl`
- `examples/port/actions/*.json`

## Commands

```bash
npm run aristotle -- port templates
npm run aristotle -- port adapters
npm run aristotle -- execution-control evaluate \
  --ward examples/port/ward.container_terminal_alpha.yaml \
  --envelope examples/port/authority_envelope.terminal_orchestrator.yaml \
  --action examples/port/actions/allow_container_release.json \
  --ledger ./.tmp/port.gel.jsonl \
  --now 2026-05-25T15:00:00.000Z
```

Export:

```bash
npm run aristotle -- port evidence export \
  --ward examples/port/ward.container_terminal_alpha.yaml \
  --envelope examples/port/authority_envelope.terminal_orchestrator.yaml \
  --ledger ./.tmp/port.gel.jsonl \
  --out ./.tmp/port-evidence.json \
  --port port-of-aristotle \
  --facility facility-alpha \
  --terminal terminal-alpha \
  --ops-center terminal-control-alpha \
  --berth berth-7 \
  --yard-block A12 \
  --gate gate-3 \
  --container MSCU1234567 \
  --vessel IMO9876543 \
  --voyage VOY-ALPHA-19 \
  --release REL-2026-0525-001 \
  --equipment ASC-12 \
  --cargo-type reefer \
  --hazmat none \
  --reefer \
  --weight-kg 22400
```

## Buyer-Readable Success Criteria

- Operators can see why an action was ALLOW / REFUSE / ESCALATE.
- No Warrant is issued for customs hold, unsafe crane, missing PNT, or forced
  gate-open paths.
- Every decision is replayable from GEL and exportable as a Port Evidence Bundle.
- Shadow Mode can profile terminal workflows before enforcement.
- Conflict Inbox can reconcile disconnected gate or yard-edge decisions.
- Ward Marshal can inventory rogue automation and route containment through the
  same Commit Gate.
