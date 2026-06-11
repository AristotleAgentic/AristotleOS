# How AristotleOS compares

This document maps the AristotleOS substrate against the projects it most often gets compared to. The goal is to be precise about where AristotleOS overlaps with an existing tool, where it differs deliberately, and where it is strictly weaker. No marketing.

Closes the "Document the differences from OPA / Cedar / JWT / OAuth / Guardrails / Sigstore line by line" action in [ROADMAP_TO_100.md](../ROADMAP_TO_100.md) § Category 3.

If you came here looking for a one-line distinction: AristotleOS is **a runtime substrate that gates each execution attempt against a live authority chain and emits a signed evidence record per decision**. OPA / Cedar / JWT / OAuth / Sigstore each solve one slice of that. AristotleOS does not replace them; it sits in a different position in the stack.

---

## tl;dr matrix

|  | Where it lives | What it answers | How AristotleOS overlaps | Where AristotleOS differs |
|---|---|---|---|---|
| **OPA** | Policy decision point (any caller asks "is this allowed?") | "Given this input, does my policy say yes?" | AristotleOS uses a similar input → policy → decision shape inside the Commit Gate | OPA is pure evaluation; AristotleOS binds the decision to a single-use signed Warrant and a tamper-evident GEL record |
| **AWS Cedar** | Authorization policy language for SaaS / API gateways | "Does this principal have this permission on this resource?" | AristotleOS's APL covers similar shape (subjects, actions, constraints) | Cedar is RBAC/ABAC focused; AristotleOS adds Wards (envelopes), Fluidity Tokens, and disconnected operation |
| **JWT** | A signed claim a holder presents | "Who claims to be the bearer of this token?" | AristotleOS's Warrant is a signed bearer artifact too | Warrants are **single-use**, bound to a content-addressed action, scoped to one envelope, and expire on the next-issued envelope version |
| **OAuth 2.0** | Delegated authorization protocol over HTTP | "How does a user authorize a client to call an API?" | AristotleOS uses a similar issue / present / verify flow for Warrants under Authority Envelopes | OAuth is for cross-org HTTP API access; AristotleOS is for cross-process **execution-control** with no assumption of network reachability |
| **Guardrails / NeMo Guardrails / LLM safety toolkits** | Inside the LLM call path | "Does this LLM input / output match a safety rule?" | Both refuse before emission | Guardrails inspects content; AristotleOS gates by authority chain — refuses without ever inspecting model output |
| **Sigstore / cosign** | Software supply chain | "Was this artifact signed by who I expected?" | Both produce a verifiable signed record | Sigstore signs artifacts at build / publish; AristotleOS signs decisions at runtime |
| **OpenTelemetry** | Cross-cutting observability | "What happened in my system?" | Both produce a structured record per event | OTel is informational; GEL is **legally evidentiary** (signed, hash-chained, single-step-verifiable) |
| **SLSA / in-toto** | Supply chain attestation | "What was the provenance of this build?" | Both produce signed provenance records | SLSA describes build; GEL describes runtime authority to act |

---

## OPA (Open Policy Agent)

### Overlap

- Both express policy as data + a decision function.
- Both follow input → policy → decision shape.
- AristotleOS's `evaluateCommitGate(ward, envelope, action, runtime, ...)` is the same shape as `opa eval` against a Rego module.

### Differences

- **OPA is stateless.** A decision is a pure function of input + policy. AristotleOS's gate is also pure but is wrapped in a Commit Gate that issues a single-use Warrant on `ALLOW`, records the decision to a hash-chained GEL, and refuses if any link in the authority chain (MAE → Ward → AuthorityEnvelope → FluidityToken → Warrant) is broken.
- **OPA does not produce evidence.** A `decision_log` plugin can emit logs to an external store, but the logs are not first-class artifacts you can replay. GEL records are.
- **OPA does not represent revocation natively.** You re-evaluate against fresh policy data. AristotleOS treats revocation as a distinct artifact that gossips through the mesh and is observable in every subsequent decision.
- **OPA is not designed for disconnected operation.** Sidecars require either bundle delivery or live network reachability. AristotleOS's EdgeNode is designed to keep operating under partition, capped by Fluidity Token TTL and the disconnected-warrant quota.

### When to use OPA instead

You want a pure policy decision point for HTTP traffic / Kubernetes admission / microservice authz, you don't need runtime authority chaining or evidence, and you have a separate audit system.

### When to use AristotleOS instead

You need every "yes" to be both a decision *and* an evidence record, you need to operate under network partition with bounded autonomy, and you need to prove externally that the decision happened.

---

## AWS Cedar

### Overlap

- Cedar's `permit` / `forbid` statements map cleanly onto APL's `allow` / `deny`.
- Both compile to a deterministic decision function.
- Both support attribute-based constraints (`when telemetry.X` in APL, `when { ... }` in Cedar).

### Differences

- **Cedar's substrate assumption is RBAC/ABAC on principals and resources.** AristotleOS's substrate assumption is a hierarchical authority chain — MAE delegates to Ward, Ward to Envelope, Envelope to Warrant.
- **Cedar policies do not produce or consume Fluidity Tokens.** AristotleOS adds time-boxed delegation tokens that an edge can present while disconnected from the issuing authority.
- **Cedar does not standardize an evidence format.** AristotleOS's GEL records are part of the substrate.

### When to use Cedar instead

Multi-tenant SaaS authorization where the access model is "principal P on resource R with permission X." Particularly strong if you're already on AWS Verified Permissions.

### When to use AristotleOS instead

Cyber-physical or agent-execution governance where the access model is "this action is admissible under a live authority envelope that may have just been revoked."

---

## JWT (RFC 7519)

### Overlap

- Both Warrants and JWTs are signed claims a holder presents to a verifier.
- Both can be verified offline given the issuer's public key.
- Both have an `exp` field.

### Differences

| | JWT | AristotleOS Warrant |
|---|---|---|
| Lifetime | Typically minutes to hours; replayable until expiry | Single-use; bound to one `action_hash` |
| Scope | Usually represents an identity / session | Always represents authorization for one specific action |
| Revocation | Operationally hard (rotation, denylist, short TTL) | First-class artifact (Revocation gossips through the mesh) |
| Verification | Signature + claims | Signature + envelope chain + revocation check + Fluidity Token + action-hash match |
| Replay protection | Caller-supplied (jti + nonce store) | Built in via single-use Warrant + content-addressed action |

### When to use JWT instead

You want a bearer identity / session token for HTTP APIs. JWT is the right abstraction for "this request is from Alice for the next 15 minutes."

### When to use AristotleOS Warrants instead

You want "this exact action, hashed and bound to this envelope, may execute once" — and you want it provable after the fact.

---

## OAuth 2.0 / OIDC

### Overlap

- Both follow an `issue → present → verify` flow.
- Both have a delegated authorization concept (OAuth's client / resource owner; AristotleOS's edge / root).
- Both use asymmetric crypto in the recommended profiles.

### Differences

- **OAuth's threat model is "a user grants a third-party client API access on their behalf."** AristotleOS's threat model is "an agent or process attempts to execute an action; the authority chain decides whether it may."
- **OAuth presumes network reachability between the client and the authorization server at issue time.** AristotleOS's Fluidity Token explicitly addresses the case where the edge cannot reach the authority at decision time.
- **OAuth has no native action-binding.** Tokens are scoped, but the scope is text; AristotleOS's Warrant is bound to a sha256 of the canonical action input.
- **OAuth's revocation story is RFC 7009 and the introspection endpoint.** Practically, deployments either use short TTLs or skip revocation. AristotleOS's revocation is a first-class artifact that gossips and is checked at every gate evaluation.

### When to use OAuth instead

User-facing delegated API access. SaaS integrations. Anything that needs an interactive consent screen.

### When to use AristotleOS instead

Machine-to-machine or agent-to-system execution control where you need to prove what the authority chain said at the exact moment of attempted execution.

---

## NeMo Guardrails / Guardrails AI / LLM safety toolkits

### Overlap

- Both refuse-before-emission.
- Both can be wired into an agent loop to interrupt unsafe execution.
- Both produce structured logs of refused attempts.

### Differences

- **Guardrails inspect content.** They read what the LLM produced (or is about to call) and apply rule-matching. AristotleOS refuses by **authority chain check**: an action is refused if the envelope is revoked / expired / out-of-scope, *regardless of whether the content looks fine*.
- **Guardrails do not issue or verify Warrants.** They do not bind a refusal to a signed evidence record that survives the LLM session.
- **AristotleOS does not inspect model content.** It inspects the action the model is about to take. A model could output anything; if the action does not pass the gate, it never executes.

These are complementary tools. A safety-critical deployment can use both: Guardrails to refuse on content, AristotleOS to refuse on authority.

### When to use Guardrails instead

You need content-level moderation, output filtering, prompt-injection defense, factual grounding checks.

### When to use AristotleOS instead

You need to prove that the model's *action* was admissible under a governance chain, regardless of what it said.

---

## Sigstore / cosign

### Overlap

- Both produce signed, verifiable records.
- Both can publish to a transparency log.
- Both reduce trust assumptions to a key infrastructure (Fulcio for Sigstore; Keyring / KMS for AristotleOS).

### Differences

- **Sigstore signs build artifacts at publish time.** AristotleOS signs decisions at runtime.
- **Sigstore's transparency log (Rekor) is an external public source of truth.** AristotleOS's GEL is per-operator; external timestamping is a [documented limitation](../LIMITATIONS.md#3-no-external-timestamp-authority) and a roadmap item.
- **Sigstore does not represent runtime authority.** Verifying a Sigstore signature tells you "this artifact was signed by this identity at this time." It does not tell you whether running that artifact was admissible under your governance.

The natural pairing: Sigstore for supply-chain attestation of the AristotleOS binaries themselves; GEL for runtime decisions made by those binaries.

---

## OpenTelemetry

### Overlap

- Both produce structured records of events.
- Both are designed to be queried and replayed.

### Differences

- **OTel is informational.** Spans and metrics describe what happened; they are not designed to be legally evidentiary.
- **GEL is evidentiary.** Each record is signed, hash-chained, and single-step verifiable: any third party who has the record, the public key, and the canonical action hash can prove the decision occurred.
- **OTel is not designed to gate execution.** It observes. GEL records the output of a gate that already either allowed or refused.

These are complementary. A production deployment uses both: OTel for "what is the system doing?" and GEL for "what did the authority chain decide?"

---

## SLSA / in-toto

### Overlap

- Both describe a signed provenance record.
- Both can be verified independently of the producing system.

### Differences

- **SLSA describes the build.** "This binary was built from this source by this builder at this level."
- **GEL describes the run.** "This action was attempted by this subject under this envelope at this time and the gate emitted this decision."

A defensible release picture has both: SLSA-attested build → AristotleOS-gated run → GEL-recorded outcome.

---

## What AristotleOS does NOT try to be

- **A web app authorization framework.** If you want "Alice is in the admin group, let her see /admin," use OPA / Cedar / Casbin.
- **A general policy language.** APL is intentionally small. It exists because the Ward/Envelope shape needs *some* policy surface; it is not aiming to replace Rego or Cedar.
- **A SaaS identity provider.** No login screens. No federated identity. No social login.
- **An LLM content filter.** Not its job. Pair with Guardrails / NeMo / LlamaGuard for content.
- **A blockchain.** GEL is hash-chained but is not a public consensus ledger. No tokens. No global ordering.
- **A certification.** No SOC 2, no FedRAMP, no DO-178C. See [LIMITATIONS.md § 7](../LIMITATIONS.md#7-no-certification).

---

## Where AristotleOS is strictly weaker

Be honest: every comparison above has a direction in which AristotleOS does less than the comparator.

- **OPA has a much larger policy expressiveness (Rego).** APL covers a fraction of what Rego does. If you need rich policy composition, write it directly in TypeScript against the substrate types rather than expecting APL to grow.
- **Cedar has a formal verification posture.** AristotleOS has property tests on the gate, not a Lean / Coq / Dafny model.
- **JWT has an order-of-magnitude larger ecosystem.** Every language has a JWT library. AristotleOS's Warrant verifier is one TypeScript implementation; the [open spec](../ROADMAP_TO_100.md#category-3--strategic-novelty) is a roadmap item.
- **OAuth has a standards body.** AristotleOS does not.
- **Sigstore has Rekor as a public transparency log.** AristotleOS does not yet integrate an external timestamp authority — see [LIMITATIONS § 3](../LIMITATIONS.md#3-no-external-timestamp-authority).
- **OTel has industry-wide collectors / backends / dashboards.** GEL does not. The reviewer flow is what you have today.

If any of those gaps are dealbreakers for your use case, AristotleOS is the wrong substrate for that piece of the system. It may still be the right substrate for the part that gates execution.

---

## See also

- [LIMITATIONS.md](../LIMITATIONS.md) — every place this substrate falls short of production-grade.
- [docs/MARKET_POSITIONING.md](MARKET_POSITIONING.md) — where this fits in the broader landscape.
- [docs/THREAT_MODEL.md](THREAT_MODEL.md) — what AristotleOS defends against and what it does not.
- [ROADMAP_TO_100.md](../ROADMAP_TO_100.md) — the open work to close the gaps above.
