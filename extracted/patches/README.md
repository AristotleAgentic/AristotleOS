# Security backports

These are pnpm integrity-checked patches, not upstream releases or audit
exceptions. `pnpm-lock.yaml` pins their hashes. CI runs
`node --test scripts/dependency-security.test.mjs` against the active dependency
graph, including CommonJS and ESM/browser entry points.

| Advisory | Remediation | Compatibility |
| --- | --- | --- |
| [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | Override UUID 10.0.0 to upstream 11.1.1. | Retains CommonJS support; tests v4 and undersized v3/v5 output buffers. |
| [GHSA-866g-f22w-33x8](https://github.com/advisories/GHSA-866g-f22w-33x8) | Backport bounded response reading to provider-utils 2.2.8, preserving its existing public API. All three JSON/status/error handlers check Content-Length and count streamed bytes, cancel at 16 MiB, and release the reader. | Responses over 16 MiB now reject. Streaming UTF-8 decoding preserves split characters. No whole-body unbounded `.text()` call remains in these handlers. |
| [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) | Bound numeric precision before sprintf-js invokes Number formatting methods, in its Node and browser entries. No upstream patched release was listed at review. | Valid precision is unchanged; out-of-range precision saturates to 100, or 1 for zero-precision `%g`, instead of an uncaught RangeError. |

Registry audit tools may continue reporting the two patched package versions.
Retain the raw audit output and distinguish version-based findings from tested
local remediation. Do not lower the audit threshold, fabricate package versions,
or suppress these advisory IDs. The patch does not claim to fix unrelated sprintf
format-string errors, unbounded caller input, or every resource-exhaustion mode.

The browser sprintf file contains the readable implementation so it follows the
same security fix; upstream attribution remains present. Source maps are upstream
debug artifacts and are not updated by these runtime backports.
