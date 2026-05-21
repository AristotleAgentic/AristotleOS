# AristotleOS CLI

The `aristotle` CLI is the developer entry point for governance-as-code.

Commands:

- `aristotle init`: creates `governance.aristotle`, starter agent code, README, and `.env.example`
- `aristotle check`: validates Ward, Authority Envelope, Commit Gate, Warrant Policy, and GEL blocks
- `aristotle plan`: compiles the file and previews runtime artifact changes
- `aristotle apply`: persists the local compiled policy hash
- `aristotle demo payments`: evaluates the flagship $8,000 refund scenario
- `aristotle approvals`: lists deferred actions
- `aristotle approve <token>`: approves a deferred action and issues a one-time warrant
- `aristotle deny <token>`: denies a deferred action and commits GEL evidence
- `aristotle audit tail`: shows recent GEL records
- `aristotle replay`: replays the payments scenario against the current policy
- `aristotle explain --last-deny`: explains the last denied action class
- `aristotle doctor`: checks local developer posture

The CLI is intentionally deterministic. It does not call an LLM in the enforcement path.
