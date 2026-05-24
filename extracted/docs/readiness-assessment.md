# AristotleOS — defense pilot readiness assessment

**Version assessed:** v0.1.12 · **Scope:** the Ward/Warrant execution-control
boundary, its operator console, and the supply-chain/HA posture around them.

This is a self-assessment written to be handed to a skeptical program office. It is
deliberately honest about the line between *what the software does and proves* and
*what still requires hardware, accreditation, external parties, or operational
time on target infrastructure*. Where we have not done something, we say so.

---

## 1. Executive summary

AristotleOS is **software-complete for a controlled defense pilot** and **not yet
accredited for production on classified or safety-of-life systems** — which is the
expected state for a system at this stage, and we do not claim otherwise.

The core thesis — *governance must bind at the execution boundary before
irreversible state mutation or external action occurs* — is implemented as a real,
deterministic, cryptographically-evidenced gate, not a policy overlay. Every
code-addressable item from an independent defense-evaluator review is closed and
tested. What remains is, by nature, **not closable in code**: a third-party audit,
a FIPS-validated crypto module, HSM-resident keys, an accredited cross-domain
solution, DoD PKI integration, and multi-node soak on representative hardware.

**Honest TRL: ~5–6.** The technology is validated in a relevant test environment
(deterministic gate verified by a differential property oracle; full stack run
end-to-end locally). It has **not** been validated in an operational environment,
which is exactly what a pilot is for.

---

## 2. What AristotleOS is

A runtime authority boundary for autonomous agents. Before an agent takes a
consequential action, the action passes a **Commit Gate** that checks it against a
**Ward** (the governed context + physical invariants) and an **Authority Envelope**
(what this subject may do). On ALLOW it issues a single-use, Ed25519-signed
**Warrant**; every decision — allow, refuse, or escalate — is written to a
hash-chained **Governance Evidence Ledger (GEL)** that verifies offline. Authority
before consequence; warrant before execution; evidence after every decision.

---

## 3. Capability inventory (built + verified)

Grounded in the repository at v0.1.12: 29 runtime modules, 32 test files / 30 test
suites, a 20-entry threat model, 32 docs.

| Capability | State | Evidence |
|---|---|---|
| Deterministic Commit Gate (Ward × Envelope × invariants) | **Built, property-verified** | differential oracle (`gate.property.test.ts`), 15 closed-set reason codes |
| Ed25519 Warrants (single-use, nonce + trusted-time bound) | **Built** | `issueWarrant`/`verifyWarrant`; replay/skew/lifetime guards |
| Hash-chained signed evidence ledger + offline Evidence Bundles | **Built** | GEL verify, bundle export/verify; SQLite + Postgres backends |
| Physical-invariant interlocks + attested telemetry | **Built (boundary)** | `attestation.ts` (device-signed readings; `TELEMETRY_UNATTESTED`) |
| RBAC + OIDC (JWKS) + mTLS/PIV client-cert seam | **Built (software)** | `auth.ts`; alg-confusion/`none` rejection tests |
| Kill switch, revocation, per-subject rate limiting, replay protection | **Built** | server + gate tests |
| DDIL / captured-edge containment (staleness-deny, offline quota) | **Built (boundary)** | `edge-containment.ts` |
| MLS classification labels + CDS typed boundary | **Built (boundary)** | `classification.ts` (`CLASSIFICATION_VIOLATION`) |
| Per-Ward criticality fail-mode policy + HA topology | **Built** | `fail-mode.ts`; active-active over serialized durable ledger |
| Supply chain: blocking dep-audit + SLSA provenance + SBOM attestation | **Built (CI)** | `audit-deps.mjs`; `release.yml` (attests on tag) |
| Ward Marshal: rogue-agent census → behavior → warrant-gated interdiction | **Built** | census/behavior/collectors + adapters |
| Five operator consoles wired to real backends | **Built, verified live** | Command Center, Builder, Shadow, Marshal, Conflict Inbox |
| Zero-dep SDK, installable CLI, Helm chart, pilot installer | **Built** | `package:cli:check`, `helm:validate` in CI |

---

## 4. Maturity by dimension

| Dimension | Rating | Honest note |
|---|---|---|
| Core governance logic | **Pilot-ready** | deterministic, property-tested, fail-closed by construction |
| Cryptographic evidence | **Pilot-ready (software)** | Ed25519/SHA-256 via `node:crypto`; **not** a FIPS-validated module (C2); HSM is a seam, not deployed (C1) |
| AuthN / AuthZ | **Pilot-ready (software)** | RBAC/OIDC/mTLS complete; real PIV/CAC + DoD PKI/OCSP is integration (C5) |
| Availability / durability | **Pilot-ready (software)** | Postgres serialized append, k8s, graceful shutdown; **no** multi-node soak/chaos on target HW (C6) |
| Supply-chain integrity | **Strong** | blocking audit live; provenance/SBOM attest on GitHub release |
| Multi-level security | **Boundary-ready** | typed enforcement; **accredited CDS** + label provenance are external (C5) |
| Observability | **Pilot-ready** | Prometheus metrics, W3C trace context, structured audit, SIEM sink |
| Independent assurance | **Not yet** | audit packet prepared; **no third-party audit performed** (C3) |
| Accreditation (ATO/RMF/STIG) | **Not started** | program-gated artifacts (C4) |

---

## 5. What a program office will still require

These are real and we are not pretending code closes them (tracked as Tier C in
`defense-readiness.md`):

1. **Third-party security audit / pen test** (C3) — independent review of the
   crypto, authorization, and gate-bypass surface. We provide the auditor packet,
   threat model (T1–T20), and a differential oracle to accelerate it.
2. **FIPS 140-3 validated crypto module** (C2) — current code has a FIPS-mode boot
   guard and posture doc, but running on a *validated* build is a deployment
   requirement, not a code change.
3. **HSM-resident asymmetric signing** (C1) — the external-signer interface exists
   (`signing.ts`, KMS adapter); HSM provisioning + an async signing path is
   hardware/ops.
4. **Accredited cross-domain solution + DoD PKI/OCSP + PIV/CAC** (C5) — the MLS and
   client-cert boundaries enforce against these; the accreditation and government
   infrastructure are external.
5. **ATO / RMF / STIG artifacts** (C4) — program-gated; not technical work we can
   self-complete.
6. **Multi-node cluster soak + chaos on representative hardware** (C6) — needs real
   infrastructure and operational time.

---

## 6. Recommended sequence to a pilot

A phased path that front-loads what unblocks an evaluator:

- **Phase 0 — Evaluator enablement (days).** Hand over: this assessment, the
  threat model, `docs/auditor-guide.md`, the differential oracle, and a one-command
  local stand-up. Goal: an evaluator reproduces a governed decision + offline
  evidence verification in an afternoon.
- **Phase 1 — Constrained pilot (weeks).** Deploy the boundary in front of one
  non-safety-critical, low-classification agent workflow (a `routine`/`best_effort`
  Ward). Run Shadow Mode first (observe-only), then enforce. Wire real degradation
  detectors into `degraded_conditions`. Stand up the Postgres-backed active-active
  topology and exercise it.
- **Phase 2 — Assurance (parallel, weeks–months).** Commission the third-party
  audit (C3); deploy on a FIPS-validated build (C2); move signing to an HSM (C1).
  These run in parallel with Phase 1 and don't block it.
- **Phase 3 — Classified / safety-critical (program-gated).** CDS accreditation +
  DoD PKI (C5), ATO/RMF/STIG (C4), and multi-node soak on target hardware (C6).
  This is where the program office, not engineering, sets the pace.

---

## 7. What this is *not* (limitations)

- **Not accredited.** No ATO; do not field on classified/safety-of-life systems yet.
- **Not a FIPS-validated cryptographic product** today (guarded, not validated).
- **Not a substitute for the operator's integrations** — attested-telemetry device
  keys (TPM), degradation detectors, the CDS, and PKI are deployment-specific. The
  software provides the *typed, tested boundary* each enforces against; it does not
  ship the hardware or the accreditation.
- **Not soak-proven at multi-node scale** on representative infrastructure.

The honest one-line verdict: **a credible, evidence-first governance boundary that
is ready to be piloted and audited — and explicit about the externally-gated steps
between a pilot and a production authority-to-operate.**
