# Per-vertical Helm overlays

This chart ships ten vertical overlays alongside the environment overlays
(`values-local.yaml`, `values-staging.yaml`, `values-pilot.yaml`, etc.).
A vertical overlay records the operator-facing posture choices a deployment
inherits when the substrate is operated in a specific industry — mesh quorum,
GEL retention, demonstration-transport blocking, per-service resource sizing,
and a one-line doctrine statement consumable by tooling.

The ten verticals shipped today are:

| Overlay file               | Vertical                          | Mesh quorum | GEL retention   | Notable posture                                                                  |
|----------------------------|-----------------------------------|:-----------:|:---------------:|----------------------------------------------------------------------------------|
| `values-pipeline.yaml`     | Oil & gas pipeline SCADA          |      3      |    7 years      | Demo transports blocked; 5-warrant disconnected cap.                              |
| `values-aviation.yaml`     | UAV / flight control              |      2      |    90 days      | 10-warrant disconnected cap (partition tolerance for isolated drones).            |
| `values-grid.yaml`         | Electric grid SCADA               |      3      |    7 years      | Aggressive 5-s revocation auto-pull; zero disconnected-warrant tolerance.         |
| `values-healthcare.yaml`   | Clinical decision support         |      2      |    7 years      | Aggressive 100/min per-peer rate limit; encrypted-at-rest archive sidecar.        |
| `values-telecom.yaml`      | 5G / NEF / network slicing        |      3      |    1 year       | High-throughput sizing (2 000 commits/s); 3-year archive.                          |
| `values-rail.yaml`         | Rail / signaling (CBTC, PTC)      |      3      |    7 years      | 5-warrant disconnected cap; aggressive 5-s revocation auto-pull.                  |
| `values-water.yaml`        | Water / wastewater SCADA          |      3      |    7 years      | Encrypted-at-rest archive; demo transports blocked (public health blast radius).   |
| `values-port.yaml`         | Port operations / crane control   |      2      |   1 y + 5 y     | High event density (200/min per-peer); 4 gate replicas for vessel-exchange bursts. |
| `values-mining.yaml`       | Autonomous mining (loaders, haulers) |   2      |    90 days      | 20-warrant disconnected cap (long-partition tolerance); demo transports blocked.    |
| `values-automotive.yaml`   | Connected vehicle / V2X           |      3      |   1 y + 5 y     | Maximum sizing (10 000 commits/s target); aggressive 5-s revocation gossip.        |

> Compliance references in each overlay's header comment are demonstration-only.
> Production deployments require the operator's compliance officer or
> engineering-of-record to review the policy bundle and the per-asset retention,
> identity, and authority posture before any wire-level adapter is enabled.

---

## When to apply a vertical overlay

A vertical overlay records *vertical-specific defaults*: the posture choices an
operator would otherwise hand-set every time they deployed the substrate for
that industry. It is intended to be combined with an environment overlay; it is
not itself a complete deployment profile.

The canonical apply order is:

1. `values.yaml` — chart defaults (cluster-agnostic baseline).
2. **One** vertical overlay (one of the five above).
3. **One** environment overlay (`values-local.yaml`, `values-staging.yaml`,
   `values-pilot.yaml`, etc.).
4. **Optionally** `values-hardened.yaml` for the security-hardened reference
   posture (mTLS, read-only root filesystem, restricted pod security, etc.).

Helm merges these in the order given, with later files overriding earlier ones.
The `values-hardened.yaml` overlay is intentionally narrow — it only sets
security-relevant keys — so it composes cleanly on top of any vertical +
environment combination.

### Example combinations

Pipeline SCADA pilot, hardened:

```bash
helm template aristotle charts/aristotle-governance-os \
  -f charts/aristotle-governance-os/values-pipeline.yaml \
  -f charts/aristotle-governance-os/values-pilot.yaml \
  -f charts/aristotle-governance-os/values-hardened.yaml
```

Grid SCADA staging:

```bash
helm template aristotle charts/aristotle-governance-os \
  -f charts/aristotle-governance-os/values-grid.yaml \
  -f charts/aristotle-governance-os/values-staging.yaml
```

Healthcare local development (no hardening; useful for first-look + smoke):

```bash
helm template aristotle charts/aristotle-governance-os \
  -f charts/aristotle-governance-os/values-healthcare.yaml \
  -f charts/aristotle-governance-os/values-local.yaml
```

Telecom pilot with SPIFFE workload identity:

```bash
helm template aristotle charts/aristotle-governance-os \
  -f charts/aristotle-governance-os/values-telecom.yaml \
  -f charts/aristotle-governance-os/values-pilot.yaml \
  -f charts/aristotle-governance-os/values-spiffe.example.yaml \
  -f charts/aristotle-governance-os/values-hardened.yaml
```

---

## Field provenance

A vertical overlay contains two classes of keys:

**Template-consumed keys** flow through the chart's templates into rendered
Kubernetes manifests. These are:

- `runtimeConfig.*` — pod env vars.
- `secrets.*` — secret-reference plumbing.
- `services.*` — per-service replica counts, resources, and persistent volumes.
- `telemetry.*` — OpenTelemetry exporter config.

Changing these in a vertical overlay deterministically changes the rendered
Deployment / Service / PVC / Secret objects.

**Operator-facing documentation keys** are *not* read by chart templates today;
they document the substrate-runtime configuration the operator must apply
separately (typically through environment variables, runtime config secrets,
or by binding the values into a mesh-runtime config). These are:

- `mesh.*` — recommended `mesh-runtime` configuration (revocation quorum,
  per-peer rate limit, replay-cache TTL, partition disconnected-warrant cap,
  throughput sizing).
- `gel.*` — recommended Governance Evidence Ledger configuration (retention
  window, RFC 3161 timestamp posture, archive-sidecar minimum retention,
  encrypt-at-rest flag).
- `adapters.*` — recommended adapter posture (demo-transport blocking).
- `global.vertical` — discovery tag picked up by tooling and dashboards.
- `global.doctrine` — operator-facing prose statement of what this overlay
  intends.

The operator-facing keys are still valuable even though they don't render to
Kubernetes objects today: they give the deploying team a checklist of the
vertical-specific configuration they need to apply at the substrate-runtime
layer (mesh, evidence ledger, signing keyring, OTel resource attributes) and
they serve as a permanent record of *why* the values are what they are when
the next operator inherits the deployment.

A future template revision MAY consume the `mesh.*` / `gel.*` / `adapters.*`
blocks directly — they're stable, predictable shapes — but doing so is a
template change, not a values change. Overlays shipped today remain valid.

---

## Vertical posture summary

### Pipeline (`values-pipeline.yaml`)

- Mesh quorum **3** — pipeline incidents have liability tails decades long;
  one compromised root node should never be able to silently revoke peers.
- GEL retention **7 years (2 555 days)** — matches 49 CFR 195 incident-record
  retention for liquid pipelines.
- `disconnectedWarrantCap: 5` — pipeline networks are flat; a partition is a
  failure mode, not an operational expectation.
- Mid-high sizing on kernel + gate; 100 GiB ledger PV.

### Aviation (`values-aviation.yaml`)

- Mesh quorum **2** — small fleets; quorum=3 stalls during single-node outages.
- GEL retention **90 days** primary + 2-year archive (matches NTSB
  recommended-practice retention).
- `disconnectedWarrantCap: 10` — UAVs must keep flying their pre-approved
  mission profile across a temporary link loss; cap is sized for that flight
  envelope, not for unsupervised authority minting.
- `GATEWAY_READINESS_TIMEOUT_MS: 5000` — degraded edge links should not
  trip the gateway's failClosed posture during normal flight ops.
- Lower sizing; emphasis on the witness service.

### Grid (`values-grid.yaml`)

- Mesh quorum **3** — grid SCADA actuates physical-invariant-class equipment.
- GEL retention **7 years** — NERC CIP audit retention floor.
- Aggressive `revocation.autoPullIntervalMs: 5000` (5 s) — withdrawn authority
  should stop the next gate call, not the next polling round.
- `disconnectedWarrantCap: 0` — grid does not issue authority in a partition;
  safety over availability.
- Maximum sizing on kernel, gate, ledger, witness — high gate-call volume.
- 250 GiB ledger PV for 7-year retention at SCADA write volume.

### Healthcare (`values-healthcare.yaml`)

- Mesh quorum **2** — small clinical environments; quorum=3 stalls during a
  single-node outage and that stall directly affects patient care.
- GEL retention **7 years** + encrypted-at-rest archive sidecar — HIPAA
  documentation-retention practice + Security Rule expectation that PHI at
  rest is encrypted.
- Per-peer rate limit **100/min** — clinician + bot peers are bounded; a
  burst above that is almost certainly a compromised credential and the
  substrate should rate-limit, not just log.
- Short operator-session TTL (10 min) — HIPAA min-necessary access supports
  frequent re-auth.
- Mid-sized; 2× agent-os replicas because the clinician-facing agent surface
  is the user-visible critical path.

### Telecom (`values-telecom.yaml`)

- Mesh quorum **3** — carrier O&M nodes are operator-facing; a compromised
  O&M should not be able to mint slice authority unilaterally.
- GEL retention **1 year primary + 3-year archive** — aligns to carrier
  audit-cycle practice.
- Mesh throughput recommendations bias high: `targetCommitsPerSecond: 2000`,
  `workerPoolSize: 16`, `perPeerPerMinute: 2000`. Slice-deploy storms produce
  thousands of correlated gate calls in seconds.
- `disconnectedWarrantCap: 0` — control-plane partitions should not issue
  authority.
- Maximum sizing across the board for the original five — superseded only by
  automotive among the ten verticals shipped today.

### Rail (`values-rail.yaml`)

- Mesh quorum **3** — rail signaling actuates physical-invariant-class
  equipment; one compromised dispatch node must not be able to revoke peers
  silently.
- GEL retention **7 years** — matches FRA incident-record retention practice
  for railroad signal and train control systems.
- `disconnectedWarrantCap: 5` — tight cap. Signals must NOT issue authority
  under partition beyond a short window because the physical consequences of
  a misissued aspect are immediate and irreversible.
- Aggressive `revocation.autoPullIntervalMs: 5000` (5 s) — withdrawn
  authority must stop the next interlocking command, not the next polling
  round.
- High sizing on kernel + gate; 150 GiB ledger PV for 7-year retention at
  CBTC/PTC write volume.

### Water (`values-water.yaml`)

- Mesh quorum **3** — chemical-dose, pump, and clarifier commands are
  physical-invariant-class; one compromised plant node should not be able to
  revoke peers silently.
- GEL retention **7 years** + `archive.encryptAtRest: true` — matches EPA
  RMP rule recordkeeping; the archive holds process-control history that is
  sensitive both for incident response and competitive reasons.
- `demonstrationOnlyBlocked: true` is explicit doctrine, not just the
  default — a misissued chlorination command has a direct public-health
  blast radius and operators must sign off before any wire-level adapter is
  enabled.
- `disconnectedWarrantCap: 3` — wastewater control should not auto-issue
  under partition.
- Mid-sized; 100 GiB ledger PV.

### Port (`values-port.yaml`)

- Mesh quorum **2** — small terminal-operator cohorts; quorum=3 stalls
  during single-node maintenance and that stall directly affects vessel-
  exchange revenue.
- GEL retention **1 year primary + 5 year archive** — operational dashboards
  need the last twelve months inline; older history archives for facility
  security and incident review.
- Per-peer rate limit **200/min** — automated yard orchestration is
  intentionally bursty during a vessel exchange; the governance discipline
  is per-action, not per-volume.
- **4 gate replicas** to absorb vessel-exchange storms without queueing.
- `disconnectedWarrantCap: 10` — yard operations can continue under brief
  partition (a tug or stevedore link drop is operational, not adversarial).

### Mining (`values-mining.yaml`)

- Mesh quorum **2** — small mine-site operator cohorts; quorum=3 stalls
  during single-node outage and that stall directly stops the haul.
- GEL retention **90 days operational + 2-year archive** — incident review
  and long-term archive happen out-of-band via the archive sidecar; primary
  is sized for in-cycle review only.
- `disconnectedWarrantCap: 20` — wide cap. Autonomous loaders and haulers
  operate in long-partition environments (open-pit haul roads and underground
  long-wall faces both have meaningful periods of limited connectivity);
  vehicles must keep cycling under brief partition.
- `demonstrationOnlyBlocked: true` is explicit doctrine — a misissued
  traction command at scale produces immediate vehicle-collision liability.
- 2× agent-os replicas because autonomous-fleet supervisors run the agent
  surface that schedules dump cycles and loader hand-offs.

### Automotive (`values-automotive.yaml`)

- Mesh quorum **3** — fleet-wide authority must never be minted unilaterally
  by a single compromised OEM-cloud node. OTA campaigns and cohort dispatches
  cross regional control planes.
- GEL retention **1 year primary + 5-year archive** — aligns to OEM
  cybersecurity audit-cycle practice (ISO/SAE 21434, UNECE WP.29 R155).
- Mesh throughput recommendations bias highest among the ten verticals:
  `targetCommitsPerSecond: 10000`, `workerPoolSize: 32`,
  `perPeerPerMinute: 10000`. Cohort dispatches and traffic events produce
  tens of thousands of correlated gate calls per second.
- Aggressive `revocation.autoPullIntervalMs: 5000` (5 s) — withdrawn
  authority must stop propagating across the fleet inside one cohort cycle.
- `disconnectedWarrantCap: 0` — control-plane partition must never mint
  vehicle authority.
- Maximum sizing across the board (6 kernel × 8 gate × 2 ledger replicas;
  1 TiB ledger PV) — this is now the largest-throughput vertical the
  substrate ships defaults for.

---

## Adding a new vertical

To add an eleventh vertical overlay:

1. Pick a short vertical key (lowercase, no spaces): `manufacturing`,
   `defense`, `transit`, etc.
2. Copy one of the existing overlays (pick the one closest to the vertical's
   profile — `values-grid.yaml` is the high-volume reference,
   `values-aviation.yaml` is the partition-tolerant reference) to
   `values-<vertical>.yaml`.
3. Update the header block (vertical name, doctrine, compliance reference,
   last-reviewed date).
4. Update `global.vertical`, `global.doctrine`,
   `OTEL_RESOURCE_ATTRIBUTES_VERTICAL`, and the `telemetry.otel.resourceAttributes`
   string so dashboards filter on the new tag.
5. Tune `mesh.*`, `gel.*`, and per-service replica + resources.
6. Add a row to the table at the top of this README.
7. Add a paragraph under "Vertical posture summary".

A vertical overlay is **not** intended to add new top-level chart keys — only
to set values for keys this chart already understands plus the documented
operator-facing blocks (`mesh.*`, `gel.*`, `adapters.*`). New top-level keys
need a chart template change first.
