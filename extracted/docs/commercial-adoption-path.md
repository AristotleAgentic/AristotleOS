# AristotleOS Commercial Adoption Path

AristotleOS should be adopted like infrastructure, not like a chatbot feature.
The buyer path is:

```text
browser trial -> local sandbox -> pilot cluster -> shadow mode -> enforced mission -> evidence export -> expansion
```

The operating doctrine remains:

> Governance must bind at the execution boundary before irreversible state mutation or external action occurs.

Short form:

- Authority before consequence
- Warrant before execution
- Evidence after every decision

## 1. Policy Promotion Pipeline

Governance policy should move through explicit stages:

```text
draft -> shadow -> staged -> enforced -> retired
```

Each transition should preserve:

- policy hash
- Ward Manifest version
- Authority Envelope version
- operator identity
- impact analysis
- replay results
- rollback marker
- evidence bundle reference

The goal is to make governance changes reviewable in the same way enterprises review infrastructure changes.

## 2. Enterprise Identity Binding

Every consequential action should carry an identity chain:

```text
operator OIDC -> workload SPIFFE -> Authority Envelope -> Warrant -> GEL record
```

No anonymous authority should reach the Commit Gate. A Warrant proves scoped admissibility at the moment of consequence; it is not a reusable credential.

## 3. Evidence Bundle Standard

Evidence export is a product surface, not a log download.

An AristotleOS Evidence Bundle should include:

- Canonical Governed Action
- Ward context
- Authority Envelope
- compiled invariant results
- runtime register snapshot
- Commit Gate decision
- Warrant, when issued
- GEL record and chain link
- replay material
- verifier metadata

This lets a security team, auditor, insurer, or regulator reconstruct why execution was allowed, refused, escalated, or failed closed.

## 4. Failure Mode Console

Failure semantics should be operationally visible. The console should track:

- network partitions
- stale authority
- revocation lag
- witness disagreement
- replay divergence
- degraded edge operation
- disconnected edge reconciliation

The default posture is fail closed when authority freshness, runtime state, or witness agreement cannot be proven.

## 5. Governed Tool Gateway

AristotleOS becomes commercially powerful when it can sit in front of any consequential tool:

- HTTP APIs
- Kubernetes mutations
- shell commands
- database writes
- MCP tools
- robotics buses
- industrial commands

The gateway rule is simple: no external mutation executes until the Commit Gate admits the action and a Warrant is available when required.

## 6. Policy Test Harness

Governance needs tests. A policy test should assert:

- expected decision: `ALLOW`, `REFUSE`, `ESCALATE`, or `FAIL_CLOSED`
- expected reason codes
- whether a Warrant is issued
- whether GEL evidence is written
- whether replay reproduces the decision

This makes policy safer to change and easier to sell into enterprise engineering teams.

## 7. Runtime SLOs

Enterprise buyers need measurable operational claims. AristotleOS should publish:

- Commit Gate p95 latency
- Warrant issuance p95 latency
- GEL append p95 latency
- replay verification time
- revocation propagation time
- degraded-mode recovery timing

Benchmarks already exist under `npm run benchmark:runtime` and `npm run bench:execution-control`; reports should be attached to release candidates and pilot evidence.

## 8. Mission Templates

Reusable governed mission templates should remain AristotleOS-native and should compile into Wards, Authority Envelopes, Commit Gates, Warrant requirements, and GEL evidence requirements.

Initial templates live in:

```text
examples/mission-templates/catalog.json
```

The first set covers payments remediation, Kubernetes production deployment, disconnected drone patrol, and protected record correction.

## 9. Operator Command Center

The Command Center should expose the adoption path as five operator surfaces:

- **Builder**: visual Ward / Authority authoring over the deterministic `governance compile`, `governance diff`, and `governance explain` backend.
- **Shadow**: observe-only profiling over `execution-control shadow`, showing would-ALLOW / would-REFUSE / would-ESCALATE, findings, and rollout readiness.
- **Conflicts**: disconnected-edge reconciliation over `reconcileEdgeRecords`, showing edge reality, current central state, execution-time replay, GEL reference, and operator resolution actions.
- **Adopt**: buyer-readable path from sandbox to shadow to enforcement to evidence export, including mission templates, tool gateway posture, evidence profile, policy tests, SLOs, and identity chain.
- **Failure**: failure-mode drill console for partitions, stale authority, revocation lag, witness disagreement, replay divergence, and degraded edge operation.

The UI should stay thin. It presents and explains deterministic backend results; it does not invent separate governance semantics.

## Validation

Run:

```bash
npm run enterprise:adoption-path
```

This verifies the adoption-path documentation, mission-template catalog, and UI source references stay wired.
