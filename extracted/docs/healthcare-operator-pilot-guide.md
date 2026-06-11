# Healthcare Operator Pilot Guide

This pilot proves governed healthcare automation without connecting to live
clinical systems.

## Pilot Goal

Demonstrate that an autonomous clinical-operations agent cannot mutate records,
export PHI, trigger pharmacy workflows, submit claims, message patients, or send
device commands unless AristotleOS admits the action at the Commit Gate and
issues a single-use Warrant.

## Suggested Pilot Scenario

An agent attempts to submit a pharmacy prior authorization.

Expected path:

1. Ward resolves to `ward-healthcare-clinical-ops`.
2. Patient context hash is present.
3. Authority Envelope is active.
4. Consent/TPO basis is checked.
5. Clinician and pharmacist authority are checked.
6. Allergy and interaction state are checked.
7. Commit Gate returns `ALLOW`.
8. AristotleOS issues a single-use Warrant.
9. GEL records the decision.
10. Healthcare Evidence Bundle exports PHI-minimized proof.

## Refuse and Escalate Paths

Run the sample refusal:

```bash
npm run aristotle -- execution-control evaluate \
  --ward examples/healthcare/ward.hospital_clinical_ops.yaml \
  --envelope examples/healthcare/authority_envelope.clinical_ops_coordinator.yaml \
  --action examples/healthcare/actions/refuse_allergy_override.json \
  --ledger ./.tmp/healthcare-refuse.gel.jsonl
```

Run the missing-context escalation:

```bash
npm run aristotle -- execution-control evaluate \
  --ward examples/healthcare/ward.hospital_clinical_ops.yaml \
  --envelope examples/healthcare/authority_envelope.clinical_ops_coordinator.yaml \
  --action examples/healthcare/actions/escalate_missing_patient_context.json \
  --ledger ./.tmp/healthcare-escalate.gel.jsonl
```

## Operator Workflow

1. Create governed clinical mission.
2. Select clinical Ward.
3. Bind Authority Envelope.
4. Attach runtime registers from EHR/FHIR/pharmacy/device gateways.
5. Run in Shadow Mode.
6. Review REFUSE and ESCALATE outcomes.
7. Enable enforcement for one bounded workflow.
8. Export Healthcare Evidence Bundle.
9. Replay decision chain with compliance and privacy stakeholders.

## Pilot Success Criteria

- ALLOW path issues a Warrant and commits GEL evidence.
- Allergy override and device alarm disable cannot issue a Warrant.
- Missing patient context escalates before mutation.
- Dual-control actions require plural approval.
- Evidence bundle verifies and does not include raw PHI by default.
