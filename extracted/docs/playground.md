# Playground

The AristotleOS playground is a browser trial at `/try`.

It shows:

- scenario selection
- agent intent
- `governance.aristotle`
- Commit Gate pipeline
- decision: `PERMIT`, `DENY`, `DEFER`, `REVOKED`, or `FAIL_CLOSED`
- one-time warrant issuance
- GEL audit record
- replay and explanation

The playground uses the shared deterministic trial engine in `shared/trial-engine`. It is a local simulation with typed data and extension points for the service-backed gateway routes under `/v1`.
