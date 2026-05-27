# Market Positioning

This document positions AristotleOS as a software category. It does not contain financial projections, customer references, or claims of traction. Those don't exist yet, and they shouldn't be invented.

---

## Category

**Governance execution substrate for autonomous systems.**

The name describes what the substrate does:

- *Execution substrate* — interposed between an agent and the consequence its actions would produce.
- *Governance* — every consequential action is signed, content-bound, single-use, and recorded.
- *For autonomous systems* — applicable to AI agents, autonomous vehicles, industrial controllers, infrastructure agents, and other systems where action consequences land outside the agent's process.

The substrate is closest in spirit to **policy-as-code engines + signed-provenance systems** combined and applied to actuation rather than to API access or build artifacts.

---

## Adjacent markets

The substrate's surface area touches several existing markets without being a duplicate of any of them.

| Adjacent market | Representative products | Where AristotleOS shares ground | Where it differs |
|---|---|---|---|
| **Policy-as-code / authorization engines** | Open Policy Agent, Cedar, Casbin, Oso | Both evaluate `(subject, action, resource) → decision`. Both expose declarative policy languages. | AristotleOS produces signed, single-use, content-bound Warrants and hash-chained evidence; OPA/Cedar return ALLOW/DENY but don't mint a per-action conveyance |
| **Cloud IAM** | AWS IAM, GCP IAM, Azure RBAC | Authority is structured and auditable | AristotleOS extends beyond cloud-API surfaces to wire-level actuation across MAVLink, OPC-UA, DNP3, Modbus, BACnet, K8s admission, ROS2 |
| **Agent guardrails** | LangChain Guardrails, NeMo Guardrails, AWS Bedrock Guardrails, Azure AI Content Safety | Both aim to prevent agents from doing bad things | Guardrails operate on model output (text classification, prompt rewriting). AristotleOS operates on the *action* the agent proposes — post-output, pre-consequence |
| **OT / ICS cybersecurity** | Claroty, Dragos, Nozomi, Tenable.ot | Both touch industrial protocols | Those products detect and monitor network anomalies. AristotleOS structurally refuses unauthorized writes at the adapter layer (point-allowlists, value caps, refusal-before-emission) |
| **Supply-chain attestation** | Sigstore, in-toto, SLSA, npm provenance | Both use signed hash-chains as proof | Sigstore attests software artifacts. AristotleOS attests agent decisions. Combining them (anchoring GEL roots to Sigstore) is a natural complement |
| **Evidence / audit infrastructure** | AuditBoard, OneTrust, governance audit trails | Both produce auditable records | AristotleOS's records are reproducibly verifiable via local re-run and offline evidence bundles, not just stored |
| **Autonomous-systems safety** | DO-178C tooling, ASTM F3201, IEC 61508 lifecycle products | Adjacent regulatory framing | AristotleOS holds no certification. It provides primitives a certified safety case could rely on |
| **Distributed authority tokens** | Macaroons, biscuit-auth, JWT, OAuth | Both convey delegated authority | JWTs are reusable bearer tokens. Warrants are single-use, content-bound, nonce-bound, partition-tolerant |

---

## The wedge

What's the smallest, most pointed claim that's both true and not addressed by the adjacent markets?

**Warranted execution before consequence: a per-action, signed, content-bound, single-use conveyance, refused at the wire when authority drift is detected, recorded in a hash-chained ledger, verifiable by a third party who holds only the artifact.**

That single sentence contains five primitives that don't co-exist in any of the comparable products:

1. **Per-action** (not per-session, not per-API-key).
2. **Content-bound** (canonical action hash; cannot authorize a different action).
3. **Single-use** (consumed at the boundary; not a reusable token).
4. **Refused at the wire** (adapter layer rejects when authz drift is detected, before bytes hit the protocol).
5. **Verifiable by a third party** (insurance carrier, claim auditor, regulator) with no access to the issuing gate.

---

## First plausible verticals

Ordered by signal strength based on the substrate's current capability surface, not by market size estimates (which the repo doesn't have data to defend):

1. **UAV / disconnected autonomy** — operators of UAV fleets in degraded-RF environments need bounded disconnected authority. The 40-asset partition scenario is a working demonstration of exactly this need. Adapter: `@aristotle/mavlink-px4`.
2. **Industrial protocol actuation governance** — operators of OPC-UA / Modbus / DNP3 / BACnet endpoints needing pre-emission refusal of unauthorized writes. Adapters: `@aristotle/{opcua,dnp3,modbus,bacnet}-adapter`.
3. **Kubernetes infrastructure mutation governance** — clusters that want every `CREATE` / `UPDATE` / `DELETE` admission decision recorded with a content-bound warrant. Adapter: `@aristotle/k8s-admission`.
4. **Insurance / claim audit evidence** — counterparties that want offline-verifiable evidence of *who authorized what, under what authority, when*. Replay artifact + warrant verifier + counterfactual replay collectively address this.
5. **Regulator-facing audit substrate** — a regulator examining an incident wants to re-evaluate the decisions under either the policy that was in effect or under a tightened policy. Time Machine handles this.

For each, the substrate provides the primitives; pilots provide the validation.

---

## Buyer pain (the question that triggers a search)

> *"An autonomous system did $X. Who authorized it, under what authority, can we prove it, and would the new policy have refused it?"*

That's the question. The four sub-questions map to four primitives:

| Sub-question | Primitive |
|---|---|
| Who authorized it? | Warrant (signed, attributed) |
| Under what authority? | Ward + AuthorityEnvelope (signed chain) |
| Can we prove it? | GEL record (hash-chained, offline-verifiable) |
| Would the new policy have refused it? | Time Machine (counterfactual replay) |

A buyer who can articulate this question — typically in regulated industries, autonomy operations, infrastructure governance, or insurance — is the audience.

---

## What positioning does NOT claim

The substrate does NOT position itself as:

- A replacement for IAM. It complements IAM by extending governance through to actuation.
- A replacement for guardrails. It governs the action the model proposes; it doesn't filter model output.
- A replacement for OT cybersecurity products. Those products detect; this substrate prevents at the protocol seam.
- A certified safety system. It is a governance primitive a certified safety case could rely on, not the safety system itself.
- A standards body. The Warrant + GEL formats are defined in this repo but not yet published as an external standard. That's a future step (`ROADMAP_TO_100.md` § Category 3).

---

## What positioning DOES claim

Concretely, verifiably:

1. **A working substrate that produces the primitives above**, with test posture documented in `PROOF_STATUS.md` and limitations documented in `LIMITATIONS.md`.
2. **A 20-minute reviewer flow** (`pnpm reviewer:verify`) that lets anyone confirm the substrate's correctness without trusting the author's word.
3. **A content-addressed replay artifact** (`examples/mesh/published.replay.json`) demonstrating that the partition scenario reproduces byte-for-byte under a fresh local run.
4. **Honest scope boundaries**, enumerated in `LIMITATIONS.md` and `THREAT_MODEL.md`, so a buyer can decide whether the substrate fits before integrating.

If the substrate is interesting, it's interesting because the primitives are real and the test posture is honest. If a buyer wants production-validated hardware integration, certification, or KMS-backed signing as a default, those require additional work documented in `ROADMAP_TO_100.md`.
