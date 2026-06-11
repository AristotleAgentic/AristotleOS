# Ward And Authority Template Catalog

This catalog is the AristotleOS equivalent of a policy-pack registry. It should
stay concrete, reviewable, and clearly marked as demonstration material until a
template has been validated for a real deployment.

## Template Types

- **Ward templates**: protected domains such as cluster, fleet, plant, agency,
  workflow, mission, or region.
- **Authority templates**: scoped delegation for subjects, actions, constraints,
  issuers, expiry, revocation, and Warrant requirements.
- **Evidence profiles**: GEL and replay expectations for a domain.
- **Adapter profiles**: where refusal before emission must occur.

## Existing Domain Starters

- `docs/grid-ward-templates.md`
- `docs/healthcare-ward-templates.md`
- `docs/aviation-ward-templates.md`
- `docs/robotics-ward-templates.md`
- `docs/swarm-ward-templates.md`
- `docs/water-ward-templates.md`
- `docs/rail-ward-templates.md`
- `docs/port-ward-templates.md`
- `docs/logistics-ward-templates.md`
- `docs/title-ward-templates.md`

## Review Standard

Every template should answer:

1. What consequence is being governed?
2. Who or what receives delegated authority?
3. Which actions are allowed, refused, or escalated?
4. What runtime registers are required?
5. What physical or institutional invariants cannot be violated?
6. What evidence must be written for later replay?
7. What is demonstration-only versus deployment-validated?
