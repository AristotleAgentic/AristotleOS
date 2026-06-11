# AristotleOS — reviewer entry point

This directory exists to make the AristotleOS claim verifiable by a skeptical technical reviewer in under 20 minutes.

**Start with [REVIEWER.md](./REVIEWER.md).**

Files in this directory:

| File | Purpose |
|---|---|
| `REVIEWER.md` | The single document. Read this first. |
| `verify.ts` | One executable. Runs all 4 stages, emits a structured JSON report. ~10 seconds. |
| `verify.test.ts` | Same logic exposed as `node --test` for CI assertions. |

Quick run:

```sh
node --import tsx examples/reviewer/verify.ts
```

Expected exit code: `0`. Expected output: `PASS  total checks: 18  passed: 18  failed: 0`.
