# @aristotle/reviewer

`npx`-runnable reviewer CLI for AristotleOS. Verifies the three substrate artifact families a third-party reviewer would receive — evidence bundles, warrants, and replay artifacts — without cloning the source repo.

## Install

```sh
npx @aristotle/reviewer verify ./bundle.json
```

No clone, no install — the bundled bin is self-contained.

If you do want a stable local install:

```sh
npm install -g @aristotle/reviewer
aristotle-reviewer verify ./bundle.json
```

## Subcommands

### `verify <bundle.json>`

Verifies a substrate Evidence Bundle: ledger chain integrity, selected record consistency, ward / authority envelope hash binding, and the bundle-level Ed25519 signature (when present).

```sh
aristotle-reviewer verify ./evidence-bundle.json
# evidence-bundle PASS  (or FAIL: <reason>)
# stdout: structured JSON report
# exit 0 on PASS, 1 on FAIL
```

### `verify-warrant <warrant.json> <canonical-action-hash> [--trusted-key <keyid>] [--now <iso>]`

Verifies a Warrant in isolation. Confirms signature, action-hash binding, lifetime, and trust-anchor membership.

```sh
aristotle-reviewer verify-warrant ./warrant.json \
  sha256:abc123... \
  --trusted-key key-issuer-001 \
  --now 2026-05-26T15:00:00.000Z
# warrant PASS  (or FAIL: <reason>)
```

`--trusted-key` may be repeated to allow multiple issuer keys. `--now` defaults to wall-clock; pass an explicit ISO timestamp for reproducible audits.

### `verify-replay <replay-artifact.json>`

Verifies a Replay Artifact's internal consistency: the locally-recomputed `artifact_hash` and `report_hash` match the values stored in the file (i.e., the artifact body has not been mutated and the report hash field is consistent with the report body).

```sh
aristotle-reviewer verify-replay ./published.replay.json
# replay-artifact PASS  (or FAIL: <reason>)
```

For full reproducibility (`scenario_reproducible`) you also need to re-execute the scenario locally. That requires the matching scenario runner code; this CLI ships hash-only verification. Use the in-repo `verifyReplayArtifact` (`shared/replay-artifact`) when you have the runner.

### `help` / `--version`

```sh
aristotle-reviewer help
aristotle-reviewer --version
```

## Exit codes

| Code | Meaning |
|---|---|
| `0` | PASS — verification succeeded |
| `1` | FAIL — verification failed, file unreadable, or required argument missing |
| `2` | Unknown subcommand |

## Output

Every command emits a structured JSON report on stdout (suitable for `| jq`) and a one-line PASS/FAIL summary on stderr. Redirect stdout to capture the report:

```sh
aristotle-reviewer verify ./bundle.json > report.json
jq '.verification.failures' report.json
```

## License

Apache-2.0. No warranty of any kind. See LICENSE and NOTICE.

> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NONINFRINGEMENT.
