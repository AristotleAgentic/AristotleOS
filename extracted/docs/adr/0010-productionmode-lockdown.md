# ADR-0010 — `productionMode: true` constructor lockdown

**Status:** Accepted

## Context

The substrate ships with backwards-compatible defaults: the legacy
`{ secret }` constructor for `MeshNode` still works because changing
it would break every existing test + demo. Demo defaults are
operationally convenient — they let an operator clone the repo and
have a working mesh in one command.

The risk: an operator who deploys to production without reading
the docs gets a mesh with shared-HMAC trust (one compromised node =
entire mesh compromised). The substrate emits a one-time
console.warn on known demo secrets (commit `8c82800`), but a stderr
log doesn't fail the deployment — it just makes the failure mode
visible.

## Decision

Introduce an explicit opt-in: `MeshNodeOptions.productionMode: true`.
When set:

1. Constructor THROWS if `secret` (HMAC) is provided. The legacy
   path is unreachable.
2. Constructor THROWS if the provided `signer` reports
   `alg === "hmac-sha256"`. Even the new signer/verifier API can't
   use HMAC.
3. Only Ed25519 signers + verifiers are accepted.

Operators flip one flag and the substrate refuses to silently fall
back to demo trust. A misconfigured production deployment fails
fast at boot instead of silently running with weak trust.

## Alternatives considered

- **Default `productionMode: true`.** Rejected. Would break every
  existing test + demo + the in-process registry path. Backwards
  compatibility for the substrate's own developer ergonomics matters
  more than catching the operator misconfiguration we can also
  catch with explicit opt-in.
- **Hard refuse on demo secrets unconditionally.** Rejected. The
  demo secrets are useful for tests + local development; the failure
  mode is operator-side ("don't deploy with the demo secret"), not
  substrate-side ("the substrate must never accept the demo
  secret"). The WARN signals; productionMode enforces; both layered.
- **Auto-detect production by environment variable
  (`NODE_ENV=production`).** Rejected. Environment variables are
  not a reliable trust boundary — a Docker entrypoint can set them
  wrong, an operator can forget. An explicit constructor flag is
  unambiguous.
- **Inverse flag (`developmentMode: true`).** Rejected. Same
  end-state but the wrong default — every operator would have to
  type the flag to NOT get production behavior, which inverts the
  failure mode (the substrate now breaks demos by default).

## Consequences

- Operators wiring production deployments add ONE flag:
  `productionMode: true`. The substrate enforces the rest.
- The 21-item pre-flight checklist in
  `docs/PRODUCTION_DEPLOYMENT.md` includes this flag as item 3.
  Operators who skip the doc and skip the flag will see the demo-
  secret WARN; operators who skip the doc but set the flag will
  see a constructor exception with a clear upgrade path.
- The flag is constructor-level, not runtime-level — flipping it
  later doesn't reconfigure an already-running node. Re-deploy.
- Test ergonomics are unaffected: tests construct with
  `{ secret, suppressDemoSecretWarning: true }`, the production-
  mode-aware constructor never sees that combination.
- The pattern composes with future hardening: future
  `productionMode` checks (e.g., "must have replayCache",
  "must have rateLimiter") can be added without breaking the
  existing failure modes — they just become additional throw
  conditions when productionMode is true.

## See also

- `shared/mesh-runtime/src/index.ts` — MeshNode constructor lockdown
- `shared/mesh-runtime/src/ingress-hardening.test.ts` — tests for the lockdown
- ADR-0006 (mesh role separation) — productionMode applies to every role
- [docs/PRODUCTION_DEPLOYMENT.md § 2](../PRODUCTION_DEPLOYMENT.md) — operator instructions
- ADR-0001 (single-use Warrants) — productionMode is a strictness ratchet at the trust-anchor layer; this is the mesh equivalent
