# Commit Gate

The Commit Gate is the execution-boundary admissibility check.

It sits after intent declaration, Ward context, authority resolution, and policy compilation, but before irreversible mutation or external action.

It prevents unauthorized execution, stale authority, policy conflict, revoked authority, missing warrants, and unsafe standing power.

Developers see Commit Gate outcomes as `PERMIT`, `DENY`, `DEFER`, `REVOKED`, or `FAIL_CLOSED`.
