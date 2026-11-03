# Trusted boundary and assurance scope

This inventory is an initial source audit, not a complete mediation proof.

| Surface | Existing mechanism | Assurance concern / next action |
|---|---|---|
| HTTP proxy (`execution-control-runtime/src/proxy.ts`) | Gate, signed Warrant, target match, egress classification, broker; new shared-local SQLite effect ownership | HTTP increment adds uncertainty, durable consumption, redirect refusal, URL-bound credentials and evaluation-control parity; independent observers, fencing, egress isolation and database rollback remain deployment concerns |
| Core chain (`governance-core/src/commit-gate.ts`) | MAE/Ward/Envelope validation and store consumption | Evaluate store atomicity, crash recovery, multi-process sharing separately |
| Adapter SDK (`adapter-sdk/src/index.ts`) | Gate ALLOW, Warrant present, adapter authorization, demonstration guard | `consumed: true` in an authorization object is not independently verified durable consumption; hardening still required |
| Protocol transports (`packages/*-adapter`, MAVLink, ROS2) | Domain-specific allowlists and transport checks | Preserve domain constraints; independent transport access/credentials can bypass wrappers |
| Agent task dispatch/completion (`services/agent-os`) | Service chain and pre-dispatch/completion gates | Lease retry/restart semantics need an effect-aware audit; do not infer no effect from worker loss |
| MCP/framework tools | Framework callbacks and governance client | Inventory callbacks, authority assumptions, and retry behavior individually |
| Mesh runtime | Signed envelopes/tokens, revocation, quota, partition reconciliation | Preserve bounded offline authority; no global duplicate-operation guarantee across independent partitions |
| Evidence transports and reconciliation | GEL, offline verifier, edge reconciliation | Hash integrity is not completeness; pins, independent anchors and observer provenance matter |

## Trust assumptions

- The boundary process, its code and dependencies, OS, database, and operator
  configuration must be trusted. The adversarial agent must not possess the
  destination credentials or direct actuator access outside the boundary.
- Authority issuers, signer custody, revocation distribution, clocks, and policy
  provisioning are explicit trust roots. A signature establishes who signed
  bytes, not whether the issuer was legitimately empowered in the outside world.
- Telemetry supplied by the action is not independently attested sensor truth.
- SQLite transactions coordinate participants sharing a local database. Separate
  database files, replicas, rollback to old snapshots, and malicious storage are
  outside that concurrency guarantee. Never place SQLite WAL on a network share
  and claim distributed consensus.
- A receiver can commit and lose its acknowledgment. A received status code can
  also precede eventual commit. No local transaction makes an arbitrary external
  effect atomic with consumption or GEL persistence.
- A trusted effect observer must attest settled outcome for terminal states.
  No-effect evidence must exclude delayed commit, not merely report current
  absence. Recovery of an in-flight attempt requires fencing the original
  dispatcher before a new authorization may be considered.
- An offline verifier needs externally configured trusted keys and an independent
  tip/checkpoint to reason about completeness. Evidence-chain integrity alone
  cannot prove no hidden execution or real physical safety.

## Deployment profiles

Development in-memory state, single-host durable state, shared-database service
deployment, disconnected edge, and real physical deployment must carry different
assurance claims. A test of one profile cannot certify another. Retain existing
capabilities, label assumptions, and add enforcement where each profile requires it.
