# Healthcare Threat Model Addendum

This addendum covers healthcare automation that can mutate patient records,
orders, medications, claims, devices, PHI exports, patient messages, or research
datasets.

## Primary Threats

- Shadow agents writing to EHRs through employee credentials.
- Automation exporting PHI beyond purpose, consent, or minimum necessary scope.
- Medication actions proceeding with stale allergy or interaction state.
- Device commands disabling alarms, limits, or safety posture.
- Claims actions submitting unsupported financial attestations.
- Research exports carrying identified patient data.
- Patient-facing messages sent without human review or current context.
- Emergency break-glass actions without attestation and audit evidence.

## AristotleOS Controls

- Ward boundary defines facility, unit, permitted resources, PHI purpose, and
  evidence requirements.
- Authority Envelope scopes agent power by action, patient context, clinical
  unit, expiration, and dual-control requirements.
- Runtime registers provide patient context, consent/TPO basis, clinician
  privilege, medication checks, device telemetry, PHI count, and audit context.
- Commit Gate resolves ALLOW / REFUSE / ESCALATE before consequence.
- Warrant proves authority for one action at one moment.
- GEL records the decision context for replay.
- Healthcare Evidence Bundle exports PHI-minimized regulator-readable evidence.

## Fail-Closed Conditions

AristotleOS should refuse or escalate when:

- Patient context hash is missing.
- Patient identity is not verified.
- Consent or treatment/payment/operations basis is absent.
- Clinician privilege is inactive.
- Allergy or interaction checks are stale or failed.
- Device telemetry is stale.
- Device alarm or safety limits are disabled.
- Claim attestation is absent.
- PHI export exceeds Ward limits.
- Research de-identification is not proven.
- Audit context is missing.

## Evidence Minimization

Healthcare evidence should retain:

- patient-context hash
- encounter reference
- authority hash
- policy hash
- Warrant id
- GEL record hash
- redaction manifest
- replay material

It should not retain raw patient name, MRN, date of birth, free-text clinical
notes, or unnecessary PHI unless a deployment explicitly configures that
retention under local policy.
