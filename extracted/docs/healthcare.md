# Healthcare Clinical Operations Execution-Control Path

AristotleOS governs healthcare automation before patient, record, medication,
claim, device, PHI, or research consequence.

This vertical is not a diagnostic engine and does not replace clinical systems.
It places the Governance Plane at the execution boundary for FHIR, HL7, EHR
writeback, pharmacy, prior authorization, claims, imaging, medical-device,
patient-messaging, and research-export actions.

## What It Is

The Healthcare Ward vertical provides:

- Ward Manifests for clinical operations, pharmacy, ICU, radiology, revenue
  cycle, device networks, and research access.
- Authority Envelopes for agents, automation services, clinicians, pharmacists,
  privacy officers, and device operators.
- Clinical invariants for patient context, consent/TPO basis, clinician
  privilege, allergies, medication interaction, device safety, PHI minimization,
  claim attestation, and audit context.
- Commit Gate decisions before irreversible EHR, pharmacy, PHI, device, claims,
  or patient-message actions.
- Single-use Warrants for admitted actions.
- Healthcare Evidence Bundles that retain hashes and references by default
  instead of raw PHI.

## Runtime Position

Canonical path:

```text
Clinical Intent
-> Healthcare Ward
-> Patient Context Hash
-> Authority Envelope
-> Runtime Register Snapshot
-> Clinical Invariant Check
-> Commit Gate
-> Warrant
-> Adapter Execution
-> GEL Commit
-> Healthcare Evidence Bundle / Replay
```

## What It Prevents

- Autonomous EHR mutation without patient context.
- PHI export without consent, TPO basis, or privacy authorization.
- Medication workflow actions that ignore allergy or interaction state.
- Device commands that disable alarms or safety limits.
- Claim submission without attestation.
- Research export of identified data.
- Patient-facing messages without human review where policy requires it.

## How Developers Use It

```bash
npm run aristotle -- healthcare templates
npm run aristotle -- healthcare adapters
npm run aristotle -- execution-control evaluate \
  --ward examples/healthcare/ward.hospital_clinical_ops.yaml \
  --envelope examples/healthcare/authority_envelope.clinical_ops_coordinator.yaml \
  --action examples/healthcare/actions/allow_prior_auth.json \
  --ledger ./.tmp/healthcare.gel.jsonl
```

Export a PHI-minimized evidence bundle:

```bash
npm run aristotle -- healthcare evidence export \
  --ward examples/healthcare/ward.hospital_clinical_ops.yaml \
  --envelope examples/healthcare/authority_envelope.clinical_ops_coordinator.yaml \
  --ledger ./.tmp/healthcare.gel.jsonl \
  --out ./.tmp/healthcare-evidence.json \
  --system west-health-system \
  --facility west-hospital \
  --unit pharmacy \
  --encounter enc-2026-0525-008 \
  --patient-context-hash patctx-0f2b8d7c9a1e
```

## Evidence Produced

Healthcare Evidence Bundles include:

- Ward and Authority Envelope hashes.
- Patient context hash, not raw patient identity.
- Action family and adapter surface.
- Consent/TPO basis.
- PHI minimization profile.
- Pre-check and post-check attestations.
- Warrant and GEL record.
- Redaction manifest.
- Replay material.

The doctrine remains: authority before patient consequence, Warrant before
execution, evidence after every decision.
