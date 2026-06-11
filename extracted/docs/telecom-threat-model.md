# Telecom Threat Model Addendum

This addendum covers AristotleOS in carrier and communication service provider environments. The core rule remains unchanged: authority before consequence, warrant before execution, evidence after every decision.

## Scope

Telecom pilots should begin with bounded autonomous network operations:

- OSS/BSS service-order and trouble-ticket mutations
- NETCONF/YANG device configuration edits
- gNMI/gNOI set operations and certificate operations
- O-RAN A1/R1 policy and model deployment requests
- disconnected edge network nodes that reconnect with locally recorded decisions

AristotleOS does not replace OSS, orchestration, EMS/NMS, RIC, or assurance tooling. It becomes the execution-control boundary those systems must pass before a consequential mutation is made.

## Protected Assets

- Ward manifests and Authority Envelopes for carrier regions, network slices, RAN markets, transport domains, and telco-cloud clusters
- Warrant signing keys and revocation state
- Governance Evidence Ledger records and telecom Evidence Bundles
- CPNI, subscriber identifiers, operational telemetry, change tickets, and rollback material
- Adapter credentials for OSS/BSS APIs, NETCONF sessions, gNMI/gNOI targets, O-RAN interfaces, Kubernetes clusters, and edge nodes
- Runtime registers such as maintenance window, device lock, operator identity, telemetry freshness, policy version, and rollback readiness

## Carrier Threats

| ID | Threat | Impact | AristotleOS control |
| --- | --- | --- | --- |
| TEL-01 | Autonomous misconfiguration changes live network state without an approved change context. | Outage, SLA breach, regulatory exposure. | Ward + Authority Envelope + Commit Gate require scoped action, change ticket, NOC operator, maintenance window, and Warrant. |
| TEL-02 | OSS/BSS agent has broad standing credentials. | Customer-impacting service or billing mutation. | No standing machine power: adapter executes only after Warrant verification, with action hash and evidence. |
| TEL-03 | RAN optimization agent pushes unsafe O-RAN policy. | Cell degradation, emergency service risk, market outage. | O-RAN actions are typed Canonical Governed Actions, can require dual-control and physical/network invariant checks. |
| TEL-04 | NETCONF/gNMI action uses stale telemetry or missing device lock. | Race condition against human NOC or another controller. | Runtime Register Snapshot must include telemetry freshness, device identity, lock state, and rollback plan. |
| TEL-05 | Disconnected edge node executes beyond stale authority. | Split-brain network operations. | Cached authority is bounded by Ward, Warrant TTL, local fail-closed rules, and reconnect reconciliation. |
| TEL-06 | Reconnect storm floods the ledger and conflict queue. | NOC overload, delayed conflict resolution. | Reconnect-storm benchmarks and Conflict Inbox classify agreements versus conflicts before operator action. |
| TEL-07 | GEL or telecom Evidence Bundle leaks CPNI or subscriber identifiers. | Privacy and compliance failure. | Evidence export includes redaction and retained-field manifests. Subscriber identifiers should be hashed, tokenized, or omitted by default. |
| TEL-08 | Vendor or rApp identity cannot be tied to accountable authority. | Non-repudiation gap. | Operator OIDC, workload SPIFFE, Authority Envelope, Warrant, and GEL record form an attributable chain. |
| TEL-09 | Warrant signing key compromise. | False authorization proof. | Key rotation, revocation lists, trusted key pinning, durable signer configuration, and GEL verification. |
| TEL-10 | Time or ordering manipulation at edge. | Replay divergence and stale decision acceptance. | Evidence captures requested_at, issued_at, expires_at, policy version, prior GEL hash, and replay material. |

## Failure Semantics

- Missing Ward, missing Authority Envelope, expired authority, revoked authority, missing runtime register, and policy version mismatch fail closed or escalate according to criticality.
- Adapter execution must not occur when the decision is REFUSE, ESCALATE, REVOKED, or FAIL_CLOSED.
- O-RAN and device-configuration changes should default to dual-control until the carrier has enough Shadow Mode evidence to narrow the scope.
- Disconnected edge operation should be limited by short Warrant TTLs, explicit mission boundaries, and a local ledger that can be reconciled when connectivity returns.
- Evidence export must redact CPNI by default and should keep a verifier-readable redaction manifest.

## Engineering Recommendations

- Treat each RAN market, network slice, transport region, telco-cloud cluster, or critical OSS domain as its own Ward.
- Issue short-lived Authority Envelopes per mission or change window.
- Require dual-control for NETCONF commits, O-RAN policy deployment, lawful intercept surfaces, emergency service surfaces, and customer-impacting bulk actions.
- Pin workload identity with SPIFFE/SPIRE where possible and record operator identity in the GEL.
- Run Shadow Mode before enforcement. Shadow Mode may report proposed policy adjustments, but it must not auto-weaken policy.
- Run `npm run bench:telecom` and `npm run soak:telecom` before pilot expansion.
- Export telecom Evidence Bundles for pilot review and audit replay.

## Acceptance Bar

A telecom pilot is not ready for production until:

- every live mutation path is behind a Commit Gate
- every ALLOW produces a single-use Warrant
- every decision appends to a verifiable GEL
- disconnected edge nodes have bounded authority and reconciliation
- privileged adapters use real typed interfaces with no anonymous credentials
- NOC operators can see what is pending, what was admitted, and what evidence was exported
