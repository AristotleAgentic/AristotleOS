# PX4 SITL hardware-governance integration

Walks an operator through running the `@aristotle/mavlink-px4` adapter
end-to-end against a real PX4 SITL (Software-In-The-Loop) autopilot.
Closes the in-repo portion of [ROADMAP_TO_100.md](../ROADMAP_TO_100.md)
Category 1: *"production hardware integration test for >= 1 adapter
(PX4 SITL is the most achievable)"*.

This is not a replacement for a real-hardware test — that requires a
real autopilot, an operator with range authority, and an explicit
operator sign-off on the [MAVLink adapter validation
status](ADAPTER_VALIDATION.md). What this gets you: a reproducible test
that proves the governed dispatch path works against a real MAVLink
endpoint speaking the real wire protocol, on infrastructure any
reviewer with Docker can stand up in two minutes.

---

## TL;DR

```sh
# Bring SITL up (first run pulls the upstream PX4 image; ~2 GB):
docker/sitl/run.sh up

# Run the integration test:
docker/sitl/run.sh test

# Tear down:
docker/sitl/run.sh down
```

If Docker is not available, the test automatically **skips** rather
than failing — honest CI behavior for environments that can't run SITL.

---

## What's in this scaffold

| File | Purpose |
|---|---|
| `docker/sitl/docker-compose.yml` | Launches the upstream `px4io/px4-dev-simulation-jammy` image with the standard MAVLink UDP endpoint exposed on `127.0.0.1:14540` |
| `docker/sitl/run.sh` | Convenience wrapper: `up`, `test`, `down`, `logs` |
| `tests/px4-sitl/` | Workspace package containing the integration test |
| `tests/px4-sitl/src/integration.test.ts` | Drives `governFlightCommand` → `MavlinkUdpTransport` against the live SITL UDP endpoint |
| `docs/PX4_SITL_INTEGRATION.md` | This document |

---

## How it works

1. `docker compose up -d` launches the PX4 SITL container. The
   `none_iris` build runs the SITL flight stack without a graphical
   simulator (HEADLESS=1). The container takes ~20-30 s to be ready
   to accept MAVLink.

2. The healthcheck probes UDP 14540 every 5 s; `run.sh up` waits up to
   ~2 minutes for `healthy` before returning.

3. The integration test sends a `TAKEOFF` command via the **governed**
   dispatch path: a stub `AristotleClient` that returns ALLOW, then
   `governFlightCommand()`, then the real `MavlinkUdpTransport`, then
   the real MAVLink v2 frame on the wire to SITL.

4. The test asserts: `result.ok === true`, `outcome.receipt.transport
   === "px4-mavlink-udp"`, `production_validated === false` (the
   default; only set true after operator + range sign-off — see
   [LIMITATIONS § 8](../LIMITATIONS.md#8-adapter-wire-level-validation)).

5. The test does **not** assert SITL state changes (arm / flight mode /
   GPS lock). That's a separate, larger integration story; this scaffold
   just proves the dispatch path round-trips against a real autopilot.

---

## What this PROVES

- The `@aristotle/mavlink-px4` adapter's MAVLink framing is wire-correct
  enough for a real PX4 SITL to accept the datagram.
- The governance gate → warrant → transport.emit() flow works against
  a non-mock UDP endpoint.
- `production_validated: false` is honored as the default — operators
  who didn't opt in don't accidentally ship into a production transport.

## What this does NOT prove

- That AristotleOS is safe to use against a real autopilot. See
  [LIMITATIONS § 8](../LIMITATIONS.md#8-adapter-wire-level-validation).
- That every MAVLink command in `FlightCommandKind` round-trips
  through SITL successfully. This test only exercises `TAKEOFF`.
- That SITL's actual flight state changes match the operator's intent.
  The simulator may reject the command (no GPS lock, not armed, etc.);
  this test only verifies the dispatch path, not the flight-control
  outcome.
- That the test infrastructure mirrors production. Real production
  deployments use a different MAVLink router topology, a different
  transport class (`MavlinkUdpTransport` may not be appropriate), and
  operator-supplied TLS / network controls.

If your bar is "does the adapter work end-to-end against an autopilot
on the bench" — this gets you there. If your bar is "is this safe to
fly" — this does not.

---

## CI integration (optional)

The test is **not** in the default CI matrix because:
- The PX4 image is ~2 GB; pulling on every PR run is wasteful.
- SITL takes ~30 s to boot, adding meaningful PR latency.
- Most reviewers don't have Docker available in their CI runner.

To wire it as a nightly job, add this to `.github/workflows/ci.yml`:

```yaml
  px4-sitl-nightly:
    name: PX4 SITL integration (nightly)
    runs-on: ubuntu-latest
    timeout-minutes: 20
    if: github.event.schedule != ''   # only on scheduled runs

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22.x' }
      - run: corepack enable
      - run: corepack prepare pnpm@10.32.1 --activate
      - run: corepack pnpm@10.32.1 install --frozen-lockfile
      - name: Bring SITL up
        run: docker/sitl/run.sh up
      - name: Run integration test against SITL
        run: docker/sitl/run.sh test
      - name: SITL logs (on failure)
        if: failure()
        run: docker/sitl/run.sh logs | tail -200
      - name: Tear down SITL
        if: always()
        run: docker/sitl/run.sh down
```

Schedule with `on: schedule: - cron: '0 6 * * *'` for daily-at-06:00-UTC.

---

## Image pinning

The compose file pins `px4io/px4-dev-simulation-jammy:2024-04-25`. This
is intentional — PX4's SITL behavior changes across releases (param
names, default action timings, frame formats), and a floating tag would
make this test flap on upstream changes.

Bumping the pin is a deliberate operation:
1. Test locally against the new image.
2. Document the bump in `CHANGELOG.md` with the date + image SHA.
3. If any test assertion changes, write down WHY in the same changelog
   entry. The "test still passes after bump" bar is necessary but not
   sufficient — the behavior change might be in something the test
   doesn't currently assert.

---

## See also

- [LIMITATIONS.md § 8](../LIMITATIONS.md#8-adapter-wire-level-validation) — every adapter ships `production_validated: false` by default
- [ADAPTER_VALIDATION.md](ADAPTER_VALIDATION.md) — the full adapter validation matrix
- [packages/mavlink-px4/README.md](../packages/mavlink-px4/README.md) — adapter-level documentation
