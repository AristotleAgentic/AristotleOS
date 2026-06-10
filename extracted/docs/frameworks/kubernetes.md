# Governing Kubernetes Changes

Goal: govern infrastructure mutations before they reach the Kubernetes API.

## Boundary

Consequential actions include deployment updates, scaling, secret mutation,
network policy changes, admission decisions, and production namespace writes.

## Adapter Pattern

- Convert the requested mutation into a Canonical Governed Action.
- Bind the Ward to cluster, namespace, workload, tenant, and environment.
- Evaluate invariants such as production freeze, dual control, change window,
  blast radius, image provenance, and operator approval.
- Execute only on `ALLOW` with required Warrant.
- Write GEL evidence for allow/refuse/escalate and Kubernetes response.

## Review Questions

- Can `kubectl` or service-account credentials bypass AristotleOS?
- Does the adapter refuse before API submission?
- Are admission and runtime paths aligned?
