# Automotive threat model addendum

This addendum focuses on autonomous vehicle and fleet-control deployment. It does
not replace the base AristotleOS threat model. It names the vehicle-specific risks
that must bind at the execution boundary.

## Assets

- vehicle command channels
- ODD and mission boundary declarations
- OTA image and campaign material
- HD map packages and activation state
- remote-assist sessions and operator identity
- runtime safety snapshot: speed, road class, map confidence, localization
  confidence, perception confidence, MRC availability
- Authority Envelopes and Warrants
- GEL and Automotive Evidence Bundles

## Primary threats

| Threat | Risk | AristotleOS control |
|---|---|---|
| Unauthorized remote-assist command | Vehicle receives a command from an unapproved operator or session | Authority Envelope, required runtime registers, dual-control approval, Warrant verification |
| OTA rollout while vehicle is unsafe | Software activates on moving or noncompliant vehicles | Ward drive-state invariant, required OTA digest, dual-control approval |
| Map activation outside ODD | Vehicle uses map material outside authorized context | Ward ODD invariant and map confidence threshold |
| Sensor-confidence degradation | Action proceeds during low map, localization, or perception confidence | Vehicle Safety Invariant refusal before Warrant issuance |
| MRC unavailable | Command proceeds when minimum-risk-condition path is unavailable | `require_mrc_available` hard invariant |
| Safety envelope disablement | Agent tries to disable a safety interlock | `vehicle.disable_safety_envelope` hard interlock refusal |
| Replay of admitted command | Old admitted action is reused | canonical action hash, replay protection, single-use Warrant |
| Disconnected edge divergence | Vehicle or depot acted under stale policy | GEL replay, Conflict Inbox, evidence reconstruction |

## Fail-closed posture

Safety-critical vehicle Wards should use `criticality: safety_critical`. Under
ledger failure, stale authority, missing runtime state, absent approval store,
degradation signals, or policy version mismatch, the boundary should refuse or
escalate before vehicle execution.

## Operational recommendations

- Require dual control for OTA activation, map activation, and consequential
  remote-assist commands.
- Keep Warrant TTLs short for vehicle actions.
- Require MRC availability for any motion-affecting command.
- Export Automotive Evidence Bundles for safety-case reviews and regulatory
  readiness.
- Run Shadow Mode before enforcing in live fleets, but do not auto-weaken policy.
- Exercise disconnected reconciliation with fleet/depot edge records before a
  pilot crosses into public-road operation.
