# UAV Swarm Proof Output

## Demo Initialized

Demo: Authority Continuity Under Disconnection: 40-UAV Swarm Governance Demo

Version: AristotleOS UAV Swarm Disconnection Demo v0.1

Swarm size: 40 assets

## Partition Triggered

The simulated swarm split into connected, degraded, mesh-relay, and disconnected cohorts.

## Degraded Authority Activated

Disconnected and degraded cohorts continued only under bounded degraded authority. Allowed fallback included hold-safe, return-home, and reroute-within-envelope behavior.

## Allowed Actions

- ALLOW: drone.scan_area for the connected cohort under current root authority.
- ALLOW: drone.hold_position under mesh continuity authority.
- ALLOW: drone.return_home under disconnected degraded safety authority.

## Refused Actions

- REFUSE: swarm.mission.expand because sector-bravo expansion requires fresh root authority.
- REFUSE: swarm.revoke.disable_mesh because Drone Group B authority was revoked during partition.

## Expired / Stale / Revoked Actions

- EXPIRED: drone.scan_area under an expired Fluidity Token.
- STALE: cached discretionary sensing authority superseded by a root update.
- REVOKED: attempted action under Drone Group B authority after revocation.
- REVIEW_REQUIRED: degraded reroute and blocked mission expansion require human review after reconnect.

## Reconciliation Report

- Total assets: 40
- Connected cohorts: 1
- Degraded cohorts: 2
- Disconnected cohorts: 1
- Allowed actions: 3
- Refused actions: 3
- Expired actions: 1
- Revoked actions: 1
- Stale actions: 1
- Review-required actions: 2
- Evidence entries: 8
- Final reconciliation status: reconciled_with_review_queue

## GEL Evidence Summary

Each evidence entry includes action, decision, reason, authority envelope, Warrant status, partition state, reconciliation status, and evidence reference.

## Final Proof Statement

PASS: AristotleOS demonstrated authority continuity under disconnection. Autonomous cohorts continued only within bounded degraded authority, unauthorized mission expansion was refused, evidence continuity was preserved, and reconnect produced a reviewer-readable reconciliation report.
