# Aristotle Autonomous Governance OS — Strategic Audit

**Audience:** Solutions architect evaluating fitness as the governance / registration / tracking / insurance-evidence layer for autonomous systems, eventually as a candidate for state and federal mandate.

**Methodology:** Whole-file reads of every project source under `extracted/` (not the bundled `node_modules` zod tests). Every technical claim cites `file:line`. Assumptions are marked **[ASSUMPTION]**. The codebase under-delivers on README claims at multiple points; this audit names them rather than rephrasing them.

**Scope of repo:** `extracted/` is the working tree. Git only tracks the zip — but the analysis treats the extracted source as the project. Total project source ~16 files of meaningful TS, ~430 KB excluding the 171 KB UI single-file. **Zero project-level test files exist** (the `**/*.test.ts` matches are all inside `node_modules/.pnpm/zod@*/.../tests/`; the project's `npm run test` is `echo 'tests not yet configured'` — `package.json:25`).

This file accumulates four deliverables. Each finishes with a "**Pause for review**" marker; the next deliverable is appended on the next turn.

---

# DELIVERABLE 1 — GROUND TRUTH MAP

## A. Cross-cutting facts that frame every service

These are properties of the runtime as a whole. They get cited from inside each service section below.

1. **Every service is a single-file Express app.** `src/index.ts` is the route layer; `src/lib.ts` is shared boilerplate. All 10 `lib.ts` files are byte-identical (md5 `e0ae67c0c4459c042d25773b02c93fb2`, verified across `services/*/src/lib.ts` and `adapters/http-gateway/src/lib.ts`). The shared `lib.ts` (`services/governance-kernel/src/lib.ts:1-19`):
   - loads `.env` via Node's built-in `process.loadEnvFile?.()` (line 6-9) — **only on Node ≥ 20.6 / 22 / 24** (optional-chained, silently no-op on older Node). `dotenv` is *not* a dependency.
   - generates artifact IDs with `Math.random().toString(36).slice(2,10)` (line 19). Not crypto-secure. Used for warrant IDs, decision IDs, finality-certificate IDs, ledger event IDs — anything in the audit chain.
2. **All authoritative state is in-process Maps.** No service uses a database. Two services (`evidence-ledger`, `agent-os`) persist to a single JSON file; the other eight lose all state on restart.
3. **Inter-service auth is non-existent.** Services accept any request from any caller that can reach their port. Service-to-service calls (`agent-os → governance-kernel`, `agent-os → evidence-ledger`, etc.) are bare `fetch()` — no shared secret, no mTLS, no signed payload. See e.g. `services/agent-os/src/index.ts:316-331` (`commitLedgerEvent`) — actor is the literal string `"agent-os"`, asserted not authenticated.
4. **All "verification" status fields are self-attested.** Every artifact has `verification: { status: "verified", verifier: "<self>" }` written by the issuing service itself. There is no cross-service signing. The evidence-ledger does append its own digest/signature *on top* of the artifact (see §C.3 below), but that signature attests "the evidence-ledger received this object," not "the upstream service produced it."
5. **No tests exist in the project tree.** The `npm run test` script is `echo 'tests not yet configured'` (`package.json:25`). `validate-core.ts` and `validate-stack.mjs` are E2E happy-path scripts run against a live gateway; neither asserts cryptographic properties or adversarial behavior.
6. **Workspace IDs of `.json` data have already accumulated 16.7 MB** of ledger state and 3.6 MB of agent-os state from prior runs (`services/evidence-ledger/data/evidence-ledger.json`, `services/agent-os/data/agent-os.json`). The persistence model rewrites these whole files on every commit (see §C.3).

## B. Per-service map

### B1. governance-kernel (port 7001) — `services/governance-kernel/src/index.ts` (147 lines)

**Stated responsibility (README:42, architecture.md:11):** "kill-switch state, authority envelopes, execution warrants" — the constitutional pre-execution boundary.

**Implemented behavior:**
- In-memory `Map<string, AuthorityEnvelope>` envelopes (line 13), `Map<string, ExecutionWarrant>` warrants (line 14), `KillSwitchEvent[]` killEvents (line 15). Lost on restart.
- `POST /validate-envelope` (line 71) calls `meta-authority-registry/resolve`, then on success **always** constructs a fully-formed envelope and stamps `verification: { status: "verified" }` (line 94). On failure to reach the registry, **falls back to "local fallback" with `allowed: true`** (line 77). The fallback explicitly defeats the entire authority chain.
- `POST /issue-warrant` (line 99) checks kill-switch by scope, fetches the envelope from the in-memory map, and issues a warrant. Witness obligation count comes from `process.env.WITNESS_QUORUM ?? 2` (line 122).
- `POST /evaluate-admissibility` (line 128) returns `admissible: true` whenever `appliesKillSwitch` returns false — there is no actual policy evaluation. The `policyCompileId` parameter is accepted but unused except as a string in the reasons array (line 142).
- `POST /kill-switch` (line 53) lets *any* caller flip global kill-switch state. No auth check at the service level.

**Gap vs. stated responsibility (large):** The kernel does not enforce policy; it manufactures conformant artifacts. "Verified" envelopes are not signed, not chained to the meta-authority registry except by reference string, and degrade silently to `allowed: true` if the registry is unreachable.

**Public contract:**
- `GET /health` → `{ ok, service, killSwitchState, activeKillScopes }`
- `GET /envelopes` → `{ items: AuthorityEnvelope[] }`
- `GET /warrants` → `{ items: ExecutionWarrant[] }`
- `POST /kill-switch` → KillSwitchEvent (writes)
- `POST /validate-envelope` → `{ allowed, envelope, issuerChainExplanation }`
- `POST /issue-warrant` → ExecutionWarrant
- `POST /evaluate-admissibility` → `{ admissible, reasons }`

**Persistence:** None. Process restart loses all warrants, envelopes, kill-switch events.

**Failure modes when dependencies unavailable:**
- Meta-authority-registry unreachable → `validate-envelope` falls back to `{ allowed: true, chain: ["maa-root-001"], explanation: "local fallback" }` (line 77). **This is fail-open.** Anything that depends on envelope validity will accept the fallback as valid.

**Test coverage:** None. The `validate-core.ts` script exercises kill-switch through the gateway path but does not test the fallback-on-registry-unreachable behavior.

---

### B2. policy-compiler (port 7002) — `services/policy-compiler/src/index.ts` (42 lines)

**Stated responsibility (README:43):** "compiles mission policy from inputs" — the policy compilation step in the constitutional execution loop.

**Implemented behavior:** This is a stub. `POST /compile` (line 17) splits `policyText` on `\n`, checks every line contains `:`, returns a hardcoded graph of 5 nodes and 4 edges (`meta-authority → authority → witness → execution → ledger`, line 27-33), and uses the first 12 lines' prefix-before-colon as `admissibilityRules`. There is no compilation, no policy DSL, no evaluation, no fail-closed semantics. A `policyText` of `a:1\nb:2\nc:3` returns `valid: true`.

**Public contract:**
- `GET /health` → `{ ok, service }`
- `POST /compile` → `CompileOutput` (`{ compileId, valid, graph, admissibilityRules, errors }`)

**Persistence:** None. No state.

**Failure modes:** No external deps; the service has nothing to fail against.

**Gap vs. stated responsibility (total):** "Policy compiler" exists in name only. There is no policy language. This means every other service that calls `compilePolicyArtifact` (e.g. `agent-os/src/index.ts:406`) is ratifying a syntactically-valid string as a "compiled policy."

**Test coverage:** None.

---

### B3. evidence-ledger (port 7003) — `services/evidence-ledger/src/index.ts` (734 lines)

**Stated responsibility (README:44, architecture.md:8):** "durable, signed audit log of governance + replay events." This service is the most load-bearing piece in the entire insurance/admissibility argument the project makes about itself.

**Implemented behavior — durability:**
- State (`committed: ReplayEvent[]`, `branches: Map`, `hypothetical: Map<branchId, ReplayEvent[]>`) lives in-memory (lines 68-71).
- `schedulePersist()` (line 80-90) serializes the **entire state** to JSON and rewrites `EVIDENCE_LEDGER_STATE_PATH` on every commit. With 16.7 MB of accumulated state, every commit rewrites 16.7 MB.
- The persist path uses `writeFile` (non-atomic, no temp+rename, no fsync). A crash mid-write corrupts the file; a partial JSON parse on next boot triggers `console.error("evidence-ledger load failed", error)` (line 112) and silently starts with empty state. **There is no crash-consistent commit.**
- `persistQueue` (line 80) chains writes; the `.catch` swallows errors and only logs (line 86-88) — **the API caller of `/events/commit` is not informed that its commit failed to persist**.
- `loadState` reads the file at boot (line 632); if `ENOENT`, starts empty.

**Implemented behavior — signing:**
- Two modes: HMAC-SHA256 (with `EVIDENCE_LEDGER_SIGNING_SECRET`) or Ed25519 (with `EVIDENCE_LEDGER_SIGNING_PRIVATE_KEY_PATH` / `..._PUBLIC_KEY_PATH`). Without either, every artifact gets `verification.status: "unverified"` (line 207-213). The signing helpers live at line 174-221.
- `stableJson` (line 161-172) excludes `signature`, `verification`, and `digest` from the signed bytes — correct, but only excludes those three keys.
- The signature is applied **per-artifact**, not per-event-and-not-chained: each artifact carries its own `digest` and `signature`. **There is no hash chain.** `prevHash`, Merkle root, transparency log, or anchor block are absent.
- The signing key is held by the evidence-ledger process itself. It is loaded at startup with `createPrivateKey(readFileSync(resolvedLedgerPrivateKeyPath, "utf8"))` (line 59). There is no HSM, no KMS, no detached signer service.
- **Critical:** `synthesizeArtifactsFromEvent` (line 229-592) reconstructs typed artifacts (envelopes, warrants, decisions, finality certs, identity attestations, autonomy attestations, assurance attestations, kill-switch events, recovery plans) **from the event payload** at index/query time. Then `extractArtifactsFromEvent` (line 602-609) calls `verifyArtifact` on the reconstructed object (line 174), signing it. **The signature is over the ledger's reconstruction, not the upstream service's original artifact.** An auditor inspecting an envelope's signature is verifying that the ledger saw a payload it derived this artifact from — not that the governance-kernel actually issued that envelope.

**Implemented behavior — replay & branches:**
- `POST /events/commit` (line 638) appends to `committed`, calls `ingestArtifactsFromPayload`, schedules persist. Trusts caller-supplied `traceId`, `chainId`, `actor` (line 639-654).
- `POST /branches` and `POST /branches/:id/events` (line 656-689) create counterfactual hypothetical event lists. These are **not signed** in any different way from committed events; they go through the same `verifyArtifact` path on read.
- `GET /replay` (line 691) and `GET /timeline` (line 707) — query API.
- `GET /artifacts` (line 717) returns the synthesized artifact view for a trace/branch/relatedId.

**Public contract — what writers can claim:**
- Anyone reachable on port 7003 can `POST /events/commit` with any `actor`, any `eventKind`, any `payload`. Authenticity is by trust, not by cryptographic check at the boundary.

**Persistence model and durability guarantees that ACTUALLY hold:**
- "If the JSON file survives, and if the signing key has not been rotated/lost, individual artifacts can be Ed25519-verified against the ledger's own key." That is the entire guarantee.
- **Not held:** append-only behavior (the file is rewritten on each commit), tamper-evident sequencing (no chain), externally-anchored time (timestamps are local Node `new Date().toISOString()`), defense against the ledger itself being malicious or compromised.

**Failure modes:**
- File write race / crash: persist queue swallows error → in-memory state is ahead of disk. On crash, those events are lost without notice to upstreams.
- Disk full: same as above.
- Signing key unavailable at boot: `createPrivateKey(readFileSync(...))` (line 59) — uncaught throw, process dies. **[ASSUMPTION]** there is no graceful failover.
- No write-time validation: a malformed `eventKind` string never errors.

**Test coverage:**
- `validate-core.ts:108-110` asserts a `governance.kill-switch.updated` event appears in `/operator/ledger?traceId=...` after a halt. Asserts presence; does not assert signature, ordering, or that it survives a restart.
- `validate-core.ts:130-133` asserts counterfactual branch artifacts include an `authority-envelope`. Again presence-only.
- No test of `loadState` after corruption; no test of HMAC vs Ed25519 fallback; no test of crash mid-write; no test asserting `prevHash`/chain (because there is none); no test asserting timestamps cannot be replayed.

---

### B4. meta-authority-registry (port 7004) — `services/meta-authority-registry/src/index.ts` (106 lines)

**Stated responsibility (README:45):** "root authority chain resolution" — the constitutional source of "who can delegate what."

**Implemented behavior:**
- Bootstrap seeds 4 hardcoded `MetaAuthorityArtifact` records: `maa-root-001` (`coalition.core` root), `maa-mission-command-001` (mission delegation), `maa-safety-council-001` (safety delegation, witness-required), `maa-evidence-steward-001` (ledger delegation) — lines 8-65.
- `POST /artifacts` (line 74) accepts arbitrary new artifacts from any caller and stamps them `verification: "verified", verifier: "registry"`. **No signature check, no caller authentication, no parent-authority verification.** A caller can write `{ delegationClass: "root", mayMintAuthority: true }` and the registry will treat it as a verified peer of the bootstrap root.
- `POST /resolve` (line 92) checks if any artifact's `subject` or `actor` matches the requested `issuer` and contains the `domain`. The subject-match is the actor-supplied string in the request body of `governance-kernel/validate-envelope`.

**Gap vs. stated responsibility (large):** "Root authority chain resolution" implies a tamper-evident, signed chain. What exists is a writable in-memory dictionary with case-insensitive substring matching as the resolver.

**Persistence:** None. Process restart re-seeds the four bootstrap records.

**Failure modes:** No external deps. Will always answer.

**Test coverage:** None.

---

### B5. simulation-engine (port 7005) — `services/simulation-engine/src/index.ts` (209 lines)

**Stated responsibility (README:46):** "counterfactual / replay simulation."

**Implemented behavior:**
- `let tick = 0` increments every `REPLAY_TICK_MS` (line 4, 206) — a fake mission clock.
- `let degradedNodes = ["mesh.gamma"]` (line 7) — the global mesh state.
- `GET /telemetry` (line 37) returns three fixed nodes (`mesh.alpha`, `mesh.beta`, `mesh.gamma`) with hardcoded loads (`0.62, 0.38, 0.81`).
- `POST /degrade` lets any caller mutate the global `degradedNodes` array (line 48-51).
- `POST /counterfactual` (line 52-205) is the meaningful endpoint. Given a scenario `{ degradedNodes, injectKillSwitch, route, scope, scopeRef }`, it deterministically computes a "projected" route, a list of recovery paths, and a `projectedOutcome` of `halt | reroute | continue`. The logic at lines 60-119 is rule-based, not stochastic. Same input → same output.

**Gap:** "Simulation" is misleading. There is no Monte Carlo, no stochastic process, no agent model. It's a pure-function `if/else` over the input. This is fine as a *what-if route projector* but is not a system simulator.

**Persistence:** None.

**Failure modes:** None — no external deps.

**Test coverage:** `validate-core.ts:112-128` asserts `projectedOutcome === "reroute"` when `mesh.alpha` is in `degradedNodes`. That confirms the deterministic logic; no test of distribution, noise, or robustness under malformed input.

---

### B6. authority-router (port 7006) — `services/authority-router/src/index.ts` (90 lines)

**Stated responsibility (README:47):** "routes envelopes/decisions across authority domains" — the failover-and-delegation lane decider.

**Implemented behavior:** A pure function. `POST /route` (line 17) maps `domain × phase × riskLevel` to one of `mesh.alpha | mesh.beta | mesh.gamma | mesh.delta` (line 28-35), inspects `degradedNodes` and `requiredAuthorities`, and returns a `selectedPath`, `rejectedPath`, `continuity`, `mode`. The logic is hardcoded (`safety` or `riskLevel === "high"` → `mesh.delta`, etc.).

**Gap:** "Routes envelopes/decisions" implies dynamic routing decisions tied to actual authority relationships. Implementation is a static lookup table on string equality. The only stateful concept is which mesh node is "degraded," and that string list is supplied by the caller (the router doesn't know whether a node really is degraded).

**Persistence:** None.

**Failure modes:** None — no external deps.

**Test coverage:** Indirect via `validate-core.ts` (route presence in `executionTasks[*].governance.route`). No test of degraded-routing correctness, of `disconnected` continuity, or of authority anchor selection.

---

### B7. witness-service (port 7007) — `services/witness-service/src/index.ts` (36 lines)

**Stated responsibility (README:48):** "quorum-based witness verification."

**Implemented behavior:**
- `POST /verify` (line 10): the quorum check is `quorumReached = requestedWitnesses.length` (line 12). **The number of requested witnesses *is* the number of witnesses reached.** The service does not contact any external witness, run any consensus protocol, or check any signature. Default witnesses are hardcoded `["node.attest.1", "node.attest.2"]` (line 11).
- The receipt is set `accepted: true` if `quorumReached >= quorumRequired`, which is trivially true unless the caller passes more witnesses than requested. With defaults, `quorumReached = 2 ≥ quorumRequired = 2 → accepted = true`.

**Gap vs. stated responsibility (total):** This service rubber-stamps. It does not implement Byzantine-quorum signing, threshold signatures, BFT ordering, or any independent attestation. The "witness receipt" is fabricated by a single process from caller-supplied strings. This is the load-bearing artifact for any insurance/finality claim.

**Persistence:** In-memory `receipts` Map (line 7); lost on restart.

**Failure modes:** None.

**Test coverage:** None directly; the `validate-core.ts` and `validate-stack.mjs` paths use mission `riskLevel: "medium"`, which `agent-os/src/index.ts:1485` says doesn't require witness, so the witness path is not exercised in the bundled validators.

---

### B8. execution-gate (port 7008) — `services/execution-gate/src/index.ts` (172 lines)

**Stated responsibility (README:49):** "explicit commit-point allow/deny boundary checked at task dispatch and completion (kill-switch, identity legitimacy, authority approval, telemetry satisfaction)."

**Implemented behavior:**
- Two endpoints: `POST /commit-point` (line 63) for dispatch and `POST /decide` (line 133) for completion.
- Both check kill-switch via `appliesKillSwitch` (line 25-43) — a *local* in-memory copy of kill-switch state, set via the gate's own `POST /kill-switch` (line 49-62). The gate does *not* check the kernel's kill-switch state. Kill-switch consistency between kernel and gate depends on the gateway (`adapters/http-gateway/src/index.ts:900-936`) calling both endpoints. **A direct write to the kernel's kill-switch (port 7001) does not propagate to the gate's kill-switch (port 7008).**
- `POST /commit-point` is a function of the booleans the *caller* supplies: `witnessAccepted`, `witnessRequired`, `identityLegitimate`, `authorityApproved`, `telemetrySatisfied` (lines 67-75). The gate does not independently verify any of these. Its decision is `kill-switch override OR (boolean AND)`. **The "commit point" is the caller's self-attestation packaged as a decision artifact.**
- `decision` becomes `halt` if kill-switch active, `allow` if all booleans true, else `deny` (lines 119-124).

**Gap vs. stated responsibility (significant):** "Explicit commit-point boundary" implies independent verification at the boundary. The gate provides a structured *signed-by-itself* decision artifact, but the inputs are caller-supplied strings/booleans. From a regulator's perspective this is a notarization of agent-os's own claim about itself.

**Persistence:** In-memory `decisions` Map (line 7) and `killEvents[]` (line 8); lost on restart.

**Failure modes:** None — no external calls.

**Test coverage:** Indirect via `validate-core.ts` blocked-task assertion (line 102-106). Does not test that `identityLegitimate: false` → `deny` (because no test path supplies that input).

---

### B9. agent-os (port 7009) — `services/agent-os/src/index.ts` (2902 lines, 107 KB)

**Stated responsibility (README:24-39, architecture.md:5-17):** "AI runtime layer: missions, agents, workspaces, tool leases, mission memory, execution queue, task lifecycle, governance pass before dispatch, witness/finality on completion, restart reconciliation, autonomous tick loop." This is the orchestrator and the single largest component.

**Implemented behavior — the constitutional pipeline:** `assessTaskGovernance` (line 1208-1411) is the canonical pre-execution check. For a mission task at `phase = "dispatch"` or `"completion"`, it sequentially:
  1. (line 1215, `readKillSwitchState`) caches `kernel/health.killSwitchState OR gate/health.killSwitchState` for `AGENT_OS_KILL_SWITCH_CACHE_MS = 1000ms` (line 54). **The cache means a kill-switch flip can take up to 1 second to be observed by the next task; longer if the cache hit window is misaligned.**
  2. (line 1216-1234) checks agent presence, authority chain non-empty, leased-tools coverage, agent trust-tier vs mission risk.
  3. (line 1266-1300) compiles policy via `policy-compiler` and validates envelope via `governance-kernel`. Both are *cached by JSON-stringified key* (`policyCompileCache`/`envelopeValidationCache`, line 161-167) and **never invalidated**. The same task title + governance profile reuses the *same* compileId across the lifetime of the process.
  4. (line 1302-1314) calls `authority-router/route` for an `AuthorityRoute`.
  5. (line 1316-1337) calls `governance-kernel/evaluate-admissibility`. The kernel's stub (B1) returns `admissible: true` unless kill-switch is active.
  6. (line 1339-1361) calls `governance-kernel/issue-warrant` with `witnessRequired: mission.riskLevel === "high"`.
  7. (line 1363-1399) calls `execution-gate/commit-point` with all 4 booleans hardcoded `true` *except* `telemetrySatisfied` (set from leased-tools coverage). **`identityLegitimate: Boolean(assignedAgent)`, `authorityApproved: true` are fixed in the source.** The gate has no way to refuse on identity grounds because the input is hardcoded by the caller.
  8. Returns `{ status: "approved", reasons, evaluatedAt, policyCompileId, envelopeId, warrantId, commitDecisionId, route }`.

  **Key observation:** The "constitutional pipeline" is real *as a sequence of recorded artifacts* but has no cryptographic linkage between steps. Each step's output ID is just a string the next step references. An attacker who can produce convincing IDs (or who controls agent-os) can manufacture the entire chain.

**Implemented behavior — completion governance:** `finalizeGovernedCompletion` (line 1471-1611):
  - If `mission.riskLevel === "high"`: calls `witness-service/verify` (line 1488-1521). With witness-service's stub (B7), this always succeeds. On failure to reach the witness service, marks `status: "blocked", witnessStatus: "unsatisfied"` (line 1514-1521). **Fail-closed here, unlike the kernel's fail-open envelope validation.**
  - If `mission.riskLevel !== "high"`: skips witness entirely. Witness is **not invoked for medium- or low-risk missions**. Anything that's not flagged "high" gets no quorum check. README marketing copy ("Witness verification… execution-gate decisioning… finality certificate") implies witness on every completion; the code makes it conditional.
  - Calls `execution-gate/decide` (line 1524-1539).
  - Builds `FinalityCertificate` (line 1563-1572) — generated *inside agent-os*, signed by no one, then committed to the ledger (line 1575-1589). The `ledger.commitIndex` is filled in from the ledger response (line 1590).

**Implemented behavior — reconciliation on restart:** `reconcileRecoveredState` (line 2042-2199) and `reconcileStaleRunningTasks` (line 2201-2213):
  - Re-queues every `running` task back to `queued` (line 2059-2068). **No check whether the task actually completed in the previous lifetime.** Idempotency is the caller-worker's responsibility.
  - Recovers receipts for `completed` tasks that lack a `success` receipt (line 2084-2104).
  - Revokes leases that expired or whose mission is `completed | halted` (line 2135-2146).
  - Resets agent statuses (line 2149-2167).
  - Emits `agent-os.runtime.reconciled` ledger event with `requeuedTaskIds`, `revokedLeaseIds` (line 2183-2194).
  - Heartbeat-stale check: if `now - heartbeatAt > AGENT_OS_HEARTBEAT_TIMEOUT_MS = 300000ms` (line 50, 2206), re-queues the task via `queueTaskRetry` (line 896-994) which itself caps at `AGENT_OS_TASK_MAX_ATTEMPTS = 3` (line 53).

**Implemented behavior — autonomous loop:** `runAutonomyTick` (line 2227-2271) runs on `setInterval(autonomyTickMs)` where default = 5000ms (line 56). For each active mission with no running task, it dispatches an *autonomously-safe* task (auditor or planner role, tools all in `autonomousSafeTools = {ledger, policy, witness, simulation, planning, docs}` — line 2215) and immediately completes it. **The loop self-completes its own tasks** without external worker involvement. This is the source of `autonomy-attestation` artifacts (line 511-531 in `evidence-ledger`, synthesized from `agent-os.execution.task.autonomous-completed` events).

**Implemented behavior — destructive-action heuristic:** `isPotentiallyDestructivePayload` (line 711-725) is a regex over the payload text:
```
/\b(rm|del|erase|rmdir|rd|delete|drop|truncate|overwrite)\b/.test(payloadText) ||
/\bremove-item\b/.test(commandText) || /\bcheckout\s+--\b/ || /\breset\s+--hard\b/
```
With an early-return for `ls/dir/Get-ChildItem`. **This is trivially bypassed.** `'rm `+`-rf /'`, `​rm -rf /`, `r''m`, `Invoke-Expression "remove" + "-Item"`, `git -c x=y reset -h --hard` etc. all evade. Any production "tool action" approval logic that depends on this regex is fragile.

**Public contract:** A large surface — agent registration, workspace creation, missions CRUD, task claim/heartbeat/complete/retry, tool-action propose/execute, lease renewal, reconcile, autonomy tick. All cited in `extracted/docs/api-contracts.md` and confirmed against the route table at `services/agent-os/src/index.ts:2431-2702`.

**Persistence:** Single JSON file `AGENT_OS_STATE_PATH`, full rewrite per commit (line 227-236), error swallowed in `.catch` (line 233). Same crash-consistency profile as evidence-ledger.

**Failure modes when dependencies unavailable:**
- `policy-compiler` unreachable → `compilePolicyArtifact` exception → `reasons.push("Governance services unavailable...")` (line 1297-1299) → task **blocked**. Fail-closed.
- `governance-kernel` unreachable for envelope validation → same path → blocked.
- `governance-kernel` unreachable for admissibility → blocked (line 1334-1336).
- `governance-kernel` unreachable for warrant → blocked (line 1358-1360).
- `execution-gate` unreachable for commit-point → blocked (line 1396-1398).
- `witness-service` unreachable on high-risk completion → blocked (line 1514-1521).
- `evidence-ledger` unreachable → `commitLedgerEvent` (line 316-331) catches the fetch error and **proceeds**. **The mission and task state advance even when the ledger is down.** When the ledger comes back, those events are gone — never recorded. This is a *fail-open* path for the audit trail.
- `simulation-engine`/`authority-router` unreachable → `resolveAuthorityRoute` throws → `reasons.push(...)` → blocked (line 1311-1313).

**Test coverage:**
- `validate-core.ts:30-46` creates a mission via `/operator/os/missions` and `/missions/:id/advance`.
- Asserts presence of `governance.route.selectedPath` in `executionTasks` (line 69-73).
- Asserts that scoped halt `scope: "mission"` blocks subsequent task dispatch (line 75-106).
- No test of restart reconciliation, no test of heartbeat-stale, no test of autonomy tick correctness, no test of retry budget exhaustion, no test of the destructive-action heuristic.

---

### B10. http-gateway (port 8080) — `adapters/http-gateway/src/index.ts` (1027 lines)

**Stated responsibility (README:42, deployment-runbook.md:8-22):** "single front door. Owns operator auth (API key, optional signed session, optional RBAC) and a production preflight." The boundary every operator action and every console click goes through.

**Implemented behavior — preflight:** `runGatewayPreflight` (`adapters/http-gateway/src/preflight.ts:13-94`). Four checks: `operator-api-key`, `operator-session-secret`, `service-discovery-mode`, `durable-state-paths`. In `NODE_ENV=production` any `fail` check raises and the gateway throws on boot (line 56-59 of `index.ts`). **Override:** `ALLOW_INSECURE_PRODUCTION_BOOT=1` downgrades all `fail` to `warn` and returns `ok: true` (line 75-87 of `preflight.ts`). The README documents this as "emergency override only" but the bypass is a single env var.

**Implemented behavior — operator auth (lines 553-623 of `index.ts`):**
- Three-layered: API-key bearer (`x-operator-key` or `Authorization: Bearer`), optional signed session, optional RBAC.
- **Session token:** `ost.<base64url-claims>.<HMAC-SHA256-signature>` (line 119-123). Signature is `HMAC-SHA256(payload, OPERATOR_SESSION_SECRET)`, compared with `timingSafeEqual` after equal-length check (line 133-137). TTL default 15min. Skew 60s (line 15-16).
- Session validation (line 186-208) checks `issuedAt`, `expiresAt`, and that any header-supplied `x-operator-actor`/`x-operator-role` matches the session claim. If headers omitted, the session's own claim is used.
- RBAC (line 17-45, 580-622): if `OPERATOR_ROLE_ENFORCEMENT=true`, the request's role must be in the read or mutation set. Defaults: read = `viewer/operator/admin`, mutate = `operator/admin`.
- **Hole #1 — actor is client-controlled:** `readOperatorActor` (line 176-181) reads `x-operator-actor` *or* falls back to the request body's `actor` field. Without an actor allowlist (`OPERATOR_READ_ACTORS`/`OPERATOR_MUTATION_ACTORS` empty by default), an authenticated operator can claim *any* actor identity, and that string lands in the ledger as the principal.
- **Hole #2 — VITE_OPERATOR_API_KEY ships to browsers:** the dashboard's auth headers come from `apps/console-ui/src/gateway-client.ts:3-8`, which read `import.meta.env.VITE_OPERATOR_API_KEY`. Vite bakes this into the production bundle. If set on the server side `.env` for any deployment that serves the bundled console-ui, the operator API key is in the JS payload to every browser. README documents this for "trusted boundary" deployments only (README:74), but there is no enforcement against it in production preflight.
- **Hole #3 — `/health` doesn't include authority-router:** the `Promise.allSettled` block (line 628-637) hits 8 upstream `/health` endpoints — `governance-kernel`, `policy-compiler`, `evidence-ledger`, `meta-authority-registry`, `simulation-engine`, `witness-service`, `execution-gate`, `agent-os`. **`authority-router` (port 7006) is missing.** The gateway will report `ok: true` even if authority-router is down. (Verified by re-reading lines 628-637 against the upstream-base list at lines 69-81: 9 services in the base list but only 8 in the health check.)

**Implemented behavior — orchestration:** Most operator routes are pass-through to agent-os, evidence-ledger, or governance-kernel. Two orchestrating routes:
- `/operator/govern` (line 937-994) executes the full envelope→warrant→route→witness→decide→commit cycle in one call. This is the canonical "demo" path used by validators; not the path used by mission tasks (those go through agent-os).
- `/operator/kill-switch` (line 900-936) writes to **both** `governance-kernel/kill-switch` and `execution-gate/kill-switch` and commits the event to evidence-ledger. This is the only route that maintains kernel/gate kill-switch consistency. Direct service writes (port 7001 or 7008) bypass this.

**Assurance report:** `getAssuranceReport` (line 279-381) walks `agent-os/state` and `evidence-ledger/artifacts`, then computes per-mission posture as `insurable` if `agentVerified && deviceVerified && finalityCertificates > 0 && autonomyAttestations > 0` (line 220-230). **The "insurable" verdict is a count-based heuristic.** Identity verification means "an `identity-attestation` artifact exists for this mission and isn't `failed`." That artifact is itself synthesized inside the evidence-ledger from the agent's own self-described `agentFingerprint` field (`evidence-ledger/src/index.ts:463-509`). End to end: agent-os says "this is the fingerprint," evidence-ledger turns that into a verified-stamped artifact, gateway counts it as identity-verified.

**Persistence:** None.

**Failure modes:** Per-route try/catch via `handleAsync` (line 146-155) returns `502 upstream_failure`. No degradation modes; the gateway is stateless.

**Test coverage:** `validate-stack.mjs` exercises preflight, deployment posture, deployables catalog, operator state, assurance report, dashboard reachability. It does not test:
- Session expiry / replay
- Actor allowlist outside the explicit `unauthorized-smoke-actor` happy-path (line 88-101)
- The fact that VITE_OPERATOR_API_KEY is browser-shipped
- The authority-router gap in `/health`
- That bypassing the gateway and directly hitting `governance-kernel:7001` from another container on the docker network would succeed (no inter-service auth)

---

## C. End-to-end traces

### C1. Governed task dispatch (policy → envelope → admissibility → warrant → gate → witness → finality)

This trace follows what the README describes as the constitutional execution loop (README:30-39, architecture.md:9-17). Citations are to the *implementation* path.

**Step 0 — operator advances mission**: `POST /operator/os/missions/:missionId/advance` enters the gateway at `adapters/http-gateway/src/index.ts:884-899`. After auth middleware (line 553-623), it forwards to `agent-os/missions/:id/advance`.

**Step 1 — agent-os entry**: `services/agent-os/src/index.ts:2836-2900`. Calls `progressExecutionLoop(mission, action)` (line 2843).

**Step 2 — task dispatch**: `progressExecutionLoop` calls `dispatchNextEligibleTask(mission)` (line 2354). This calls `assessTaskGovernance(mission, nextQueued, "dispatch")` (line 1624 → 1208).

**Step 3 — kill-switch check**: `assessTaskGovernance` first calls `readKillSwitchState()` (line 1215), which fetches `/health` from kernel and gate (line 481-487 of agent-os) and caches for 1s. If either is "active," `reasons.push("Kill switch active.")` (line 1222-1224). Returns blocked at line 1402-1410 if reasons.

**Step 4 — policy compile**: `compilePolicyArtifact(policyName, policyText)` (line 406-437). The compiler is the stub at `services/policy-compiler/src/index.ts:17-39`. Returns a structurally-valid output for any `key:value` text. Result cached forever in `policyCompileCache` (line 161, 426).

**Step 5 — envelope validation**: `validateEnvelopeArtifact(envelopePayload)` (line 439-474). Calls `governance-kernel/validate-envelope` (line 447). Kernel calls `meta-authority-registry/resolve` (line 73-77 of kernel). If registry unreachable: kernel falls back to `{ allowed: true, chain: ["maa-root-001"], explanation: "local fallback" }` (line 77 of kernel) — **silent fail-open**. Kernel constructs envelope (line 79-95) and stores in-memory (line 96).

**Step 6 — authority routing**: `resolveAuthorityRoute(mission, ...)` (line 771-805 of agent-os) calls `authority-router/route` (line 17-86 of router). The router's "decision" is a static lookup table (cited in B6). Returns `AuthorityRoute` with `selectedPath`, `mode`, `continuity`.

**Step 7 — admissibility evaluation**: `governance-kernel/evaluate-admissibility` (line 128-144 of kernel). Returns `admissible: true` unless `appliesKillSwitch` is true (line 138-139). Effectively: if the kill-switch isn't active, you're admissible.

**Step 8 — warrant issuance**: `governance-kernel/issue-warrant` (line 99-127 of kernel). Generates `id("war")` via `Math.random()` (line 114). Persists to in-memory map. Witness obligation set from `mission.riskLevel === "high"` (line 1350 of agent-os, fed into the warrant call).

**Step 9 — commit-point gate**: `execution-gate/commit-point` (line 63-132 of gate). All inputs from caller. agent-os sends `identityLegitimate: Boolean(assignedAgent)` (line 1373), `authorityApproved: true` (line 1374, hardcoded), `telemetrySatisfied: missingLeaseTools.length === 0` (line 1375), `witnessAccepted: true, witnessRequired: false` (lines 1371-1372 — **on dispatch, witness is always not-required regardless of mission risk level**). Decision becomes `allow` if no kill-switch and these booleans all true.

**Step 10 — task claim and ledger commit**: agent-os calls `claimTaskForAgent` (line 807-825), commits `agent-os.execution.task.dispatched` to evidence-ledger (line 1649-1660). The ledger commit is fire-and-forget; if it fails, dispatch still proceeds (line 316-331).

**Step 11 — completion path**: When the worker calls `POST /operator/os/tasks/:taskId/complete` → `completeTaskWithGovernance` (line 1664-1783). This re-runs `assessTaskGovernance(mission, task, "completion")` (line 1680), then `finalizeGovernedCompletion` (line 1683 → 1471):
  - If `riskLevel === "high"`: witness verify (line 1488-1521). Witness service rubber-stamps (B7). High-risk completions therefore always pass witness in nominal operation.
  - `execution-gate/decide` (line 1524-1539). Passes the witness boolean and same fixed booleans as before.
  - On allow: builds `FinalityCertificate` *in agent-os* (line 1563-1572), commits `agent-os.execution.task.finalized` to ledger (line 1575-1589). The certificate's `ledgerCommitIndex` is set from the ledger's commit response.

**End-to-end signature posture:** Of all the artifacts produced in this flow, only ledger-stored ones are signed (Ed25519 or HMAC, by the ledger's own key). The intermediate envelope, warrant, decision, and witness receipt produced by their respective services are stored in those services' RAM with `verification: { status: "verified", verifier: "<self>" }` and **carry no signature field at all** until/unless they're synthesized inside the evidence-ledger from a payload-snapshot of the event (B3). Restart of any of the 7 stateless services destroys the originals; only the ledger-side reconstruction survives.

### C2. Restart reconciliation in agent-os

Triggered automatically at boot (`services/agent-os/src/index.ts:2422-2424`):
```
await loadState();
await reconcileRecoveredState();
await reconcileStaleRunningTasks();
```

**`loadState`** (line 239-289): reads JSON file, populates the eight Maps (agents, missions, workspaces, leases, memory, tasks, receipts, tool-actions). On parse error, logs and continues with empty state (line 283-287). **There is no integrity check on the file** — no signature, no checksum, no version field beyond TS structure. A truncated or malicious-edited JSON either parses (bad data accepted) or fails (silent reset to empty).

**`reconcileRecoveredState`** (line 2042-2199):
- For each `running` task: forces back to `queued` with a `recovery` note, attempts to record continuity. **Loses the in-flight worker's claim**; the next claim restarts the attempt counter.
- For each `completed` task without a success receipt: synthesizes one (line 2085-2102) — but this is recovery from a previously-undocumented completion, not from the original execution. The synthesized receipt has `summary: "...recovered as completed from persisted state."`
- For each lease: revokes if expired or mission-closed (line 2135-2146).
- For each agent: recomputes status from running-task incidence (line 2149-2167).
- Per touched mission: writes a `recovery` memory record (line 2170-2178) and commits `agent-os.runtime.reconciled` to evidence-ledger (line 2183-2194). **If the ledger commit fails, the in-memory state has already been mutated and persisted — the audit trail loses the reconciliation.**

**`reconcileStaleRunningTasks`** (line 2201-2213): for every running task whose heartbeat is older than `heartbeatTimeoutMs` (default 300_000ms = 5min), call `queueTaskRetry` which either re-queues or, if attempts ≥ 3, blocks the task with `Retry limit reached: ...` (line 901-934).

**Failure mode of reconciliation: ledger desync.** If `agent-os.json` survives a crash but `evidence-ledger.json` does not (different volumes, different mount), the reconciliation event commits into a fresh empty ledger, and the audit trail begins at "Runtime recovered persisted state on restart" with no prior history. Conversely, if the ledger survives and agent-os does not, the ledger holds events for `taskId`s that no longer exist — orphan history.

### C3. Operator mutation through the gateway auth stack

Following `POST /operator/os/missions` (mission creation):

**Hop 1 — TCP arrives at gateway**: Express body parser (`adapters/http-gateway/src/lib.ts:14`, `app.use(express.json({ limit: "2mb" }))`).

**Hop 2 — operator auth middleware** (`adapters/http-gateway/src/index.ts:553-623`):
- Read session token from `Authorization: Bearer ost....` (line 558, 167-174).
- If session token present: `parseOperatorSessionToken` validates HMAC (line 125-144) using `timingSafeEqual` (line 135). On signature mismatch returns `null`, gateway rejects 401 (line 561-563).
- `validateSessionClaims` (line 186-208) checks `issuedAt - skew ≤ now ≤ expiresAt + skew`, and that any header-supplied actor/role matches the claim. **Headers can be omitted to use the session's claim** — but they cannot be made *different* from the session.
- Actor allowlist (line 570-577): if `OPERATOR_*_ACTORS` is non-empty, claimed actor must be in it.
- Role enforcement (line 578-587): if `OPERATOR_ROLE_ENFORCEMENT=true`, claim role must be in read/mutation set per HTTP method.
- If no session token: tries API-key path (line 595-622). With `OPERATOR_SESSION_ENFORCEMENT=true`, the API-key path is *blocked* for non-`/auth/session` paths (line 591-594). Without enforcement, API-key in `x-operator-key` or `Authorization: Bearer` is accepted. Same actor/role checks.
- If neither: `401 operator_auth_required`.

**Hop 3 — route handler**: `app.post("/operator/os/missions", ...)` at line 860-883. Three sequential upstream calls:
  1. `agent-os/missions` POST (line 863-867) — actually creates mission/workspace/leases.
  2. `policy-compiler/compile` POST (line 868-875) — auto-compiles `governanceProfile` policy text.
  3. `evidence-ledger/events/commit` POST (line 876-880) — records `agent-os.mission.created` with the operator's `actor` (from header or body).

**Hop 4 — actor identity recorded**: The ledger commit's `actor` field is `readOperatorActor(req)` (line 879). With no allowlist set, this is whatever the client supplied. **The signed Ed25519 (or HMAC) signature on that ledger event covers the *string* `actor: "client-supplied-name"` — it does not bind to a verified principal.** A subpoena that asks "who created this mission" can only point to a string that the client controlled.

**Hop 5 — propagation**: agent-os emits its own ledger events (B9) with actor `"agent-os"`, not the operator's. The link between operator action and downstream events is `traceId === missionId` (line 879, gateway side; line 1649, agent-os side). Across the call chain, the only invariant that ties an operator to a downstream task is the `missionId` string. **There is no signed delegation chain.**

**Cross-cutting hole:** A second client on the docker network can reach `agent-os:7009` directly (no auth), call `/missions` directly, and skip the gateway entirely. Same for the kernel, the gate, and the ledger. Service-to-service is on a flat trusted network. The gateway provides external auth, not internal isolation.

---

## D. Cross-cutting observations to carry forward

1. **The "constitutional pipeline" is real as a sequence of named API calls and recorded artifacts; it is not a cryptographic chain.** Every "verified" stamp is self-stamped by the issuing service. Only the evidence-ledger applies a signature, and that signature is over a payload-derived reconstruction inside the ledger, not over the upstream service's claim.
2. **The audit trail is fail-open.** When `evidence-ledger` is unreachable from agent-os, mission state advances and tasks complete; the ledger silently misses those events (`services/agent-os/src/index.ts:316-331`).
3. **The authority root is writable by any caller.** Anyone reaching `meta-authority-registry:7004/artifacts` (POST) can mint root-class authorities (`services/meta-authority-registry/src/index.ts:74-91`).
4. **Witness is not run for non-high-risk completions.** README implies witness on every governed completion; code only invokes it for `riskLevel: "high"` (`services/agent-os/src/index.ts:1485-1488`). Default mission risk is `"medium"` (line 2761).
5. **Witness is itself a stub.** Even when invoked, it does not perform any consensus protocol (`services/witness-service/src/index.ts:10-28`).
6. **The execution-gate's "commit-point" inputs are caller-supplied booleans.** The boundary is a notarization, not a verifier (`services/execution-gate/src/index.ts:63-132`).
7. **Persistence is whole-file JSON rewrites.** Both agent-os and evidence-ledger rewrite their entire state on every commit (`services/evidence-ledger/src/index.ts:80-90`, `services/agent-os/src/index.ts:227-236`). With current state already at ~20 MB combined, this is also unworkable at scale.
8. **There are no tests.** `npm run test` is `echo`. The two validators are happy-path E2E checks against a live gateway.
9. **Operator API key ships to browsers when `VITE_OPERATOR_API_KEY` is set** (`apps/console-ui/src/gateway-client.ts:3-4`).
10. **`/health` lies by omission about authority-router.** `adapters/http-gateway/src/index.ts:628-637` checks 8 of 9 services. A down router does not surface in the gateway's top-level health.
11. **IDs are `Math.random`-derived** (`services/governance-kernel/src/lib.ts:19`). This is shared across all 10 services for warrant IDs, finality-certificate IDs, ledger event IDs.
12. **Restart reconciliation can desync from the ledger.** If the ledger crashes but agent-os doesn't (or vice versa), the audit trail loses or orphans critical recovery events.

These twelve observations are the seed of Deliverable 2 (conformance gap analysis) and Deliverable 3 (adversary model).

---

**Deliverable 1 reviewed and approved. Deliverable 2 begins below.**

---

# DELIVERABLE 2 — CONFORMANCE GAP ANALYSIS

**Frame:** Evaluating fitness as a regulatory/insurance-grade artifact, not as a software project. Per-framework: what the codebase already satisfies, partially satisfies, and is missing. Citations to both framework sections **and** code references. The matrix at §H is the executive summary.

**A note on what this analysis does and does not say.** Some framework requirements are organizational/process obligations that no codebase can satisfy on its own (e.g., "the organization shall maintain a risk register"). Where a framework section is fundamentally process-centric, I score the *technical substrate* the codebase would have to provide for that process to operate, and explicitly say "process-only" if the gap can't be closed by code.

**[ASSUMPTION] Framework knowledge basis.** Citations to NIST AI RMF 1.0 (NIST AI 100-1, Jan 2023), the Generative AI Profile (NIST AI 600-1, Jul 2024), SP 800-53 Rev. 5, ISO/IEC 42001:2023, ISO/IEC 27001:2022, the EU AI Act (Regulation (EU) 2024/1689), 14 CFR Part 107 / Part 89 (Remote ID) / proposed Part 108 BVLOS, NHTSA Standing General Order 2021-01 and ADS 2.0, California 13 CCR § 227.00–227.52 and SB 1298, Arizona EO 2018-04 / ARS § 28-9701 et seq., and Federal Rules of Evidence 803(6)/901/902. Where a specific clause number is uncertain at the section level I cite the section name and mark **[ASSUMPTION]**. The user should sanity-check before quoting clause numbers verbatim to a regulator.

---

## A. NIST AI Risk Management Framework 1.0 + Generative AI Profile

NIST AI RMF organizes risk management into four functions: **GOVERN, MAP, MEASURE, MANAGE**. Each function has categories (e.g., GOVERN-1, MAP-2). The Generative AI Profile (AI 600-1) extends these with GAI-specific actions (e.g., "GV-1.3-001", "MS-2.7-002"). This codebase is positioned as a *control plane* for AI agents, so the relevant lens is whether it provides the technical substrate for an organization to satisfy these functions.

### A1. GOVERN function

- **GV-1.1 (legal/regulatory requirements understood) — Missing.** No framework mapping document, no policy register inside the system, no machine-readable conformance assertions. The 4-line `policyText` accepted by `policy-compiler` (`services/policy-compiler/src/index.ts:17-39`) is not a policy DSL and cannot encode regulatory requirements. **Process-only**, but the substrate has nowhere to attach machine-checkable rules.
- **GV-1.4 (risk-management process integrated into AI lifecycle) — Partial.** The mission lifecycle does encode a *governance pass* (`services/agent-os/src/index.ts:1208-1411`). However, the pipeline is sequential API calls, not a risk-management process: it has no risk classification step, no impact assessment, no severity scoring beyond `riskLevel: low|medium|high` (`shared/types/src/index.ts:271`), and no link from `riskLevel` to policy treatment beyond the witness-required toggle at `riskLevel === "high"` (`services/agent-os/src/index.ts:1485-1488`).
- **GV-3.2 (roles and responsibilities documented) — Missing in evidence.** RBAC roles `viewer/operator/admin` exist (`adapters/http-gateway/src/index.ts:22-33`) but the system stores no record of *who occupies which role*. The actor field on a ledger event is a free-form string supplied by the client (`adapters/http-gateway/src/index.ts:176-181`).
- **GV-4.1 (organizational practices for risk management decisions) — Missing.** No decision-log, no override registry, no minutes-of-decision artifact type. The `recovery-plan` artifact (`shared/types/src/index.ts:114-122`) is the closest but it's auto-synthesized from a counterfactual scenario, not a record of human deliberation.
- **GV-6.1 (third-party risks) — Missing.** No SBOM, no upstream-dependency tracking, no model-provenance store. `AgentCapability.model` and `provider` are free-text strings (`shared/types/src/index.ts:206-207`).

### A2. MAP function

- **MP-1.1 (context understanding) — Missing.** No place to store the deployment context (jurisdiction, target population, intended use). The `targetSystem` field on a mission is a free-text string (`shared/types/src/index.ts:273`).
- **MP-2.3 (system requirements documented) — Partial.** TypeScript interfaces in `shared/types/src/index.ts` are de facto requirements; Zod schemas in `shared/schemas/src/index.ts` give a partial JSON-schema export. There is no formal requirements specification mapped to controls.
- **MP-3.4 (potential negative impacts identified) — Missing.** No impact taxonomy, no severity matrix, no harm catalog.
- **MP-4.1 (risks/benefits mapped) — Partial.** `assessTaskGovernance` produces a `reasons[]` array on block (`services/agent-os/src/index.ts:1402-1410`). It captures the *why* of a single decision but does not aggregate into a system-level risk map.
- **MP-5.1 (likelihood/impact characterized) — Missing.** No frequency or severity scoring on outcomes.

### A3. MEASURE function

- **MS-1.1 (approaches and metrics identified) — Missing.** No metrics store, no telemetry beyond `simulation-engine`'s fake mesh load (`services/simulation-engine/src/index.ts:41-43`).
- **MS-2.7 (AI system security) — Partial.** Operator API key, optional signed sessions, optional RBAC (`adapters/http-gateway/src/index.ts:9-45, 553-623`). No service-to-service auth, no secrets management beyond env vars, no key rotation. Insufficient for "MS-2.7-001: Security controls evaluated continuously" — there is no such evaluator.
- **MS-2.10 (privacy) — Missing.** No PII tagging, no data-classification, no minimization tooling.
- **MS-2.11 (fairness/bias) — Missing.** No bias-testing surface.
- **MS-3.1 (responses to monitored events) — Partial.** The kill-switch (`services/governance-kernel/src/index.ts:53-70`, `services/execution-gate/src/index.ts:49-62`) is a coarse stop button, scoped to global/mission/domain/agent/device. No graduated response (degrade, throttle, redirect).
- **MS-4.2 (feedback solicited) — Missing.** No human-feedback surface for ratifying or contesting decisions.

### A4. MANAGE function

- **MN-1.2 (treatment of risks) — Missing.** No risk-treatment plan persisted; the `recovery-plan` artifact is per-counterfactual, not per-risk.
- **MN-2.2 (mechanisms in place to sustain value of AI systems) — Missing.** No model-drift detection, no recertification cadence.
- **MN-4.1 (post-deployment monitoring) — Partial.** Replay of events via `evidence-ledger /replay` (`services/evidence-ledger/src/index.ts:691-706`). No continuous monitoring metrics, no alerting, no anomaly detection.
- **MN-4.3 (incidents reported via established channels) — Missing.** No incident register, no NHTSA-style mandatory-reporting hooks, no NIST AI Incident Database integration.

### A5. Generative AI Profile (AI 600-1) cross-cuts

The Generative AI Profile adds 12 GAI risk categories. The codebase **does not address any of them as first-class concerns**. Specifically:
- **Confabulation (GV-1.3-001 / MG-1.3-001)** — no output factuality verification.
- **Information integrity (MG-2.2-002)** — output authenticity not signed at agent layer; only the mission-level audit event is signed by the ledger.
- **Information security (MS-2.7)** — partial; covered above.
- **Value chain (GV-6.1-001)** — no model-card, no training-data lineage, no `LineageCertificate` actually populated. The type exists (`shared/types/src/index.ts:84-91`) but no service produces it.
- **Human-AI configuration (GV-3.2)** — partial; RBAC but no human-in-loop / human-on-loop / human-out-of-loop classification per mission.

### A6. Met / Partial / Missing summary for AI RMF

- Met (substrate-level): GV-1.4 partial-only, MP-2.3 partial, MS-2.7 partial, MS-3.1 partial, MN-4.1 partial. **No category is fully met.**
- Strategic implication: This system is plausibly positionable as the *technical substrate underneath* an AI RMF program at an enterprise — but the program itself does not exist in code. Most of the AI RMF gap is process-and-documentation, not code.

---

## B. NIST SP 800-53 Rev. 5 — AU, AC, SI families

These are the controls that matter most for an "audit log + access control + integrity" claim. The codebase pitches itself heavily on the AU family.

### B1. Audit and Accountability (AU)

- **AU-2 (Event Logging) — Met.** Events are emitted (`services/agent-os/src/index.ts:316-331` for `commitLedgerEvent`, called from every state transition; the gateway calls `/events/commit` on operator actions e.g. `adapters/http-gateway/src/index.ts:828-936`). Coverage is broad: mission lifecycle, task lifecycle, tool actions, kill-switch, finality, reconciliation.
- **AU-3 (Content of Audit Records) — Partial.** Events carry `id, timestamp, actor, eventKind, payload, traceId, chainId` (`shared/types/src/index.ts:156-162`). Missing: outcome code (events use `eventKind` strings), source IP/host, session ID linking to the operator session token. Partial: `actor` is client-controlled (gateway hole #1, see Deliverable 1 §B10).
- **AU-3(1) (Additional Audit Information) — Missing.** No outcome code, no fingerprint of the calling entity beyond the unverified `actor` string.
- **AU-4 (Audit Log Storage Capacity) — Missing.** No capacity planning. The whole-file rewrite model (`services/evidence-ledger/src/index.ts:80-90`) means storage size grows linearly and is rewritten on every commit. At ~16 MB after a few demo runs, this is operationally unworkable past ~hundreds of MB. **Strategic priority: this is a hard scaling cliff.**
- **AU-6 (Audit Record Review, Analysis, Reporting) — Partial.** Replay query API (`services/evidence-ledger/src/index.ts:691-731`). No analytic tooling, no SIEM integration, no automated review.
- **AU-7 (Audit Reduction and Report Generation) — Missing.** No reporting layer beyond raw event dump.
- **AU-9 (Protection of Audit Information) — Missing.** This is the central control for evidentiary strength. AU-9 requires that audit information be protected from unauthorized access, modification, and deletion. Status:
  - **Access:** the ledger has no read auth at the service level; anyone reaching `evidence-ledger:7003` can read all events.
  - **Modification:** there is no append-only enforcement. The ledger is a JSON file rewritten on every commit (`services/evidence-ledger/src/index.ts:80-90`). An insider with file-system access can edit it freely. Per-artifact signatures attest individual artifacts but **no chain links them**, so deletions go undetected.
  - **Deletion:** same — file deletion silently re-initializes empty (`services/evidence-ledger/src/index.ts:109-114`).
  - **Net:** the codebase fails AU-9 against an insider, against a compromised host, and against a malicious operator.
- **AU-9(2) (Store on separate physical systems) — Missing.** Single host, single file. No replication.
- **AU-9(3) (Cryptographic protection) — Partial.** Per-artifact Ed25519 or HMAC signing (`services/evidence-ledger/src/index.ts:174-221`). **Misses the dominant requirement of AU-9(3): tamper-evident chaining**. NIST guidance for AU-9(3) explicitly contemplates Merkle trees / hash chains / write-once media; none present.
- **AU-9(4) (Access by Subset of Privileged Users) — Missing.** No separation: agent-os, the gateway, and any pod on the network all have full write access.
- **AU-10 (Non-Repudiation) — Missing.** Non-repudiation requires a *binding between an act and an authenticated identity*. The codebase binds an event to the *string* `actor: "client-supplied"`, signs that string into a chain-of-one, and calls it done. There is no client-side signing of the operator action, no PKI client cert, no signed delegation token from the operator to the gateway.
- **AU-11 (Audit Record Retention) — Missing.** No retention policy, no automatic archival, no expiration.
- **AU-12 (Audit Record Generation) — Met (mechanism).** The event-emission mechanism exists. The control is met at the substrate level if not at the policy level.

### B2. Access Control (AC)

- **AC-2 (Account Management) — Missing.** No account lifecycle. Sessions are stateless HMAC tokens (`adapters/http-gateway/src/index.ts:119-144`); there is no user store, no provisioning, no deprovisioning, no inactive-account expiry.
- **AC-3 (Access Enforcement) — Partial.** Gateway-level RBAC exists (`adapters/http-gateway/src/index.ts:580-622`). **No service-level enforcement.** Direct calls to `agent-os:7009/missions` skip RBAC.
- **AC-6 (Least Privilege) — Missing.** Three coarse roles. No object-level permissions, no per-mission ACLs, no per-service permission grants.
- **AC-7 (Unsuccessful Logon Attempts) — Missing.** No rate limiting, no lockout. Brute-force against `OPERATOR_API_KEY` is unmitigated at the gateway.
- **AC-17 (Remote Access) — Partial.** Bearer token over TLS *if TLS is terminated upstream* — the gateway listens HTTP. **[ASSUMPTION]** the docker-compose deployment does not include TLS termination; production deployments must add an upstream proxy (nginx, ingress) for AC-17 to apply meaningfully.

### B3. System and Information Integrity (SI)

- **SI-7 (Software, Firmware, and Information Integrity) — Missing.** No code-signing, no integrity check on the JS bundle served from `apps/console-ui/dist`, no detection of unauthorized changes to the running services.
- **SI-7(6) (Cryptographic Protection of Information) — Partial.** Same as AU-9(3): per-artifact signatures only.
- **SI-10 (Information Input Validation) — Partial.** Express body limit `2mb` (`services/governance-kernel/src/lib.ts:14`). Type assertions like `req.body as Partial<AuthorityEnvelope>` (`services/governance-kernel/src/index.ts:72`) are **TypeScript casts, not runtime validation**. Zod schemas exist in `shared/schemas/src/index.ts` but **are not wired into any service's request handlers**. A malformed payload can populate `Map`s with garbage.
- **SI-11 (Error Handling) — Partial.** `handleAsync` converts upstream failures to 502 (`adapters/http-gateway/src/index.ts:146-155`). Most service-level handlers swallow errors silently (`services/agent-os/src/index.ts:329-330`, `services/evidence-ledger/src/index.ts:86-88`). Errors are logged to stdout, not to a structured channel.

### B4. Met / Partial / Missing summary for SP 800-53

- AU-2: Met (substrate). AU-3: Partial. AU-9: **Missing — central failure**. AU-9(3): Partial (per-artifact only). AU-10 (non-repudiation): **Missing — central failure**. AC-3: Partial (gateway-only). AC-6, AC-7: Missing. SI-7, SI-10: Missing/Partial.
- Strategic implication: **AU-9 and AU-10 are the controls a regulator will look for first**, and the codebase fails them in the strongest sense (single-node single-file with no chain). These are also Tier-1 fixable (see Deliverable 4).

---

## C. ISO/IEC 42001:2023 — AI Management Systems

ISO 42001 is an ISMS-style management standard for AI. Annex A controls A.2–A.10 are largely organizational (policies, governance committees, supplier management). The technical substrate the codebase would have to provide:

- **A.6.2 (AI system requirements specification) — Partial.** The TS interfaces `AgentCapability`, `OperatingMission`, `ExecutionTask`, etc. (`shared/types/src/index.ts:201-345`) act as the *implicit* requirement spec for governed entities. There is no separate machine-readable requirements document.
- **A.6.2.4 (Verification and validation of AI systems) — Missing.** No V&V layer; the system validates *operator actions* through a governance pipeline, not the agents themselves.
- **A.6.2.5 (Deployment of AI systems) — Partial.** Workspace lifecycle (`services/agent-os/src/index.ts:2728-2746`), deployable profiles in the gateway (`adapters/http-gateway/src/index.ts:417-499`). No promotion controls, no canary, no rollback (the `enterprise:restore` script is whole-state restore, not surgical).
- **A.6.2.6 (Operation and monitoring of AI systems) — Partial.** Same comments as MS-3.1 above.
- **A.6.2.7 (AI system technical documentation) — Missing.** README and architecture.md exist as project documentation; no per-AI-system technical file.
- **A.6.2.8 (Recording of AI system event logs) — Met (substrate)**, with the AU-9 caveat from §B1.
- **A.7 (Data for AI systems) — Missing.** No data lineage (`LineageCertificate` type defined `shared/types/src/index.ts:84-91` but never instantiated), no training-data inventory, no data-quality controls.
- **A.8 (Information for interested parties) — Missing.** No external-facing transparency artifacts.
- **A.9.3 (Use of AI systems) — Partial.** Tool-action governance (`services/agent-os/src/index.ts:996-1206`) is the closest analogue to "intended use enforcement." Limited by the destructive-action regex weakness (Deliverable 1 §B9).
- **A.10 (Third-party and customer relationships) — Missing.** No supplier/model registry, no evidence sharing across organizations.

### Met / Partial / Missing summary for ISO 42001

- Met (substrate-level): A.6.2.8.
- Partial: A.6.2, A.6.2.5, A.6.2.6, A.9.3.
- Missing: A.6.2.4, A.6.2.7, A.7, A.8, A.10, plus all of A.2–A.5 (process).
- Strategic implication: Becoming "the substrate underneath an ISO 42001 ISMS" is plausible *if* A.6.2.8 (event logs) hardens against AU-9. Without that, the ISMS cannot stand on this substrate.

---

## D. ISO/IEC 27001:2022 — Evidence Integrity controls

Most relevant Annex A controls (2022 revision):

- **A.5.28 (Collection of evidence) — Partial.** The system collects evidence (events). It does not preserve evidence in a *forensically defensible* manner. ISO 27037:2012 (referenced from A.5.28) requires DEFR — Digital Evidence First Responder — chain-of-custody documentation. Status:
  - Identification: events have `id`, `traceId` (yes).
  - Collection: passive, not deliberate (the system writes its own events).
  - Acquisition: backup script `scripts/backup-governance-state.mjs:44-47` produces SHA-256 of the file at copy time and stores in `manifest.json`. **The manifest is not signed, not externally anchored, and is co-located with the data it covers.** An attacker who replaces the data file can also replace the manifest.
  - Preservation: whole-file rewrites destroy the prior state.
  - **Net:** preservation chain is broken at multiple links.
- **A.8.15 (Logging) — Met (substrate)**, with AU-9 caveat.
- **A.8.16 (Monitoring activities) — Partial.** Replay query exists; no continuous monitoring.
- **A.8.34 (Protection of information systems during audit testing) — Process.** Out of scope for codebase.
- **A.5.33 (Protection of records) — Missing.** Same as AU-9.
- **A.8.10 (Information deletion) — Missing.** No retention/deletion policy, no certified deletion mechanism.

### Met / Partial / Missing summary for ISO 27001

- Met: A.8.15 (substrate).
- Partial: A.5.28, A.8.16.
- Missing: A.5.33, A.8.10.
- Strategic implication: A.5.28 is the bridge to legal admissibility. Closing it is in scope for Deliverable 4 Tier 1.

---

## E. FAA UAS — Part 107, Part 89 (Remote ID), anticipated Part 108 (BVLOS)

The codebase markets itself for aerial drones (`adapters/http-gateway/src/index.ts:436-444`, the `drones` deployable profile). Mapping to FAA regs:

- **14 CFR Part 107 (Small UAS) — Not addressed.** Operator certification, registration of aircraft, operational limits (visual line of sight, altitude, daylight). The codebase has no registration store for UAS aircraft, no operator-credential check, no airspace-class lookup, no flight-plan envelope. The "drones" deployable profile is a UI label and a 7-line metadata block (`adapters/http-gateway/src/index.ts:436-444`).
- **14 CFR Part 89 (Remote ID) — Missing.** Effective March 2024. Requires UAS to broadcast identification and location (Standard Remote ID) or operate from FAA Recognized Identification Areas. The codebase emits a `device-fingerprint` (`services/agent-os/src/index.ts:155`) but it is a string of `devicefp-<workspace-id>` derived from the workspace ID — not an FAA Remote ID, not broadcast, not aviation-format (e.g., ANSI/CTA-2063 serial number).
- **Anticipated Part 108 (BVLOS, NPRM) — Missing in concept.** [ASSUMPTION] The proposed Part 108 framework contemplates risk-based ops with type certification of aircraft, required Detect-And-Avoid (DAA), automated Command-and-Control (C2) link standards, and third-party services for traffic management (UTM). The codebase's "execution-gate" is *not* an aviation-grade DAA system; it has no airspace deconfliction, no traffic awareness, no link-quality monitoring. The "kill-switch" is a software flag, not a return-to-launch command nor a flight-termination system.
- **UTM (UAS Traffic Management) integration — Missing.** No interface to the FAA UAS Service Supplier (USS) ecosystem, no telemetry conformance to ASTM F3548-21.

### Strategic position for UAS

The system is **not currently positionable** as the substrate for a Part 108 BVLOS deployment. It could be positioned as a *Tier-2 audit/insurance overlay* — recording governance decisions about flight authorization that happen *elsewhere* — but it cannot itself authorize flight, deconflict airspace, or carry safety-of-life signals. **For credibility with the FAA, the project would need either (a) explicit scoping that excludes safety-critical flight functions and positions itself as evidence-of-decisions only, or (b) a multi-year SoftwareConsiderations-in-Airborne-Systems (DO-178C) / DO-326A trajectory which is incompatible with the current implementation.**

---

## F. NHTSA AV framework + state-level (Montana, Arizona, California)

The codebase markets itself for ground vehicles (`adapters/http-gateway/src/index.ts:428-435`).

### F1. NHTSA federal layer

- **NHTSA Standing General Order 2021-01 (crash reporting for SAE Levels 2-5) — Not addressed substrate-wise.** SGO 2021-01 requires manufacturers to report crashes within 24h (initial) / 10 days (updated) for ADS and Level 2 ADAS. The codebase has no crash event type, no SGO-format reporting interface, no time-to-report tracking. The closest analog is `agent-os.execution.task.halted` (`services/agent-os/src/index.ts:2382-2387`), which is generic.
- **AV TEST Initiative — Process-only.** Voluntary public reporting; no codebase relevance.
- **FMVSS amendments for ADS-equipped vehicles — Missing.** [ASSUMPTION] Not technically in scope for a governance OS, but a positioning claim of "registration substrate" implies VIN / make / model / ADS-version registry — which the codebase lacks (no `Vehicle` artifact type in `shared/types/src/index.ts`).

### F2. California (13 CCR Article 3.7 / 3.8)

California has the most prescriptive state AV rules:

- **§ 227.18 — Manufacturer's Permit application content — Missing.** Requires evidence of insurance ($5M), driver/operator training, vehicle test reports. Codebase has no insurance binding, no training records, no test artifact.
- **§ 227.40 — Reporting of disengagements (annual) — Missing.** Requires monthly/annual disengagement and mileage reporting in DMV-specified format. Codebase emits `agent-os.execution.task.halted` events but not in DMV format, with no per-vehicle aggregation, no disengagement type taxonomy.
- **§ 227.46 — Reporting of collisions — Missing.** Closely tied to NHTSA SGO 2021-01.
- **§ 227.50 — Driverless deployment permit — Missing.** Pre-deployment evidence requirements include cybersecurity attestation, ODD specification, VRU detection performance. Codebase has no ODD model, no VRU concept.
- **CCPA/CPRA cross-cuts (per-passenger data) — Missing.** No PII tagging, no data-subject-request mechanism.

### F3. Arizona (EO 2018-04 / ARS § 28-9701 et seq.)

Arizona is permissive but requires:
- Self-certification that the AV complies with FMVSS — **process-only**, codebase irrelevant.
- Insurance proof — **missing substrate**: no insurance-binding artifact in code.
- Law-enforcement interaction protocol — **missing**: no LE-handoff event type.

### F4. Montana

[ASSUMPTION] Montana has comparatively limited AV-specific statutes; testing is largely under general motor-vehicle law. For positioning purposes the comparison point is "state with low statutory friction" — the codebase's gap there is the same as elsewhere: no VIN-level registry, no insurance-binding artifact.

### Strategic position for AV

The codebase is **not currently positionable** as a "registration substrate for autonomous vehicles" against the California rule set. It is **plausibly positionable for Arizona/Montana-style permissive deployments** as a decision-evidence layer, but only if augmented with: a `Vehicle` artifact type, a `Disengagement` event type, an `Insurance` artifact type, and machine-readable schemas for DMV-format disengagement and collision reporting. None of these exist today.

---

## G. EU AI Act — Conformity Assessment for High-Risk Systems

EU AI Act (Regulation (EU) 2024/1689). High-risk AI systems (Annex III) face a conformity-assessment regime. Mapping articles:

- **Article 9 (Risk Management System) — Missing.** "Establish, implement, document and maintain a risk management system… continuous iterative process." Codebase has no risk-register, no iterative process layer.
- **Article 10 (Data and data governance) — Missing.** Training/validation/testing data quality criteria, documentation. The codebase governs *agent decisions*, not data.
- **Article 11 (Technical documentation, Annex IV) — Missing.** Annex IV requires a long list: general description, system architecture, training/testing dataset specs, validation/testing procedures, risk management documentation, human oversight measures, lifecycle changes. Codebase produces none of this in machine-readable form. README and architecture.md are too informal to qualify.
- **Article 12 (Record-keeping / Logging) — Partial.** Article 12(1): high-risk systems "shall technically allow for the automatic recording of events ('logs') over the lifetime of the system." Article 12(2): logs "shall ensure a level of traceability of the AI system's functioning… appropriate to the intended purpose." The codebase emits events (Met). But Article 12(3) requires logs to enable monitoring of operations causing risk → the gap mirrors AU-9: tamper-evidence is not technically guaranteed. **Partial.**
- **Article 13 (Transparency / Provision of information to deployers) — Missing.** Instructions for use, intended purpose, accuracy/robustness specs, computational/hardware resource needs.
- **Article 14 (Human oversight) — Partial.** Human-on-loop is contemplated via the operator console. No machine-readable encoding of "the system shall not act without operator confirmation in conditions X." Closest analogue is the destructive-action regex (`services/agent-os/src/index.ts:711-725`) — too brittle to qualify.
- **Article 15 (Accuracy, robustness, cybersecurity) — Missing.** No accuracy claims, no robustness testing, no adversarial-robustness evaluation. Cybersecurity is partially addressed via gateway auth but not at service-to-service.
- **Article 17 (Quality management system) — Process. Partial substrate.** A QMS would attach to the technical substrate via the event log; same partial status as Article 12.
- **Article 43 (Conformity assessment procedures) — Missing.** No CE-marking artifact, no Notified Body interface, no machine-readable assertion that the system has passed Annex VI (internal control) or Annex VII (third-party audit) procedures.
- **Article 49 (Registration in EU database for high-risk AI) — Missing.** No registration claim, no EU database integration, no `EUDeclarationOfConformity` artifact.
- **Article 72 (Post-market monitoring) — Partial.** Replay and counterfactual exist. No structured post-market plan.

### Strategic position for EU AI Act

The codebase as it stands does not satisfy any single Article fully, but **the *substrate* it provides is closer to Article 12 (logging) and Article 14 (human oversight) than to Articles 9/10/11/15**. With the AU-9 gap closed, Article 12 substrate is achievable. Article 11 (technical documentation) is the largest gap and largely process-driven. **Realistic positioning: "Article 12-class logging substrate" claim is defensible after Tier-1 hardening; "high-risk AI Act-conformant system" claim is years away.**

---

## H. Insurance-grade evidence — the reinsurer's actuarial bar

This is the most strategic question for the user's positioning. A reinsurer pricing a novel autonomous-systems risk class needs:

### H1. Telemetry integrity

- **Required:** Events recorded at the source, signed by the source's key, time-stamped against an external trusted timestamp (RFC 3161 TSA or equivalent), with provable ordering.
- **Status:** Events are recorded by `agent-os` (a single trusted process), signed by the *evidence-ledger* (also a single trusted process, downstream of agent-os), time-stamped against the local Node clock (`services/governance-kernel/src/lib.ts:18`), and ordered by insertion into a JSON array. **Missing.**

### H2. Tamper-evidence

- **Required:** Append-only or write-once storage; hash-chain or Merkle-tree over the log; periodic anchoring to a public chain (e.g., a transparency log à la Certificate Transparency, or hash anchored to a public blockchain).
- **Status:** Whole-file JSON rewrites (`services/evidence-ledger/src/index.ts:80-90`); per-artifact signature only; no chain; no external anchor. **Missing.**

### H3. Third-party attestation

- **Required:** SOC 2 Type II report on the controls; ISO 27001 certification; for the cryptographic claims, an independent cryptographic review (often by a CC-EAL or FIPS lab); for the AI-specific layer, ISO 42001 certification and/or third-party penetration testing.
- **Status:** None. The project is an enterprise-package zip without organizational certification. **Missing.**

### H4. Replayability

- **Required:** Given the audit trail, a third party should be able to replay events to a deterministic state and verify each decision was admissible under the policy that applied at the time-of-event (versioned).
- **Status:** Replay exists (`services/evidence-ledger/src/index.ts:691-706`). **Policy versioning is absent** — `policyCompileCache` (`services/agent-os/src/index.ts:161`) is keyed by content but never versioned to time. A change to mission policy text changes the compileId without invalidating prior commits. **Partial.**

### H5. Insurable interest definition

- **Required:** The artifact set has to map to definable insurable events: "X was governed under policy Y at time T; loss event Z occurred; was Z covered?" This requires a *peril taxonomy* the codebase produces.
- **Status:** No peril taxonomy. `assurance-attestation` (`shared/types/src/index.ts:144-154`) is the closest, with `systemPosture: insurable | conditional | halted`, but the determination is a count-based heuristic in the gateway (Deliverable 1 §B10). **Missing.**

### H6. Loss-cost data and exposure

- **Required:** Frequency × severity distributions per peril per deployable class. Multiple years of loss data (or a defensible analog).
- **Status:** None — this is a green-field project. A reinsurer pricing this would require either ceded-risk treaties from primary carriers, or 3-5 years of loss-cost emergence. **[ASSUMPTION]** The user is aware of this; it cannot be solved in code.

### H7. Subrogation discovery readiness

- **Required:** When the insurer pays a claim and seeks subrogation against the responsible party, discovery from the codebase must produce events that an opposing counsel cannot credibly call into question. That bar is the Federal Rules of Evidence 901/902/803(6) discussed in Deliverable 3.
- **Status:** **Insufficient** — see Deliverable 3.

### Summary: insurance bar

The codebase is currently **not insurable as a primary risk substrate**. It is plausibly insurable as a **process-evidence layer behind a higher-trust system** (a reinsurer would treat it as one of several evidence sources, not as the sole authoritative log). The transition path requires hardening telemetry integrity (H1), tamper-evidence (H2), and replayability with policy versioning (H4) — each maps to specific code changes (Deliverable 4 Tier 1).

---

## I. Conformance Matrix — executive summary

Status legend: **Met (substrate)** = code provides what code can; **Partial** = mechanism exists with material gaps; **Missing** = nothing material in code; **Process** = framework requires organizational artifacts that no codebase can satisfy alone. Effort: **S** ≤ 1-2 weeks; **M** = 1-3 months; **L** = 3-12 months. Priority: **1** = required for credibility with policy/insurance audiences; **2** = required for first regulated deployment; **3** = required for standard-setting position.

| Requirement | Status | Code reference / gap | Effort | Priority |
|---|---|---|---|---|
| **NIST AI RMF — GOVERN** |  |  |  |  |
| GV-1.1 legal/reg requirements understood | Missing | No machine-readable conformance assertions; `policy-compiler` is a stub | M | 2 |
| GV-1.4 risk-mgmt integrated into lifecycle | Partial | `services/agent-os/src/index.ts:1208-1411` is sequential check, not iterative risk treatment | M | 2 |
| GV-3.2 roles/responsibilities | Partial | Three-role RBAC at gateway only; no service-level or object-level | M | 1 |
| GV-4.1 organizational decision practices | Missing | No decision-log artifact type | S | 3 |
| GV-6.1 third-party / value-chain | Missing | No SBOM, no model-provenance, `LineageCertificate` defined but unused | M | 2 |
| **NIST AI RMF — MAP/MEASURE/MANAGE** |  |  |  |  |
| MP-4.1 risks/benefits mapped | Partial | `reasons[]` per decision; no system-level aggregation | S | 3 |
| MS-2.7 AI system security | Partial | Gateway auth only; no service-to-service auth; no continuous evaluation | M | 1 |
| MS-3.1 graduated response to monitored events | Partial | Kill-switch is binary per scope; no degrade/throttle | M | 2 |
| MN-4.1 post-deployment monitoring | Partial | Replay exists; no monitoring metrics or alerting | M | 2 |
| MN-4.3 incident reporting | Missing | No incident register, no NHTSA/AI-Incident-DB hooks | S | 2 |
| GAI-Profile (all 12 risk categories) | Missing | None addressed as first-class concern | L | 3 |
| **SP 800-53 AU family** |  |  |  |  |
| AU-2 event logging | Met (substrate) | `commitLedgerEvent` everywhere | — | — |
| AU-3 content of records | Partial | `actor` is client-controlled at gateway | S | 1 |
| AU-4 storage capacity | Missing | Whole-file rewrite; hard ceiling at ~hundreds of MB | M | 1 |
| AU-9 protection of audit information | **Missing — central** | Single JSON file, no append-only, no chain | M-L | **1** |
| AU-9(2) separate physical systems | Missing | Single host | M | 1 |
| AU-9(3) cryptographic protection | Partial | Per-artifact signature; no chain | M | **1** |
| AU-10 non-repudiation | **Missing — central** | No client-signed operator actions | M | **1** |
| AU-11 retention | Missing | No retention/archival policy | S | 2 |
| **SP 800-53 AC family** |  |  |  |  |
| AC-2 account mgmt | Missing | No account lifecycle, no user store | M | 2 |
| AC-3 access enforcement | Partial | Gateway-only, services unauth | M | **1** |
| AC-6 least privilege | Missing | Coarse roles only | M | 2 |
| AC-7 unsuccessful logon attempts | Missing | No rate-limit / lockout | S | 1 |
| **SP 800-53 SI family** |  |  |  |  |
| SI-7 software/info integrity | Missing | No code-signing, no runtime integrity check | M | 2 |
| SI-10 input validation | Partial | TS casts, not runtime; Zod schemas exist but unwired | S | 1 |
| **ISO 42001** |  |  |  |  |
| A.6.2.4 V&V of AI systems | Missing | No V&V layer | L | 3 |
| A.6.2.7 technical documentation | Missing | No machine-readable technical file per AI system | M | 2 |
| A.6.2.8 event logs | Met (substrate) | With AU-9 caveat | — | — |
| A.7 data-for-AI controls | Missing | No data-lineage; `LineageCertificate` unused | L | 3 |
| **ISO 27001** |  |  |  |  |
| A.5.28 collection of evidence | Partial | Backup manifest is unsigned and co-located | S-M | **1** |
| A.5.33 protection of records | Missing | Same as AU-9 | M | **1** |
| A.8.10 information deletion | Missing | No retention/deletion policy | S | 2 |
| **FAA** |  |  |  |  |
| Part 107 operator certification | Missing | No certificate registry | M | 2 |
| Part 89 Remote ID | Missing | `device-fingerprint` is not aviation-format | M | 2 |
| Part 108 BVLOS DAA / C2 | Missing | Not safety-critical software; no aviation V&V trajectory | L | 3 |
| UTM / ASTM F3548-21 | Missing | No USS interface | L | 3 |
| **NHTSA / states** |  |  |  |  |
| NHTSA SGO 2021-01 crash reporting | Missing | No crash event type, no SGO-format reporter | S-M | 1 |
| CA 13 CCR § 227.40 disengagement reporting | Missing | No DMV-format aggregator | M | 2 |
| CA 13 CCR § 227.50 deployment permit substrate | Missing | No ODD/VRU model | L | 3 |
| AZ ARS § 28-9701 (insurance attestation) | Missing | No insurance-binding artifact | S | 2 |
| **EU AI Act** |  |  |  |  |
| Art. 9 risk-management system | Missing | No risk register; iterative process layer absent | M | 2 |
| Art. 10 data governance | Missing | Codebase governs decisions, not data | L | 3 |
| Art. 11 technical documentation (Annex IV) | Missing | No machine-readable Annex IV | M | 2 |
| Art. 12 record-keeping / logging | Partial | Substrate present; AU-9 gap blocks Art. 12(3) | M | **1** |
| Art. 14 human oversight | Partial | Console + RBAC; no machine-readable oversight rules | M | 2 |
| Art. 15 accuracy/robustness/cybersecurity | Missing | No robustness testing | M | 2 |
| Art. 17 quality management system | Process / Partial | Substrate dependent on Art. 12 | — | 2 |
| Art. 43 conformity assessment | Missing | No CE-marking artifact, no Notified Body interface | L | 3 |
| Art. 49 EU database registration | Missing | No registration claim | S | 3 |
| **Insurance-grade** |  |  |  |  |
| H1 telemetry integrity (TSA, signed-at-source) | Missing | Single signing at ledger, local clock | M | **1** |
| H2 tamper-evidence (chain, anchor) | Missing | No hash chain, no public anchor | M | **1** |
| H3 third-party attestation (SOC 2 / ISO certs) | Missing | Process | L | **1** |
| H4 replayability with policy versioning | Partial | Replay yes, policy version no | S-M | 2 |
| H5 insurable interest / peril taxonomy | Missing | `assurance-attestation` is heuristic | M | 2 |
| H7 subrogation discovery | **Insufficient — see D3** | FRE 901/902/803(6) bar | M-L | **1** |

---

## J. Strategic priorities surfaced by this matrix

Five gaps are tagged **Priority 1** (regulatory/insurance credibility floor):

1. **AU-9 / A.5.33 / A.5.28 / Art. 12(3) / H2 — tamper-evident audit log.** This is the *single most consequential gap*. The fix is well-defined: append-only log, per-event hash chain (each event references the prior event's hash), per-event signature, periodic Merkle root anchored externally. Effort: **M** (1-3 months for a defensible implementation; **L** if multi-party signing is included). Without this, no other compliance claim survives a serious audit.
2. **AU-10 / H1 / FRE 902(11)-(13) — non-repudiation at the operator boundary.** Operator actions must be signed *by the operator's key*, not just authenticated by an HMAC session. This requires a client-side signing key (browser-side WebCrypto, hardware token, or federated identity with signed assertion). Effort: **M**. Closes the "actor is a client-controlled string" hole.
3. **AC-3 service-to-service — close the docker-network trust boundary.** Either mTLS between services or a shared-secret hop-by-hop signature on inter-service requests. Effort: **M**. Without this, the gateway is a polite suggestion, not a control.
4. **MS-2.7 / SI-10 — wire Zod schemas into all request handlers + add rate-limit at the gateway.** Effort: **S**. Cheap, high-impact.
5. **H3 — third-party attestation readiness.** Get SOC 2 Type II readiness assessment and ISO 27001 readiness. Effort: **L**, but the prerequisite work (1) and (2) above must precede.

The remaining Priority-2 items map to "first regulated deployment" and Priority-3 items to "standard-setting." Both are detailed in Deliverable 4.

**One non-obvious cross-cut:** the codebase has a pattern of *defining an artifact type, never instantiating it*: `LineageCertificate` (`shared/types/src/index.ts:84-91`) is a representative case. This is a gift for positioning — the schema commitment is already made; only the producer needs to be added. A `RegistrationCertificate`, `InsuranceBinding`, `Disengagement`, `CrashReport` would slot into the existing artifact-discovery pattern in evidence-ledger. **Each represents a one-week increment with outsized regulatory mileage.**

---

**Deliverable 2 reviewed and approved. Deliverable 3 begins below.**

---

# DELIVERABLE 3 — ADVERSARY MODEL & TRUST ANALYSIS

This is the threat model the codebase **implies** by its design but does not state explicitly. It walks the trust boundaries, names the implicit Trusted Computing Base (TCB), enumerates six adversary classes the system will face if it ever positions as a regulatory/insurance substrate, and ends with a focused analysis of evidentiary admissibility.

The codebase contains zero documents named "threat-model," "STRIDE-analysis," or "trust-boundary." Architecture and README describe the *governance flow* but not the *attacker*. Everything below is reverse-engineered from the implementation.

---

## A. Trust boundaries

A trust boundary is a place where data crosses from one trust principal to another. The codebase has nine of them. I label each with whether it is enforced.

### A1. External operator → http-gateway (the front door)
- **Crossed by:** browser-bundled JS, validate-core scripts, third-party tooling.
- **Enforcement:** API key bearer token, optional signed session, optional RBAC (`adapters/http-gateway/src/index.ts:553-623`). HMAC signature on session token (line 119-144).
- **Status:** **Partially enforced.** Holes documented in Deliverable 1 §B10:
  1. `actor` is a free-form header/body string (line 176-181) — authenticated bearer can claim any actor identity unless an explicit allowlist is configured.
  2. `VITE_OPERATOR_API_KEY` ships to browsers when set (`apps/console-ui/src/gateway-client.ts:3-4`).
  3. No rate-limit, no lockout, no anomaly detection.
  4. Authority-router omitted from `/health` (line 628-637) — gateway can report ok while core dependency is down.

### A2. http-gateway → governance-kernel / policy-compiler / evidence-ledger / meta-authority-registry / simulation-engine / authority-router / witness-service / execution-gate / agent-os
- **Crossed by:** the gateway's `call()` helper (`adapters/http-gateway/src/index.ts:94-107`), which is bare `fetch()`.
- **Enforcement:** **None.** No mTLS, no shared secret, no signed payload. Authority is "the request reached this port from the docker network."
- **Status:** **Unenforced.**

### A3. agent-os → governance-kernel / policy-compiler / evidence-ledger / authority-router / simulation-engine / witness-service / execution-gate
- **Crossed by:** `services/agent-os/src/index.ts:316-331` (`commitLedgerEvent`), `services/agent-os/src/index.ts:447` (kernel `/validate-envelope`), and ~20 other inline `fetch()` calls.
- **Enforcement:** **None.** Same as A2.
- **Status:** **Unenforced.** This is the most important unenforced boundary because agent-os's outbound calls *constitute the audit trail*; impersonating agent-os is impersonating the system's claim about itself.

### A4. governance-kernel → meta-authority-registry
- **Crossed by:** `services/governance-kernel/src/index.ts:73-77` (envelope validation).
- **Enforcement:** **None**, plus **fail-open**: on fetch error, kernel locally fabricates a `{ allowed: true }` response (line 77).
- **Status:** **Unenforced and fail-open.** A network partition causes the kernel to manufacture admissibility.

### A5. Worker agent → agent-os (task claim, heartbeat, complete, tool-action)
- **Crossed by:** `POST /tasks/:taskId/claim`, `/heartbeat`, `/complete`, `/actions`, `/actions/:actionId/execute` (`services/agent-os/src/index.ts:2455-2702`).
- **Enforcement:** **Caller asserts `agentId` in the request body** (line 2462, 2514, 2637, 2654). Once a task is claimed, subsequent calls require the same `claimedBy` (line 2515-2517, 2638-2640, 2655-2657) — string equality check only.
- **Status:** **Unenforced cryptographically.** Any caller who knows the `agentId` (which is enumerable via `GET /state`) can claim a task. The `claimedBy` string check is not a possession-of-key proof.

### A6. evidence-ledger.process → ledger.json (filesystem)
- **Crossed by:** `writeFile` and `readFile` on `EVIDENCE_LEDGER_STATE_PATH` (`services/evidence-ledger/src/index.ts:84, 94`).
- **Enforcement:** **None at the application layer.** Whatever filesystem ACLs the host imposes are the only protection.
- **Status:** **Unenforced.** Any process with file-write permission can rewrite the ledger.

### A7. agent-os.process → agent-os.json (filesystem)
- Same pattern as A6 (`services/agent-os/src/index.ts:231, 241`).
- **Status:** **Unenforced.**

### A8. Backup snapshot → restore process
- **Crossed by:** `scripts/backup-governance-state.mjs:84-90` (writes manifest with sha256), `scripts/restore-governance-state.mjs:89-105` (verifies).
- **Enforcement:** SHA-256 file digests in `manifest.json`. **The manifest is unsigned and stored alongside the data.** A tamperer who replaces the data file can also replace the manifest.
- **Status:** **Effectively unenforced** against an attacker with directory-level write.

### A9. Browser console-ui → http-gateway (returning user)
- **Crossed by:** `apps/console-ui/src/gateway-client.ts` calls.
- **Enforcement:** Same as A1. Plus: the browser does **no signature verification** on artifacts it receives — it renders `verification.status` as truth (Grep: `apps/console-ui/src/gateway-client.ts` returns no match for `verify`/`signature`/`digest` outside type definitions).
- **Status:** **Trust the gateway**, but the browser cannot independently verify ledger artifacts even when they are signed.

### Summary of boundary enforcement

Of nine trust boundaries, **only A1 (external operator → gateway) is enforced**, and that enforcement has documented holes. The other eight boundaries are unenforced or only enforced by string equality. The system's security posture rests on **one** boundary check, and the rest of the architecture assumes a flat trusted network.

---

## B. The implicit Trusted Computing Base (TCB)

The TCB is the set of components which, if compromised, break the system's security claims. By inspection of the code, this codebase's TCB is:

1. **The host running evidence-ledger** — ledger key material lives on disk (`services/evidence-ledger/src/index.ts:57-59`); the JSON state lives on disk; the process is the only signer.
2. **The host running agent-os** — produces the events; if compromised, can write any history into the ledger via `commitLedgerEvent` (`services/agent-os/src/index.ts:316-331`). The ledger has no way to reject agent-os's claim.
3. **The host running the http-gateway** — produces operator-action events; controls what `actor` field gets sent to the ledger. If compromised, can attribute any action to any operator.
4. **The host running governance-kernel** — issues envelopes and warrants. Compromise lets the attacker manufacture authority for arbitrary operations. The kernel's silent fail-open (A4) means a *partial* kernel compromise (or just network isolation of the registry) is enough.
5. **The Docker host / Kubernetes node** — the network on which all the above run. With unenforced inter-service auth, anyone on this network is implicitly part of the TCB.
6. **The host running meta-authority-registry** — the seed authorities are bootstrapped at process start (`services/meta-authority-registry/src/index.ts:8-65`); the registry accepts new "root-class" authorities from any caller (`services/meta-authority-registry/src/index.ts:74-91`). Compromise of the registry redefines "who can delegate."
7. **The signing key file(s)** — `EVIDENCE_LEDGER_SIGNING_PRIVATE_KEY_PATH` and `OPERATOR_SESSION_SECRET`. No HSM, no KMS, no rotation.
8. **The build/release pipeline** — there is no SBOM, no signed releases, no reproducible builds. The npm/pnpm dependency graph is implicit TCB.
9. **The 16.7 MB ledger.json file in the workspace** — see A6.

**TCB size is the main story.** A regulatory-grade audit substrate aims for a *small, well-defined TCB* (HSM + verified appliance + read-only audit replicas). This system's TCB is essentially **the entire docker compose stack plus its host**. A regulator's "what must I trust to believe this audit log?" question has a four-figure answer here.

---

## C. Adversary classes — what is defended, what is claimed-but-not-defended, what is unaddressed

For each adversary I identify (1) capability assumed, (2) what the codebase *defends*, (3) what the README *claims* to defend but the code does not, (4) what is genuinely *unaddressed*.

### C1. Compromised agent (rogue or hijacked AI worker)

- **Capability:** Has a valid `agentId`, can call `/tasks/:taskId/claim`, `/heartbeat`, `/complete`, `/actions`. Can submit arbitrary `output` and `executionResult` payloads. Has read access to the gateway's `/operator/os/state`.
- **Defends:**
  - Tool-action governance pre-approves tool ID matches required-tools (`services/agent-os/src/index.ts:1007-1009`) and active leases (line 1011).
  - The destructive-action regex (line 711-725) blocks the most obvious shell verbs.
  - Heartbeat-stale reconciliation re-queues tasks the agent goes silent on (line 2201-2213).
  - High-risk completions go through witness-service before finality (`services/agent-os/src/index.ts:1485-1521`).
- **Claims-but-doesn't:** README says "trust tier" governs sandboxed/delegated/privileged behavior (`shared/types/src/index.ts:213`). In code, `trustTier` is referenced only at `services/agent-os/src/index.ts:1248-1249` (high-risk + sandboxed → block dispatch). It does not gate tool actions, does not gate per-call privileges, does not constrain output content.
- **Unaddressed:**
  1. **Output authenticity.** A compromised agent can post any `executionResult` and any `output.summary` (`services/agent-os/src/index.ts:2664-2669`). The completion is recorded as success. There is no agent-side signing of the output and no cross-check.
  2. **Identity binding.** The `agentId` is a string the agent knows; `identityFingerprint` (line 87, 103, 119) is auto-generated by agent-os from the agent ID — not derived from a key the agent possesses (`services/agent-os/src/index.ts:133-134`). A compromised agent can also impersonate a different `agentId` on direct service-port calls.
  3. **Destructive-action bypass.** The regex (line 711-725) is text-matching on the payload string; trivially evaded by encoding (`'r'+'m'`, base64, here-doc, indirect command construction).
  4. **Tool-action proposal/execute split is bypassable.** A hijacked agent can propose a benign action (regex passes), get approval (line 2520-2538), then submit a malicious `executionResult` against a `tool action: "executed"` event without the gate re-validating the *content* (line 2601-2613). The gate validated the *intent*, not the actual operation.

### C2. Malicious operator with shell access

- **Capability:** Has root (or equivalent) on the host running any service. Can read/write ledger.json and agent-os.json directly. Can read environment variables (incl. signing keys). Can attach a debugger to any process.
- **Defends:** None at the application layer. The defense is filesystem ACLs the host enforces.
- **Claims-but-doesn't:** README implies "immutable evidence" (PACKAGE_README.txt:13, README:108 "asymmetric Ed25519 signing", architecture.md "constitutional pre-execution governance"). The signature is over the ledger's view; with root, the operator can:
  1. Edit `evidence-ledger.json` to remove or rewrite events (the file is human-readable JSON, line-based).
  2. Re-sign the modified events (the private key is on disk, line 57-59).
  3. Restart the ledger; on boot it will re-ingest the modified state and *its own signatures will verify* because the operator re-signed.
  4. There is no second key, no quorum, no anchor.
- **Unaddressed:**
  - **Single-key rewrite is undetectable** without an external anchor.
  - **Backup tampering** — the backup manifest is unsigned (`scripts/backup-governance-state.mjs:84-95`); the operator can rewrite both the data and the manifest.
  - **Operator session forgery** — `OPERATOR_SESSION_SECRET` is on disk; the operator can mint their own valid session token for any actor/role.

### C3. Compromised service-to-service link

- **Capability:** Attacker is on the docker network or in a sidecar; can intercept/inject HTTP between services. Cannot necessarily compromise a host endpoint.
- **Defends:** None. There is no mTLS, no signed bodies, no replay-prevention nonces. Service ports `7001-7009` are HTTP.
- **Claims-but-doesn't:** README's "service-backed governance" suggests service isolation. The implementation is unauthenticated HTTP between services that fully trust each other.
- **Unaddressed:**
  1. **Forge a witness receipt.** The witness service rubber-stamps any caller's `requestedWitnesses` (B7 in D1). An attacker-in-network can intercept agent-os's `/verify` call and return a pre-baked receipt with `accepted: true`.
  2. **Forge an admissibility decision.** The kernel's `/evaluate-admissibility` (`services/governance-kernel/src/index.ts:128`) accepts unsigned requests; attacker can intercept and impersonate the kernel's response back to agent-os.
  3. **Inject a kill-switch.** Or *suppress* one — agent-os caches kill-switch state for 1s (`services/agent-os/src/index.ts:54, 477-494`); an attacker who controls the link can keep the cached "inactive" state stale during the attack window.

### C4. Subpoenaed host

- **Capability:** Law enforcement / counsel demands the host's contents. The host is online, full disk image available, owner is cooperative. Not adversarial — just demanding evidence.
- **Defends:** The replay query (`services/evidence-ledger/src/index.ts:691-731`) provides the audit timeline. The persisted JSON file is an unencrypted, human-readable artifact.
- **Claims-but-doesn't:** README pitches the system as evidentiary substrate. **The subpoena response will be a `.json` file and a public key.** That is not a forensically defensible chain of custody. There is no:
  - Sealed write-once medium.
  - External time anchor (RFC 3161 TSA, transparency log, blockchain hash) that ties the evidence to a moment external to the host.
  - Redaction tooling (sensitive PII or operator identities cannot be selectively withheld without breaking signatures, because the signature is over the whole artifact).
  - Custodian declaration template (902(11) requires a custodian's certification under penalty of perjury).
- **Unaddressed:**
  - The host is, in evidence-rules language, a **sole-source custodian without redundancy**. Any plaintiff/defendant lawyer with a competent expert will challenge admissibility on the grounds that the same custodian who produces the evidence also signs it.

### C5. Insider with ledger write access

- **Capability:** Holds either (a) the signing key, or (b) write access to the JSON file, or (c) both.
- **Defends:** None at the application layer. Discussed in C2.
- **Claims-but-doesn't:** "Immutable evidence." With insider write, evidence is mutable.
- **Unaddressed:**
  - **No append-only invariant.** The codebase rewrites the whole file every commit; an insider can omit lines.
  - **No hash-chain.** Per-event signatures are independent. Removing an event leaves no gap; renumbering `ledgerCommitIndex` (used in `FinalityCertificate`, `shared/types/src/index.ts:81`) is not detectable.
  - **No external anchor.** Anchoring even a daily Merkle root hash to a public chain (or to a customer's own trust anchor) would create insider-detectable tampering.

### C6. Supply chain compromise

- **Capability:** Attacker compromises `npm`/`pnpm` package, or commits to an upstream dependency, or replaces a service Docker image.
- **Defends:** None. The pnpm lockfile pins versions but does not verify package signatures. Docker images are built from source via `manifests/docker/service.Dockerfile` (referenced in `docker-compose.yml:6`); image build is reproducible only as far as the underlying base image and registry are.
- **Claims-but-doesn't:** N/A — the README does not pitch supply chain.
- **Unaddressed:**
  - **No SBOM** — `npm run lint`/`test` are stubs (`package.json:25-26`); no `cyclonedx`/`syft` integration; no signed `package-lock.json`.
  - **No image signing** — no Cosign/Sigstore integration in compose / k8s manifests.
  - **No vulnerability gate** — no `npm audit` / `osv-scanner` step in any CI workflow (CI workflow files: none in `.github/`).
  - **No reproducible builds.**

### C7. (Bonus) Adversarial mission designer / tenant
- **Capability:** Authorized operator who creates missions designed to subvert the audit chain (e.g., crafted policy text, crafted authority chain).
- **Defends:** Mission policy goes through `policy-compiler/compile` (`services/policy-compiler/src/index.ts:17`). The compiler's only validation is "every line contains `:`" — not even unique keys.
- **Unaddressed:** A mission designer can make `requiredAuthorities` reference any string; the meta-authority-registry uses substring matching to resolve authority (`services/meta-authority-registry/src/index.ts:94`). The mission designer can self-attribute to authorities they have no actual delegation from. *No service rejects this.*

---

## D. Evidence ledger vs. the legal admissibility bar

The user's positioning makes legal-admissibility a first-class concern. This section evaluates the ledger against three legal hurdles plus the insurance-subrogation-discovery bar.

### D1. Federal Rule of Evidence 803(6) — Records of Regularly Conducted Activity (the "business records" exception to hearsay)

To qualify a record under FRE 803(6), the proponent must show:
- **(A)** the record was made at or near the time of the events it describes, by — or from information transmitted by — someone with knowledge.
- **(B)** the record was kept in the course of a regularly conducted activity of a business.
- **(C)** making the record was a regular practice of that activity.
- **(D)** all these conditions are shown by the testimony of the custodian or another qualified witness, *or* by a self-authenticating certification under FRE 902(11) or (12).
- **(E)** the opponent does not show that the source or method indicates a lack of trustworthiness.

How the codebase fares:

- **(A) Time of events:** Events have `timestamp` from `services/governance-kernel/src/lib.ts:18` (`new Date().toISOString()` on the recording host). **Met *if* the host clock is trusted.** No NTP enforcement, no monotonic clock guard, no TSA anchor. A regulator's expert will call this out.
- **(B) Regular course:** The system records events as a *function* of normal operation. **Met in design.** The argument is "this system records every governance decision."
- **(C) Regular practice:** The same. **Met in design.** Caveat: there is no formal documentation that defines what events the system *should* record; an opponent can argue events were selectively suppressed (especially because `commitLedgerEvent` failures are silently swallowed, `services/agent-os/src/index.ts:316-331`).
- **(D) Custodian:** No standard template, no declaration form. The codebase ships with no certification artifact. **Process gap, but easy to close (a declaration form).**
- **(E) Trustworthiness:** This is where the codebase fails the hardest. An opponent will argue:
  1. The recording host is the same host that signs the records (TCB §B); no separation of custody.
  2. Ledger commit failures are silent → events can be missing.
  3. The actor field is client-controlled → attribution is not authenticated.
  4. The ledger is a JSON file editable by any process with file write → tamper-evidence is absent.
  5. The same key signs everything → no quorum to detect single-host compromise.
  6. The IDs are `Math.random()`-derived (`services/governance-kernel/src/lib.ts:19`) → not even guaranteed unique under repeated process restarts; the hex space is 4.7 billion which is fine for low volume but trivially collidable at scale.

  **803(6)(E) admissibility is the live battle.** A motion in limine can plausibly succeed in keeping these records out *as the sole source of truth*. They survive admission as one piece of evidence among others.

### D2. FRE 901 — Authentication

Specifically **901(b)(9)** — "evidence describing a process or system and showing that it produces an accurate result."

To meet 901(b)(9), the proponent typically offers:
- A description of the process (the architecture).
- Validation evidence that the process produces accurate output.
- A demonstration that the specific evidence in question came from that process.

Codebase status:
- Architecture is documented (README.md, architecture.md). **Met (basic).**
- **Validation evidence is absent.** `validate-core.ts` and `validate-stack.mjs` are happy-path E2E scripts (B3, B10 in D1). There is no test that the ledger refuses to commit a malformed event, that signatures fail when the key is wrong, that timestamps cannot be rewound, that the file recovers correctly from a partial write. **Significant gap.**
- That a specific record came from this process: the signature attests this *if* the verifier trusts the public key. **Met conditionally.**

A 901(b)(9) challenge will succeed unless the codebase ships with an *evaluation suite* that demonstrates the process is accurate.

### D3. FRE 902 — Self-authentication

Two paths apply:

- **902(11)** — Certified domestic records of regularly conducted activity. Requires an affidavit/declaration from the custodian and pre-trial notice. **Process artifact** the codebase doesn't produce, but easy to add.

- **902(13)** — Certified records generated by an electronic process or system that produces an accurate result. Requires a declaration from a *qualified person* (typically an engineer or admin) attesting that the system produces an accurate result, and pre-trial notice. **Process artifact**.

- **902(14)** — Certified data copied from an electronic device, storage medium, or file. Requires a declaration that the data was copied accurately, by a qualified person. The hash digest in `manifest.json` from `scripts/backup-governance-state.mjs:84-90` is the *raw material* for a 902(14) declaration. **Substrate met; process gap (no declaration template).**

902(13)/(14) are achievable if the codebase ships with declaration templates *and* the AU-9 fix (D1 §A) lands. Without AU-9, the 902(13) declaration will face cross-examination on every "accurate result" claim.

### D4. Insurance subrogation discovery

When an insurer pays a claim and seeks subrogation, the insurer's counsel needs:
- A complete event timeline for the period in question.
- Demonstrable chain of custody from system events to courtroom exhibits.
- Confidence that the timeline cannot be edited between event-time and discovery-production-time.
- Records that survive a Daubert-style challenge to the underlying technology.

Status:
- **Complete timeline:** `evidence-ledger/timeline` provides this for committed events. Counter: silent commit failures (D1 cross-cutting #2) imply the timeline may be incomplete. An opposing expert *will* probe this.
- **Chain of custody:** broken at multiple links (D3 §A8 backup, §C4 subpoenaed host).
- **Tamper-resistance:** insufficient (single-host signing, no append-only, no anchor).
- **Daubert:** the system uses well-known cryptography (Ed25519/HMAC) which would survive a Daubert challenge. The architecture (single-host, no chain) would not — an expert can credibly testify that the system's tamper-resistance falls short of industry practice for evidentiary substrates (which the user's insurance positioning explicitly invokes).

---

## E. What would be sufficient — moving past single-node Ed25519

Single-node Ed25519 is insufficient because:
1. The same actor signs and stores; compromising the actor compromises the signature.
2. Per-event signatures with no chain do not detect deletions or reorderings.
3. Local clocks are unanchored.
4. There is no second party to corroborate.

A defensible architecture requires *all four* properties below. Any subset is insufficient for the regulatory/insurance bar:

### E1. Append-only with cryptographic chaining
- **Mechanism:** Each committed event includes `prevHash = sha256(previousEvent.canonical_form)`. The chain forms a single linked sequence; periodic Merkle roots aggregate batches.
- **Effect:** Insertion or deletion changes `prevHash` of a downstream event, breaking verification.
- **Implementation primitive available:** Trillian (Google's transparency-log primitive), or a homegrown simple-merkle-log. ~M effort.

### E2. External time anchoring
- **Mechanism:** Periodically (e.g., every minute, or every N events, or both) submit the current Merkle-root hash to (a) a public RFC 3161 Timestamp Authority, (b) a public transparency log (Sigstore Rekor, or a custom CT-style log), and/or (c) a public blockchain (Bitcoin/Ethereum/Hedera/AWS QLDB digest).
- **Effect:** No retrospective tampering survives — the Merkle-root commitment is now external to the host.
- **Implementation primitive:** RFC 3161 client (e.g., DigiCert TSA), Sigstore Rekor client (`sigstore-js`). ~S-M effort for first integration.

### E3. Multi-party signing / threshold signature
- **Mechanism:** The ledger key is split via Shamir or threshold-Ed25519 across **k** independent custodians (e.g., the operating organization, a third-party witness, the insurer). Commits require **m-of-k** signatures.
- **Effect:** Compromise of one custodian (including the host operator) cannot forge events. The custodians can include the regulator or the insurer for high-stakes decisions.
- **Implementation primitive:** FROST (threshold Ed25519), or simpler m-of-n via independent verifier services exchanging signed attestations. ~M-L effort.

### E4. Independent witness/verifier services with attested outputs
- **Mechanism:** The current `witness-service` is a stub (D1 §B7). Replace with a real consensus protocol where multiple independent witnesses (running in different organizations / clouds / hardware roots-of-trust) sign the events they observe. Each witness signs with its own key. Quorum is enforced by the ledger.
- **Effect:** A multi-party witness chain that satisfies what the README says the witness service already does.
- **Implementation primitive:** A small BFT-style witness protocol; or simpler — N independent log-replicas that compare their own copies and disagree publicly when they diverge.

### E5. Tamper-evident storage tier
- **Mechanism:** Append-only filesystem (S3 Object Lock with WORM, AWS QLDB, append-only Kafka with retention.ms = -1, or write-once optical media for high-stakes deployments). The ledger.json approach is replaced with an actual log.
- **Effect:** Even an insider with root cannot rewrite history at the storage layer.
- **Implementation primitive:** S3 Object Lock or QLDB ledger; ~M effort.

### E6. Independent custodian + 902(13)/(14) declarations
- **Mechanism:** Operationally, a third party (audit firm, bonded custodian, insurer's IT team) holds a read-replica of the ledger. They can independently verify Merkle roots against the public anchor and sign 902(14) declarations attesting to data they observed.
- **Effect:** The "single custodian" objection (D §C4, D §D1(E)) goes away.
- **Implementation primitive:** read-replica streaming + client-side verifier + declaration template.

### E7. Operator-side signing of mutating actions
- **Mechanism:** Each operator action arriving at the gateway must include a signature over the action body, made with the operator's own key (browser WebCrypto, hardware token, or federated identity provider's signed assertion). The gateway verifies the signature *and* records the signature in the ledger event.
- **Effect:** Closes the AU-10 / non-repudiation gap. The actor field stops being a client-supplied string.
- **Implementation primitive:** WebAuthn assertion in browser → forwarded to gateway → captured in ledger event. ~M effort.

### Summary: insufficient → sufficient

A defensible upgrade path:
1. (Tier 1, ~M) E1 + E2 + E7 close the most consequential gaps. The ledger becomes append-only-chained, externally anchored, and operator actions become signed by operators.
2. (Tier 2, ~M-L) E3 + E5 + E6 add the multi-party trust and tamper-evident storage that an insurer or regulator will require to *certify* the substrate.
3. (Tier 3, ~L) E4 turns the witness-service stub into a real consensus protocol — needed to defend the "constitutional commit-point" claim under hostile audit.

Each of these maps directly to a Deliverable 4 priority.

---

## F. Threat-model summary table

| Adversary | Primary capability | What's defended | Claims-but-doesn't | Unaddressed |
|---|---|---|---|---|
| Compromised agent | Worker API access | Tool/lease check; destructive regex; high-risk witness | Trust-tier governs; identity binding | Output authenticity; agentId impersonation; regex bypass; intent vs action gap |
| Malicious operator (root) | Host filesystem | — | Immutable evidence | Direct file edit; key on disk; backup tampering; session forgery |
| Compromised network link | MITM between services | — | Service-backed governance | Forged witness/admissibility/kill-switch |
| Subpoenaed host | Cooperative discovery | Replay timeline | Forensic evidentiary chain | Sole-source custodian; no anchor; no redaction; no declaration template |
| Insider with ledger write | Direct ledger access | — | Immutable evidence | No chain; no append-only; no external anchor |
| Supply chain compromise | Package/image substitution | — | — | No SBOM; no image signing; no vuln gate; no reproducible builds |
| Adversarial mission designer | Operator-tier access | Mission governance flow | Authority enforcement | Authority-string spoofing; meta-authority self-promotion |

The pattern across rows: **defenses cluster around the agent worker boundary; gaps cluster around operator/insider/network and around the audit log itself**. That is the inverse of where defenses *should* cluster for a regulatory substrate. The agent worker is the *least trusted* principal but receives the most enforcement; the operator/insider/host is the *most trusted* and receives almost no enforcement.

---

**Deliverable 3 reviewed and approved. Deliverable 4 begins below.**

---

# DELIVERABLE 4 — ROADMAP TO INFRASTRUCTURE-GRADE

**Goal frame:** This OS as the *standard registration / tracking / insurance-evidence substrate* for autonomous systems, eventually mandated. That ambition imposes a non-trivial constraint: every Tier must produce changes that other vendors will eventually integrate **with**, not compete **against**. That's the test for "infrastructure-grade" — vendors don't compete with TCP/IP; they implement it. The roadmap below is shaped to that test.

The work in each tier is sized **S** (≤ 1-2 weeks), **M** (1-3 months), **L** (3-12 months). All sizing assumes a small focused team (2-3 senior engineers + a security-cleared cryptographer at Tier 1, growing modestly at Tier 2-3). Sizing does not include the organizational/process work (SOC 2 readiness, ISO 27001 audits, regulatory engagement) which is parallel and is called out where relevant.

Each item has three required parts: **Scope** (what changes in the code), **Why strategic** (which audience this unlocks), **MVP** (the minimum that ships).

---

## TIER 1 — 90 days. The credibility floor.

These are the changes without which a skeptical regulator or underwriter will not take the project seriously. The status quo cannot survive a 30-minute hostile review by a competent auditor; Tier 1 addresses that.

### T1.1 — Append-only chained ledger with external anchoring  (M)

**Scope.** Replace the rewrite-the-whole-JSON pattern (`services/evidence-ledger/src/index.ts:80-90`) with an append-only event log. Each new event includes `prevHash = sha256(canonical(previousEvent))`. Periodically (every N events or every K seconds) compute a Merkle root over a batch and submit that root to (a) a public RFC 3161 Timestamp Authority and (b) a public transparency log (Sigstore Rekor or a committed transparency-log clone). Persist the TSA token and the Rekor inclusion proof alongside the batch root.

**Why strategic.** Closes AU-9, A.5.33, EU AI Act Art. 12(3), and FRE 803(6)(E)/902(13) tamper-evidence objections in one stroke. Moves the ledger from "single-host JSON file" to "verifiable transparency log" — which is the *category of artifact* an insurer or regulator already understands (CT, Rekor, Trillian). This is the single highest-leverage change in the entire roadmap.

**MVP.** A new `evidence-ledger-v2` writer that:
- Maintains an append-only file (or S3/QLDB backend) with `{prevHash, event, signature}` per record.
- Every 60 seconds, computes the Merkle root of new events and POSTs to a free-tier RFC 3161 TSA (e.g., DigiCert) and to Sigstore Rekor.
- Exposes `GET /anchors` returning the list of (root_hash, tsa_token, rekor_uuid).
- Existing `/replay` and `/timeline` continue to work; add `verify=true` query param that walks the chain and asserts integrity.

**Out of scope for MVP:** multi-party signing (Tier 2), independent witness consensus (Tier 2), hardware-rooted keys (Tier 2).

**Verification.** A simple `verify-ledger.mjs` script that walks the chain, recomputes Merkle roots, verifies TSA tokens, and verifies Rekor inclusion proofs. This script becomes the kernel of the Tier 3 conformance test suite.

### T1.2 — Operator-side signing of mutating actions (M)

**Scope.** Operator's mutating requests must include a signature over the canonical request body, signed by the operator's key. Verify at the gateway (`adapters/http-gateway/src/index.ts:553-623`); reject if missing or invalid. Capture the signature in the corresponding ledger event so it survives discovery.

The operator key can come from any of:
- WebAuthn / passkey assertion (browser, no UX cost beyond a touch).
- Hardware token via WebHID / WebUSB.
- Federated identity provider's signed assertion (OIDC `id_token` with a signing capability) — for enterprise SSO integration.

**Why strategic.** Closes AU-10 (non-repudiation) and the actor-string-is-client-controlled hole (D1 §B10 hole #1, D3 §A1). The ledger event now binds an action to a *cryptographically authenticated identity*, not a free-form string. This is required for any "subrogation discovery" scenario that names a specific human responsible.

**MVP.**
- Console-ui issues WebAuthn assertions for mutating actions; `apps/console-ui/src/gateway-client.ts` adds an `X-Operator-Signature` header.
- Gateway validates against a registry of operator public keys (a new `OperatorRegistry` artifact type, persisted in evidence-ledger so registration itself is governed).
- Validate-core.ts and validate-stack.mjs gain key-management helpers.
- Browser-bundled `VITE_OPERATOR_API_KEY` deprecated for mutations (still allowed for local dev; production preflight refuses to boot if both are configured).

**Out of scope for MVP:** Automated key rotation, hardware-token enrollment UX, multi-key per operator.

### T1.3 — Service-to-service authentication (M)

**Scope.** Every inter-service call gets either (a) mTLS with each service holding its own cert, or (b) an HMAC-signed body with a shared secret rotated daily. I recommend (a) for Tier 1 — mTLS is well-understood by auditors and integrates with existing service-mesh tooling (Linkerd, Istio, or basic SPIFFE/SPIRE).

**Why strategic.** Closes the docker-network trust boundary (D3 §A2-A4). Without this, the gateway is one of many unauthenticated callers; an attacker on the network can speak agent-os's voice to evidence-ledger. AC-3 is partial-only without service-level enforcement.

**MVP.**
- Each service issues itself a cert at boot from a small bundled CA (or accepts certs from a sidecar like SPIRE).
- The shared `lib.ts:11-16` `createApp()` becomes `createApp({ requireClientCert: true })` and validates client certs against the bundle.
- Outbound `fetch()` in agent-os/gateway uses an `https.Agent` with the service's own cert.
- Production preflight (`adapters/http-gateway/src/preflight.ts`) gains a `service-mesh-mtls` check that fails in production if any service is reachable without mTLS.

**Out of scope for MVP:** SPIRE-based identity rotation, zero-trust per-call authorization.

### T1.4 — Runtime input validation + rate limiting (S)

**Scope.** Wire the existing Zod schemas (`shared/schemas/src/index.ts`) into all mutating endpoints across all services. Reject malformed payloads with structured errors. Add a rate-limit middleware at the gateway (`express-rate-limit` or a custom HMAC-token-bucket) sized for "operator console + automated workers," not for "the entire internet."

**Why strategic.** Closes SI-10 (input validation), AC-7 (logon attempts), and a class of attacks that can poison the Maps in services. Cheap, fast, blocks a wide attack surface.

**MVP.** Zod parse on every `POST` route; rate-limit `100 req / minute` per IP at the gateway with bypass for authenticated operator sessions; `429` response on rate-limit. This is two-day work per service for ~5 services.

### T1.5 — Fix structural correctness defects (S)

These are individually small but collectively correct the "what was claimed but doesn't work" surface. Each is a one-line or one-day fix:

- Add `authority-router/health` to the gateway's `/health` Promise.allSettled (`adapters/http-gateway/src/index.ts:628-637`). Currently 8 of 9.
- Replace `Math.random()` ID generation (`services/governance-kernel/src/lib.ts:19`) with `crypto.randomUUID()` everywhere. ~30 minutes.
- Add a fail-closed flag to `governance-kernel/validate-envelope` so the registry-unreachable fallback (`services/governance-kernel/src/index.ts:77`) **denies** rather than allows in production. Production preflight should require `KERNEL_FAIL_CLOSED=true`.
- Make `commitLedgerEvent` failures *fail-closed* in agent-os when `LEDGER_AVAILABILITY=required` (env-gated). Currently silently logs (`services/agent-os/src/index.ts:316-331`).
- Replace the destructive-action regex (`services/agent-os/src/index.ts:711-725`) with an explicit allow-list of approved tool-action shapes; reject by default. The regex bypass is a sample audit-finding waiting to happen.
- Add an `AGENT_OS_KILL_SWITCH_CACHE_MS=0` option for production deployments; the 1-second cache (line 54, 477-494) is a real hole during ramped halts.

**Why strategic.** Each one of these is the *first thing* a competent auditor will find in an hour. Fixing them removes "amateur" tells before any serious review.

### T1.6 — Constitutional spec document v0.1 (S)

**Scope.** Author a single document — call it the *Aristotle Conformance Specification* — that states, normatively, what the system promises:
- The seven artifact types and their machine-readable schemas (Zod / JSON Schema / Protobuf).
- The constitutional flow (policy → envelope → admissibility → warrant → gate → witness → finality).
- The integrity guarantees (chain, anchor, signing, witness quorum) — *as they will be after Tier 1 ships*.
- The operator authentication model.
- The minimum environmental requirements (mTLS, rate-limit, durable state).
- A list of *non-claims* — things the system explicitly does not do (e.g., "is not a flight-control system," "is not a primary insurer's ratemaking system").

**Why strategic.** Without a written spec, every conversation with a regulator/auditor restarts from "what is this thing." With a spec, conversations start from "does this implementation match the spec." The spec also seeds the Tier 3 conformance test suite.

**MVP.** A single 30-50 page Markdown document under `docs/conformance-spec-0.1.md`. No fancy schema languages — just normative MUST/SHOULD/MAY language (RFC 2119) and links into the Zod/Proto schemas. **This document is the most strategic non-code artifact in the project.**

### T1.7 — Third-party readiness assessment (process, parallel) (M)

**Scope.** Engage a SOC 2 Type II readiness firm and an ISO 27001 readiness firm to run gap assessments. Produce a remediation backlog. Engage a security-firm for a code-level review of the cryptographic claims as upgraded by T1.1-T1.3.

**Why strategic.** Insurance underwriters and federal regulators will not accept self-attestation. The clock starts the day the readiness assessment delivers; SOC 2 Type II requires a 6-12 month observation window. Starting at Tier 1 means the cert lands during Tier 2.

**MVP.** Two readiness reports + one external code-level cryptographic review. Roughly $80-150K of professional services, depending on firm.

---

### Tier 1 deliverable: a defensible substrate

By end of Tier 1, the system can survive a serious 1-day audit: the ledger is append-only and externally anchored, operators are cryptographically identified, services are mutually authenticated, and there is a written spec. Fail-open holes are closed. The gap from "demo" to "credible enterprise pilot" is closed.

**Tier 1 does not unlock first regulated deployment.** That's Tier 2.

---

## TIER 2 — 6 months. First regulated deployment.

Tier 2 is the work between "credible pilot" and "deployable in a jurisdiction with statutory obligations." The defining test: can a state DMV, the FAA, or an EU national authority point at this system and say "this is the substrate for our regulatory regime"?

### T2.1 — Multi-party witness consensus (replace the witness stub) (L)

**Scope.** The current witness-service rubber-stamps (`services/witness-service/src/index.ts:10-28`). Replace with a real consensus protocol where N independent witness instances (running in different cloud accounts, organizations, or hardware TEEs) sign events they observe. Quorum k-of-N is enforced at completion finality.

For early deployment a simple design suffices:
- Each witness is a separate process with its own key.
- The ledger ships every committed event to each witness via a fan-out (push or pull).
- Each witness signs the event with its own key and returns the signature.
- The ledger appends the signatures to the event record.
- A `verify-witness-quorum` script validates that every event has k-of-N signatures.

**Why strategic.** Closes the "single-custodian" objection (D3 §C4, §D1(E)) for evidentiary admissibility. Closes AU-9(2) (separate physical systems). Required for FRE 902(13)/(14) to survive cross-examination.

**MVP.** Three witness instances (operator's, an independent custodian's, an insurer's or auditor's). Quorum 2-of-3 default; high-risk missions raise to 3-of-3. The `WITNESS_QUORUM` env (`services/witness-service/src/index.ts:5`) becomes meaningful.

**Process work in parallel.** Negotiate witness-hosting agreements with at least one independent custodian and one insurance customer. Without external operators of witnesses, the multi-party claim collapses.

### T2.2 — Threshold signing of high-stakes artifacts (M)

**Scope.** For finality certificates and assurance attestations, replace single-key Ed25519 with FROST-Ed25519 threshold signing across multiple custodians. Operator → primary signer; insurer / regulator → co-signers as appropriate.

**Why strategic.** Closes E3 from D3 §E. Defends against the "compromised host operator" adversary (D3 §C2, §C5) — root on the host is no longer enough to forge finality.

**MVP.** Two-of-two co-signing for finality certificates: operator + one independent custodian. Three-of-three for system-level assurance attestations.

### T2.3 — Reference binding for one deployable class — UAS *or* AV (L)

The codebase declares 9 deployable classes (`adapters/http-gateway/src/index.ts:417-499`). To get to first regulated deployment, pick **one** and produce a complete, regulator-aligned binding. The user's choice between UAS and AV will be context-dependent (D3 §C7 in the questions list); below is the scope for each option.

#### Option A — UAS (FAA Part 107 / 89 / 108 alignment)

**Scope.**
- New artifact types: `Aircraft` (with FAA registration number), `OperatorCertificate` (Part 107 cert, type-rated remote pilot), `FlightAuthorization` (LAANC/USS-style time-bounded operating authorization), `RemoteIDBroadcast` (recorded ASTM F3411-22a payload).
- Mission types extended: `governanceProfile = "uas-bvls-recordkeeping"`.
- A new service: `uas-binding`, which converts internal mission events to FAA-format reports (Part 107 incident, Part 108 BVLOS conformance evidence as the rule lands, Remote ID broadcast logs).
- The "kill-switch" semantics get a UAS-specific scope: `airspace` (e.g., a TFR area). Scope-aware halt becomes "all UAS in airspace X."

**Why strategic.** Even before Part 108 finalizes, an "evidence-of-decisions" substrate has demand: drone delivery operators, infrastructure-inspection fleet operators, Public Safety UAS programs, and FAA's UAS Service Suppliers all need defensible audit. Becomes the *recordkeeping* layer that BVLOS operators need to prove conformance to whatever standards Part 108 finalizes.

**MVP.** End-to-end: a fleet operator running BVLOS-style missions through this substrate, producing a Part 107 incident-report-equivalent on demand, with full chain-of-custody, witnessable in court if a vehicle damages property.

#### Option B — AV (NHTSA + California DMV alignment)

**Scope.**
- New artifact types: `Vehicle` (with VIN), `ManufacturerPermit` (state DMV permit reference), `Disengagement` (CA-DMV-format disengagement event), `CrashReport` (NHTSA SGO 2021-01-format), `InsuranceBinding` (proof of coverage).
- Mission types extended: `governanceProfile = "av-driverless-deployment"`.
- A new service: `av-binding`, which converts internal events to DMV monthly disengagement reports and NHTSA SGO crash reports.
- The kill-switch gains an `ods` (Operational Design Domain) scope: "halt all vehicles outside ODD."

**Why strategic.** California's deployment permit (13 CCR § 227.50) is the most prescriptive AV regulation in the U.S. A substrate that produces conformant disengagement and crash reports closes the gap between operational telemetry and regulatory filings — there is currently no industry-standard substrate for this. NHTSA SGO 2021-01 has the same need at the federal level and at much shorter time-to-report.

**MVP.** A reference deployment that takes simulated AV telemetry through the governance pipeline and produces a CA-DMV-format Disengagement & Mileage Report and an NHTSA-format crash report on demand.

---

**Recommendation.** UAS is more open-ended (Part 108 still drafting; Remote ID is a closed format ASTM F3411-22a) and arguably allows the project to *shape* the standard. AV has tighter deadlines (NHTSA SGO already binding) but more crowded competitive space. **The user's choice is a strategic call I should not make for them**; it appears as one of the five questions at §F below.

### T2.4 — Identity attestation tied to hardware roots-of-trust (M)

**Scope.** The current `IdentityAttestationArtifact` (`shared/types/src/index.ts:124-132`) is populated from an auto-generated string fingerprint (`services/agent-os/src/index.ts:133-134`). Replace with attestation pulled from the agent's hardware: TPM quote, AWS Nitro Enclaves attestation document, AMD SEV-SNP report, or signed device-certificate from a managed device-trust provider. The fingerprint becomes a hash of the attestation document; verification is a proof-of-attestation chain.

**Why strategic.** Identity attestation is a load-bearing artifact for the "insurable" assurance posture (`adapters/http-gateway/src/index.ts:220-230`). Without hardware grounding, the attestation is a self-claim. With hardware grounding, the regulator/insurer can verify *the agent ran on certified hardware*. This is the analogue of FAA "Type Certified" hardware for ground systems.

**MVP.** TPM-attestation support for Linux-based workers (the most accessible hardware root). Supports the AWS Nitro path on cloud-deployed workers.

### T2.5 — Tamper-evident storage tier (M)

**Scope.** Move ledger storage from a JSON file to AWS QLDB (immutable + cryptographically verifiable) or S3 Object Lock with WORM, or a self-hosted append-only store like Trillian. Maintain compatibility with the existing replay API.

**Why strategic.** Closes E5 in D3 §E. Insider-with-root cannot rewrite history at the storage layer.

**MVP.** S3 Object Lock with hourly Merkle-root anchor publication. QLDB if Amazon-aligned customer demands it.

### T2.6 — Conformance test suite v0.1 (M)

**Scope.** A test suite that any vendor can run against an Aristotle deployment to verify conformance to the spec (T1.6). Covers:
- Append-only chain integrity.
- TSA + Rekor anchor verification.
- Operator-action signature verification.
- Witness quorum satisfaction at finality.
- Service-to-service mTLS.
- Specific failure semantics (kernel fail-closed, ledger commit fail-closed, gateway preflight refusal in production).
- The integration tests `validate-core.ts` and `validate-stack.mjs` are absorbed and extended.

**Why strategic.** This is the bridge to Tier 3. A conformance test suite is what makes "implement Aristotle" a buildable target for other vendors.

**MVP.** ~50 conformance assertions, runnable as `npm run conformance` against a deployment. Output is a machine-readable conformance report (JSON + HTML).

### T2.7 — Customer pilot with a regulated party (process)

**Scope.** Identify and engage one regulated party (a fleet operator, a state agency, an insurer's risk-management arm). Negotiate a pilot deployment with success criteria mapped to the conformance spec. Run for 90 days minimum.

**Why strategic.** Tier 3 standard-setting requires demonstrated production usage. Without a pilot, the project is theoretically conformant; with a pilot, it has reference customers to point to.

**MVP.** One signed pilot agreement; a deployment in a customer-controlled environment producing real artifacts.

---

### Tier 2 deliverable: a regulated deployment is achievable

By end of Tier 2, the system has multi-party trust, a tamper-evident storage tier, hardware-rooted identity, a conformance test suite, and at least one regulated deployable class with binding adapters. SOC 2 Type II should be in or approaching certification (started at T1.7).

---

## TIER 3 — 12-18 months. Standard-setting position.

Tier 3 work makes the project *the* reference implementation that other vendors integrate with. The shift is from "customer of the spec" to "owner of the spec."

### T3.1 — Open conformance program (M-L, parallel work)

**Scope.** Stand up an independent conformance authority. The technical components:
- Public conformance test suite (Tier 2 evolved).
- Submission portal where vendor implementations submit their conformance reports.
- Public registry of conforming implementations.
- Tiered conformance levels: "Bronze" (substrate-only), "Silver" (substrate + one deployable class), "Gold" (substrate + multi-party witness + hardware-attested identity).
- Process for the authority to update the spec; an open RFC/IETF-style process.

**Why strategic.** This is the move that makes Aristotle infrastructure rather than a product. Other vendors implementing the spec is the precondition for any mandate; a mandate requires multiple suppliers and a conformance pathway. Without this, "everyone use Aristotle" is single-vendor lock-in, which kills regulatory adoption.

**MVP.** A non-profit (or vendor-neutral foundation) hosting the conformance authority. The spec is BSD/Apache/CC-BY licensed; the test suite is MIT. The first non-Aristotle conforming implementation is the proof.

**Process work in parallel.** Engage with NIST, ISO, ASTM, IEEE, RTCA — find a standards body that will charter a working group around the spec. NIST AI Safety Institute is a likely first stop.

### T3.2 — Model legislation and regulatory engagement (L, parallel)

**Scope.** Author and circulate model legislation that references the conformance spec by name. Targets:
- A model state AV bill (offered to Montana / Texas / a permissive state) referencing the conformance spec for "evidence of governed operation" requirements.
- A model state UAS BVLOS bill referencing the spec for recordkeeping requirements.
- An insurance commissioner-friendly model bulletin treating substrate-conformant evidence as actuarially admissible.
- Engagement with FAA Aviation Rulemaking Committees (ARCs) for Part 108 input referencing the spec.
- Engagement with EU AI Office / Notified Bodies for Annex IV (Article 11) technical-documentation alignment.

**Why strategic.** Self-evident — the goal is mandated adoption. The work is regulatory and political, not engineering, but the engineering substrate has to be there *first* (Tier 1 + Tier 2) for any of these conversations to have content.

**MVP.** One model bill or bulletin under serious consideration in one jurisdiction.

### T3.3 — Reference implementations of additional deployable classes (M each)

**Scope.** Once the first deployable binding (T2.3) is operating, add the next two. Robotics, infrastructure, maritime, industrial, and cyber-ops are listed in the deployable profiles (`adapters/http-gateway/src/index.ts:445-498`). Each becomes a reference binding analogous to T2.3, with a regulatory authority partner.

**Why strategic.** Each new domain proves the substrate is general. A substrate adopted in one domain is a niche product; in three, it's a category.

**MVP.** Three deployable classes with binding adapters, each with a customer reference.

### T3.4 — Independent custodian network (L, parallel)

**Scope.** Stand up an independent network of custodians who run witness instances (T2.1), hold threshold-signing key shares (T2.2), and offer 902(14) declaration services. Possible custodians: large insurance brokers, Big-4 audit firms, state-affiliated trust offices, civil-society oversight orgs (e.g., AI Now-style nonprofits).

**Why strategic.** Multi-party trust requires actual multiple parties. The Tier 2 architecture *enables* this; Tier 3 *operationalizes* it.

**MVP.** Three custodians with executed agreements; 50% of pilot deployments use the custodian network for at least one quorum slot.

### T3.5 — Federated identity and certification of operators (M)

**Scope.** Operator identity (T1.2) extends to federated identity providers, with the ability for sectoral certification authorities (e.g., FAA Part 107 certificate, state AV operator license) to issue verifiable credentials that the gateway recognizes. An operator's WebAuthn key now also links, via VC presentation, to "certified Part 107 pilot, # 12345."

**Why strategic.** The substrate now records not just *who* did something but *what authority they hold to do it*. This is the operator-identity equivalent of T2.4's hardware-rooted attestation.

**MVP.** OIDC4VC verifier in the gateway; one issuer integration (e.g., a state DMV).

---

### Tier 3 deliverable: standard-setting position

By end of Tier 3, the spec is in a standards body, model legislation references it, multiple vendors implement it, an independent custodian network operates witness slots, and the project has graduated from product to substrate.

---

## E. Five things in the current codebase NOT to change

These are designs that are *already correct for the long-term goal*. Resist the urge to modernize them; they are load-bearing in their current form.

1. **The `ArtifactType` discriminated union and the `BaseArtifact` extension pattern** (`shared/types/src/index.ts:1-33`). It is the schema commitment that makes the project plausibly a *substrate*. Adding a new type (Vehicle, Aircraft, InsuranceBinding, RegistrationCertificate) is one TS interface plus a Zod schema. The pattern of "define artifact, never instantiate" (D2 §J) is a feature: it has pre-allocated extension space. Any ORM or framework abstraction that hides this pattern destroys the property.
2. **The constitutional flow** — policy → envelope → admissibility → warrant → gate → witness → finality (`services/agent-os/src/index.ts:1208-1611`). Even though the cryptographic strength is currently weak, the *sequence* matches the regulatory model: "what authority did you have, was the thing admissible, were you witnessed, who said yes at the boundary, what was the final certificate." Tier 1-2 work strengthens each step *without changing the sequence*. Re-architecting the sequence would lose the framework alignment.
3. **The replay-event + counterfactual-branch separation** (`services/evidence-ledger/src/index.ts:67-71, 656-689`). Hypotheticals are first-class and isolated from committed events. This is exactly what insurance scenario-modeling and "what would have happened if" regulator inquiries need. Most logging systems do not separate counterfactuals; this one does.
4. **The kill-switch scope taxonomy** — `global | mission | domain | agent | device` (`shared/types/src/index.ts:110`). It is the right *level of abstraction* for regulatory halt commands. "Ground stop all UAS in airspace X" maps to `scope: "domain"`. "Recall all vehicles by VIN Y" maps to `scope: "device"`. Any expansion (T2.3 UAS adds `airspace` scope, T2.3 AV adds `ods` scope) is additive.
5. **The operator session token format** — `ost.<base64url-claims>.<HMAC>` (`adapters/http-gateway/src/index.ts:119-144`). It is JWT-shaped, uses constant-time signature comparison, and validates timing windows. Operator-side signing (T1.2) **augments** this, it does not replace it. Resist the temptation to replace with full JWT/JWS — the custom shape is defensible (less attack surface), and the file is correct as written.

---

## F. Five questions whose answers would change the roadmap

The roadmap above bakes in implicit assumptions. The five questions below are the load-bearing ones; different answers materially reshape the priorities.

1. **Federal-mandate substrate vs. private-market substrate?** If the goal is federal mandate, NIST AI RMF / SP 800-53 / EU AI Act conformance dominates and Tier 3 is mostly regulatory engagement. If it's private-market (insurance, enterprise), then SOC 2 / ISO 27001 / Lloyd's-style underwriting dominates and Tier 3 emphasizes the conformance program and custodian network. **The two paths share Tier 1 entirely; they diverge at Tier 2.**
2. **Self-operated by the regulated party, or operated by an independent auditor?** If self-operated, the threat model centers on the operator's own integrity (insider threat dominates). If operated by an auditor on the regulated party's behalf, the threat model centers on collusion between the auditor and the operator. The multi-party witness design (T2.1) is sized very differently: 3-of-N where N=operator+regulator+insurer for the first case; 5-of-N adding civil-society and a sectoral authority for the second.
3. **UAS or AV as the first deployable class?** (T2.3 alternatives.) UAS allows shaping the spec while Part 108 finalizes, but the first revenue is later. AV has a tighter regulatory deadline (NHTSA SGO already binding) but more crowded competitive space. Choosing one over the other reshapes Tier 2 staffing (aviation expertise vs. automotive-cyber expertise) and the customer pipeline.
4. **Open-source / open-spec or closed enterprise product?** The roadmap above assumes open-spec at Tier 3 (T3.1). If the project is closed-source, T3.1 is replaced by a "preferred-vendor" program — which is a much weaker position for federal mandate (no mandate has ever required a single vendor's product), but a stronger position for short-term revenue. The two are not fully compatible.
5. **Will the project ship its own keys / HSM, or expect customers to BYO?** The roadmap above assumes BYO at Tier 1 (operator-side WebAuthn) and managed-or-BYO at Tier 2 (TPM/Nitro for hardware-rooted identity). If the project ships its own KMS, the trust story is different (single vendor holds keys = larger TCB, harder regulatory story, easier sales motion).

---

## G. Closing perspective

Three observations worth holding for strategic decision-making:

1. **The codebase's Tier-1 cost is small in absolute terms.** A small focused team can land Tier 1 in ~90 days at meaningful cost (~6-figure dollars). The scaling cliff is at Tier 2, where multi-party operations require external operators of the witness/custodian network.
2. **The most strategic asset the codebase already has is the schema commitment.** Pre-allocated artifact types (`LineageCertificate`, identity/autonomy/assurance attestations) and the constitutional flow are the parts that competing vendors will find hardest to redo. The cryptographic weaknesses are addressable; the schema commitment is foundational.
3. **The most strategic non-code asset is yet to be written.** That is the Conformance Specification (T1.6). It is the single document that turns this from a product into a substrate. It should be authored carefully and circulated early — even before Tier 1 ships — to anchor the regulatory conversation.

---

# AUDIT COMPLETE — End of Deliverable 4

The four deliverables in this file (Ground Truth Map, Conformance Gap Analysis, Adversary Model & Trust Analysis, Roadmap to Infrastructure-Grade) constitute a complete strategic audit of the Aristotle Autonomous Governance OS as it exists today. All technical claims are file:line cited; all framework citations are explicit (with `[ASSUMPTION]` markings where clause-numbering is uncertain).

The audit's thesis can be stated simply: **the codebase is plausibly a substrate. It is not yet credible enough to be a substrate. Tier 1 — 90 days of focused work — moves it to credible. Tier 2 makes it deployable in regulated jurisdictions. Tier 3 makes it the standard. Each tier has a single load-bearing item without which the rest does not stand: T1.1 (chained ledger), T2.1 (multi-party witness), T3.1 (open conformance program). Resourcing those three is the path; the rest is supporting work.**

*See Addendum below for response to AI PM review and resulting amendments to this thesis.*

---

# ADDENDUM — Response to AI PM Review (scrutinize-both-sides)

The user circulated this audit to an AI PM and forwarded the critique. The PM's review is substantive and deserves a substantive response. Below: what to accept, what to update in the deliverables above, and where the PM's own framing has soft spots that warrant reciprocal pushback.

**Structural disclosure first.** The PM has access to context I do not: the GPlane book, Petersen Governance Architecture paper, GEL paper, MAE amendment protocol, Recursive Governance paper, Helena_Telecom_North binding. These were not in the working directory. My audit was strictly of `extracted/`. That asymmetry shapes a meaningful share of the PM's critique and is worth surfacing before adjudicating any specific point.

## A. Where the PM is right and the audit should be amended

### A1. The fail-open audit trail belongs at Priority 0, ahead of T1.1

The PM is correct. I cited this finding in three places (D1 §B9 "evidence-ledger unreachable → commitLedgerEvent catches the fetch error and proceeds"; D1 §D cross-cutting #2 "The audit trail is fail-open"; T1.5 fifth bullet) but did not elevate it in the priority ranking. Their argument is decisive: tamper-evidence (T1.1) presupposes that the recording itself is reliable. A chain over an incomplete log records "this is what we received," not "this is what happened." An adversary who can DoS the ledger for a window can produce execution events that the ledger never sees, and there is no gap detection because there is no chain.

**Amendment to Deliverable 4.** Insert a new T1.0:

> **T1.0 — Fail-closed audit trail (S, immediate)**
>
> **Scope.** `services/agent-os/src/index.ts:316-331` (`commitLedgerEvent`) currently catches all errors and returns silently. Add an env-gated mode `LEDGER_AVAILABILITY=required` that propagates the error to the caller, blocks the state mutation, and returns 5xx to the operator. Production preflight (`adapters/http-gateway/src/preflight.ts`) refuses to boot without it.
>
> **Why strategic.** Without this, every other integrity claim is contingent on the ledger never being unreachable. With this, the system fails available-but-deniable into fails-stop.
>
> **MVP.** Two-day work. The fix is a try/catch removal plus a preflight check.

This is also the cheapest item in Tier 1 and arguably should land before any other code change.

### A2. T1.1 and T1.2 are co-load-bearing, not T1.1-then-T1.2

The PM: "A chained ledger that records garbage attribution is not better than an unchained ledger that records garbage attribution." Correct. My closing thesis named T1.1 (chained ledger) as the single load-bearing item; that's wrong. Without T1.2 (operator-side signing), the chain links events whose `actor` field is a client-controlled string. The chain attests to the *recording*, not to the *attribution*. AU-9 and AU-10 are jointly necessary; neither alone delivers the legal-admissibility outcome.

**Amendment to Deliverable 4 closing thesis.** "Tier 1 has *two* co-load-bearing items: T1.0+T1.1 (chain over a complete log) and T1.2 (signed-at-source operator actions). Either alone leaves the legal admissibility story incomplete."

### A3. The architecture-vs-implementation distinction was missed in the closing thesis

The PM: "the codebase is 'plausibly a substrate' — but your substrate is the architecture." This is the most consequential framing critique. My closing line conflated the codebase with the project. Inside the deliverables I was scope-disciplined — every claim is tied to a code citation — but the closing thesis took the broader language ("is plausibly a substrate") that the architecture deserves but the code does not currently merit.

**Amendment to Deliverable 4 closing thesis.** Replace "the codebase is plausibly a substrate" with "the codebase is currently a partial reference implementation of a substrate that is more fully specified in the project's architectural writing. The implementation does not yet meet the architectural specification at the points called out in this audit."

### A4. The "prototype-as-demonstration vs. prototype-as-reference" fork is a missing question

The PM's question 6 (effectively): is this prototype intended to *demonstrate* the architecture is buildable, or *become* the reference implementation? My roadmap implicitly assumed the second. Both are defensible products, but they have different staffing, timelines, and success criteria. I missed this and should have surfaced it.

**Amendment to Deliverable 4 §F.** Add a sixth question:

> **6. Is this prototype a demonstration or a reference implementation?** If demonstration: fix T1.0, T1.5 (the lies), publish a written notice that the codebase is illustrative and that the architectural spec is the substrate, and accept that someone else's reference implementation may eventually be canonical. If reference implementation: the full Tier 1-3 roadmap stands and aligns the code to the architecture's existing specification (rather than retrofitting the architecture to the code's shortcuts). **The two are different projects.** Choose deliberately.

### A5. The Tier 3 "open conformance program" is also a business-model fork

The PM is right that I framed it as engineering when it is also a revenue-model decision. Open-spec accelerates standard-setting but commits the project to either philanthropic, foundation, or services-around-an-open-spec funding (Red Hat model). Closed-source preserves enterprise margin but concedes the mandate path because no mandate has ever required a single vendor's product.

**Amendment to Deliverable 4 §F question 4.** Expand the existing question to call out the funding-model implication: open-spec implies foundation/services revenue; closed implies enterprise-license revenue; the two are not arbitrarily combinable.

### A6. The deployable bindings are less green-field than I framed them

The PM cites worked architectural bindings (e.g., Helena_Telecom_North) that I could not see. **[ASSUMPTION]** if the bindings are already specified at the architecture level in the published papers, then T2.3's "produce a complete regulator-aligned binding" is partly an *integration* exercise rather than a green-field design. The choice between UAS and AV remains a strategic call (which existing binding to instantiate first), but the design effort per binding is smaller than I assumed.

**Amendment to Deliverable 4 T2.3.** Add a note: "[ASSUMPTION] If a published architectural binding exists for the chosen deployable class (per the project's architectural papers), this becomes an integration exercise against the existing design rather than green-field. Sizing assumes greenfield; revise downward if bindings are already specified."

## B. Where the PM is partially right but I would qualify

### B1. SOC 2 readiness timing

The PM: starting SOC 2 readiness in T1.7 means "paying auditors to document gaps you already know about." Partial agreement.

- **Where they're right:** SOC 2 readiness firms *do* re-derive gaps the user already knows. Paying for that re-derivation is wasteful if scoped as gap-finding.
- **Where I'd qualify:** SOC 2 readiness firms also bring *control-mapping* expertise — translating engineering reality into SOC 2 Trust Services Criteria language. That work is independent of which specific gaps exist. It's the same work whether the system is in shape or not.
- **Net update:** Delay the readiness *engagement* by ~30 days but start it in parallel with T1.1-T1.3 implementation, scoped explicitly as control-mapping (not gap-finding). The 6-month observation clock for Type II starts at engagement, so delay carries direct calendar cost.

### B2. The "what NOT to change" list as the most valuable part of the audit

The PM amplifies this; I'd amplify further. **Item #6 missing from the original "do not change" list:** the bootstrap meta-authority seed pattern (`services/meta-authority-registry/src/index.ts:8-65`). The four hardcoded root authorities (`coalition.core`, `mission.command`, `safety.council`, `evidence.steward`) are the kind of constitutional bootstrap a regulatory substrate needs to publish *as* its constitutional substance. Tier 1 work should harden the *protection* of that bootstrap (signing at registry boot, immutability of the root) but should *not* alter the conceptual structure. **Adding this as item #6 to D4 §E.**

## C. Where I'd push back on the PM

### C1. "Your substrate is the architecture, not the code" — partial agreement, important pushback

The PM's framing risks substituting architectural ambition for engineering rigor. From a regulator's perspective:
- NIST will not bless a paper.
- A Notified Body cannot certify a design document — Article 43 requires conformity assessment of *the system*.
- An insurer will not underwrite an architecture; they underwrite something that runs and produces evidence.
- Federal Rules of Evidence apply to the system that produced the records, not to the architectural treatise that describes it.

The architecture is the necessary precondition. The implementation is the regulatory artifact. **The substrate is both, in sequence.** Letting the implementation lag indefinitely behind a published architecture is exactly the gap a competitor can occupy: a faster reference implementation of the same architecture wins the regulatory conversation, even if the architectural insight came from elsewhere first.

This argues *against* the PM's "fix the lies and move on" framing and *for* deliberate sequencing of the implementation up to the architectural specification. The Tier 1-2 roadmap is the work that closes that gap on the user's behalf; if it doesn't get done, someone else's roadmap closes it on the user's behalf in the wrong way.

### C2. "Anyone can write a TypeScript prototype" — true but not load-bearing

The PM's observation is sociologically true and strategically misleading. It implies the implementation is fungible and the architecture is the unique asset. From a regulatory bar perspective the implementation is *also* unique — the specific implementation that gets audited, certified, and bound to insurance is the one that runs. "Anyone can build it" does not mean "anyone has built it"; the first conformant implementation has incumbent advantage in standard-setting bodies precisely because conformance test suites get written *to* it.

If the user accepts the PM's framing here, they accept a posture where engineering polish is treated as commodity work and architectural priority as the irreplaceable asset. That's a defensible position **only** if the project has the resources to keep the architecture moving faster than competitors can implement it. It's risky if the project's bandwidth is constrained.

### C3. "The auditor occasionally elides architecture-vs-codebase" — accept the framing critique, push back on the implication

The PM is right that my closing thesis elided the distinction (see A3). But I'd push back on the implication that the audit *should have* incorporated the architectural papers. An audit's discipline comes from evaluating what it can directly observe. Importing claims from outside the working directory would have made the audit weaker, not stronger — it would have replaced verifiable file:line citations with hearsay about documents I could not read. **The right response is to commission a separate architectural review** (the published papers vs. their internal coherence and external defensibility) and read the two reviews together. Conflating them into one document would have produced a worse artifact.

### C4. Reciprocal disclosure — soft spots in the PM's review

A few places where the PM's critique has its own asymmetries worth naming:

- **Information asymmetry.** The PM has read the architectural papers; I have not. Several of their pushbacks are warranted given what they know but unverifiable from my position. I cannot adjudicate the claim "the Helena_Telecom_North example is essentially a worked binding" without reading it. The user should treat the PM's claims about the architecture as informed by data outside this audit.
- **The "fix the lies and move on" recommendation under-prices regulatory risk.** A demonstrably broken reference implementation circulating publicly with the project's name on it does not get the benefit-of-the-doubt treatment from a regulator. The half-day audit a CISO consultant runs (the PM's own framing) does not stop to ask "is this the demonstration or the reference?" — it produces findings that travel to the procurement evaluation. The "demonstration" frame is internally meaningful but does not externalize.
- **The PM does not surface that their framing concedes the standard-setting position.** If the implementation is a demonstration and the architecture is the substrate, then *whoever ships the first conformant reference implementation owns the conformance test suite*. That party then defines what "conformant" means in the standards body. Conceding the implementation race is conceding standard-setting authority. The PM's analysis would be sharper for engaging this risk explicitly.
- **One claim of the PM's I would specifically challenge:** "The technical findings on the running code are, as far as I can tell, correct and material." Without seeing the audit's individual file:line citations re-verified independently, "as far as I can tell" is not a verification. The user should either independently spot-check (e.g., open `services/agent-os/src/index.ts:316-331` and read `commitLedgerEvent` themselves) or commission a second technical reader. The PM's ratification carries weight only to the extent they read the source.

## D. Net effect on the roadmap

After absorbing the PM's critique, the substantive amendments to Deliverable 4 are:

1. **New T1.0 — fail-closed audit trail.** Inserted ahead of T1.1. ~2 days work.
2. **Tier 1 closing thesis updated:** T1.0 + T1.1 + T1.2 are all co-load-bearing, not "T1.1 with supporting work."
3. **T1.7 timing:** start parallel with T1.1-T1.3, scoped as control-mapping not gap-finding.
4. **D4 §E "do not change" list:** add item 6 (meta-authority seed bootstrap pattern).
5. **D4 §F questions:** add question 6 (prototype-as-demonstration vs. prototype-as-reference).
6. **D4 §F question 4:** flag funding-model fork explicitly (open-spec implies foundation/services; closed implies enterprise-license).
7. **D4 T2.3:** flag bindings may be smaller than greenfield if architectural specs already exist.
8. **D4 closing thesis:** replace "the codebase is plausibly a substrate" with the architecture-vs-implementation distinction in A3.

The Tier ordering and the bulk of the technical work are unchanged. The PM's critique sharpens the framing and adds one cheap, high-priority item (T1.0); it does not falsify the underlying audit.

## E. Final synthesis

The PM and the audit are converging, not conflicting. We agree on the technical findings. We agree on most of Tier 1. We agree the conformance specification (T1.6) is a uniquely strategic non-code artifact. The remaining genuine disagreements are:

1. **Whether implementation rigor is commodity or load-bearing.** I treat it as load-bearing for regulatory standard-setting. The PM treats it as commodity-relative-to-the-architecture. This is a strategic judgment the user must make, and §F question 6 surfaces it.
2. **Whether the audit's scope (working directory only) was the right choice.** I argue yes — discipline of file:line citation. The PM implicitly argues an audit should incorporate the architectural prior art. We're both partly right; the resolution is two parallel reviews (codebase audit + architectural review), not one merged review.
3. **Whether SOC 2 readiness timing should be earlier or later.** I argue parallel-with-T1; the PM argues after-T1. The compromise (~30-day delay, scoped as control-mapping) is defensible to both.

Everything else is amendments to phrasing, priority, or surfaced choices. The audit's substantive findings stand.

---

**End of Addendum. The plan file now contains four deliverables, this addendum, and an updated roadmap. Awaiting next direction from the user.**

---

# ADDENDUM 2 — Cross-instance review reconciliation

A separate Claude instance reviewed the same codebase and surfaced five findings, then did its own re-verification. Cross-checking against this audit and against the source on disk:

### Status: nothing has been fixed since either review. Four of five findings overlap with this audit; one is more specific than I made it.

| Other-instance finding | Status now | Where it lives in this audit |
|---|---|---|
| 1. Gate is coordinator, not enforcer (booleans accepted from caller) | **Still true.** Verified at `services/execution-gate/src/index.ts:63-132` and `services/agent-os/src/index.ts:1166-1170` (tool-action path: all four booleans hardcoded `true`). | D1 §B8 ("inputs are caller-supplied booleans"); D1 §B9 step 7 ("identityLegitimate / authorityApproved are fixed in the source"); D3 §C3 ("Forge a witness receipt … forge an admissibility decision"). |
| 2. No canonical "S" state (separate kill-switch maps in kernel and gate; in-memory per-service Maps; TOCTOU exposure) | **Still true.** `services/governance-kernel/src/index.ts:11` and `services/execution-gate/src/index.ts:6` are independent variables; agent-os caches its own snapshot for 1s (`services/agent-os/src/index.ts:54, 477-494`). | D1 §B8 ("agent-os does not check the kernel's kill-switch state"); D1 §A.2 ("All authoritative state is in-process Maps"); cross-cutting #11 timing window. |
| 3. Determinism — `Math.random()` IDs, wall-clock timestamps | **Still true.** `services/governance-kernel/src/lib.ts:18-19`; identical `lib.ts` in all 10 services (md5 confirmed identical earlier). | D1 §A.1 ("Math.random()… used for warrant IDs, decision IDs, finality-certificate IDs, ledger event IDs"); D4 T1.5 (replace with `crypto.randomUUID()`). |
| 4. No invariant enforcement — `evaluate-admissibility` returns `admissible: true` whenever kill-switch inactive; envelope `constraints` stored but never evaluated | **Still true.** `services/governance-kernel/src/index.ts:128-144`. | D1 §B1 ("there is no actual policy evaluation. The policyCompileId parameter is accepted but unused"). |
| 5. Action/provenance binding — ledger signs its own reconstruction; `admissibilityHash` is non-cryptographic; witness accepts caller-supplied array; no prevHash chain | **Partially addressed (per-artifact Ed25519/HMAC), still weak overall.** | D1 §B3 (ledger-signs-reconstruction, no chain); D1 §B7 (witness array length); D2 §H2 (no chain, no anchor). **Specific to flag:** the `admissibilityHash` plaintext-base64 weakness (`services/governance-kernel/src/index.ts:119`) is *not* named explicitly in the rest of this audit. It should be — see below. |

### One finding the other instance named that this audit did not isolate

**`admissibilityHash` is not a hash.** `services/governance-kernel/src/index.ts:119` constructs:
```
admissibilityHash: `adm-${Buffer.from(`${envelope.id}:${missionId}:${targetNode}`).toString("base64").slice(0, 16)}`
```
This is base64 of three plaintext strings, truncated to 16 chars. No key, no hash function, no nonce. Any caller who knows `(envelopeId, missionId, targetNode)` can reproduce the value byte-for-byte. The field is consumed downstream as if it were a cryptographic commitment, and it isn't. The fix is one line: replace with `createHmac("sha256", admissibilityKey).update(canonical).digest("hex")` or similar.

**Roadmap impact.** Add to T1.5 the explicit one-line item: "Replace `admissibilityHash` (`services/governance-kernel/src/index.ts:119`) with a keyed HMAC-SHA-256 of canonical inputs. ~30 minutes." This belongs in T1.5 (structural correctness defects), not T1.1 (chained ledger).

### Where the other instance's framing is sharper than mine

- **"Canonical S state"** is a more useful single-phrase concept than my "in-memory per-service Maps with TOCTOU exposure." A regulator can hold the phrase "canonical state" and use it to ask "show me the canonical state machine and its consistency proof." That's a more actionable framing than mine. Worth adopting in any future spec work.
- **"The gate is acting like a coordinator, not an enforcement boundary"** crystallizes D3 §B better than my "the boundary is a notarization, not a verifier" — same point, more visible to a non-cryptographer reader.

### Where this audit goes deeper than the other instance's review

- **Adversary classes** (D3 §C). The other instance's review is structural; D3 enumerates seven specific adversaries and what each can or cannot do.
- **Conformance gap matrix** (D2 §I). Maps every weakness to a NIST/ISO/EU/insurance control with effort and priority.
- **Sequenced roadmap with co-load-bearing items** (D4 + Addendum §A2). The other instance's review is "things to fix" without a sequencing argument.
- **Architecture-vs-implementation distinction** (Addendum §A3). Specific to this audit's reckoning with the AI PM's pushback.

### Net

All five of the other instance's structural findings remain accurate. None have been fixed in the codebase since their original review. The single new contribution from cross-checking is the explicit `admissibilityHash` weakness, which is a one-line T1.5 fix. The two reviews are converging on the same diagnosis — which is itself useful: independent reviews of the same surface arriving at the same five concerns is harder to dismiss as one auditor's opinion.

---

**End of Addendum 2. Plan file now contains four deliverables and two addenda. Awaiting next direction from the user.**

---

# DELIVERABLE 5 — TIER 1 IMPLEMENTATION SPECS

Concrete TypeScript-level designs for the Tier 1 work. Per item: scope (what file/line changes), code shape (what the new code looks like), new env / schema, migration notes, and test points.

**Sequencing.** T1.5 (correctness defects) ships **first** — it is one to two days of work and removes the most embarrassing items from a code review. T1.0 (fail-closed trail) ships next; without it, T1.1 records over an incomplete log. T1.1 (chained ledger) and T1.2 (operator-side signing) are co-load-bearing and can ship in parallel by separate engineers. T1.3 (service-to-service mTLS) is sized separately; it is independent of the four below and a clean fit for an SRE rather than an applications engineer.

**Scope discipline.** This deliverable is the spec, not the code. It is meant to hand to an engineer (or a future Claude session) and produce working code. Architectural decisions are made; bikeshedding (variable names, exact module boundaries) is not.

---

## T1.5 — Correctness defects (S, ~3-5 days, ship first)

Nine items. Each is independent and can be a separate commit.

### T1.5.1 — Replace `Math.random()` IDs with `crypto.randomUUID()`

**File:** `services/governance-kernel/src/lib.ts:19` (and 9 identical copies). The shared `lib.ts` is byte-identical across all 10 services (md5 verified earlier).

**Current:**
```typescript
export const id = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
```

**New:**
```typescript
import { randomUUID } from "node:crypto";
export const id = (prefix: string) => `${prefix}-${randomUUID()}`;
```

**Why this shape:** Full UUID instead of 8-char prefix. The 8-char `Math.random()` space is 36⁸ ≈ 2.8 trillion, but birthday-bound collision becomes nontrivial at ~1.7M IDs. Full UUIDs cost 32 extra chars per artifact and remove the question. Audit logs are not bandwidth-constrained.

**Migration:** No backward-compat concern. Existing IDs in persisted state remain valid (they are opaque strings).

**Test point:** Generate 1M IDs in a loop, assert no collisions.

### T1.5.2 — Replace `admissibilityHash` plaintext-base64 with keyed HMAC

**File:** `services/governance-kernel/src/index.ts:119`.

**Current:**
```typescript
admissibilityHash: `adm-${Buffer.from(`${envelope.id}:${missionId}:${targetNode}`).toString("base64").slice(0, 16)}`,
```

**New:**
```typescript
import { createHmac } from "node:crypto";
const admissibilitySecret = process.env.ADMISSIBILITY_HMAC_SECRET?.trim();
if (!admissibilitySecret) {
  throw new Error("ADMISSIBILITY_HMAC_SECRET is required.");
}
// ...inside the warrant builder:
admissibilityHash: `adm-${createHmac("sha256", admissibilitySecret)
  .update([envelope.id, missionId, targetNode, agentId ?? "", deviceId ?? ""].join("\x00"))
  .digest("hex")}`,
```

**Why this shape:** HMAC binds the hash to a server-side key; null-byte separator prevents canonicalization ambiguity (`a:b` vs `a` + `b:` confusion); include `agentId` and `deviceId` so the hash depends on every dispatch-time variable, not just three.

**New env var:**
```
# .env.example
ADMISSIBILITY_HMAC_SECRET=
# .env.production.example  
ADMISSIBILITY_HMAC_SECRET=<32-byte-random>
```

**Preflight:** Add to `adapters/http-gateway/src/preflight.ts:13-94` a check `admissibility-hmac-secret` that fails in production when unset. Add the same check to `scripts/validate-enterprise-config.mjs:50-117`.

**Migration:** None — existing warrants in memory are lost on restart anyway (kernel doesn't persist).

**Test point:** Two warrants with identical inputs but different secrets → different hashes; identical inputs and same secret → identical hashes.

### T1.5.3 — Make `governance-kernel` fail-closed on registry-unreachable

**File:** `services/governance-kernel/src/index.ts:71-98`.

**Current (fail-open):**
```typescript
const registry = await fetch(`${registryBase}/resolve`, {...})
  .then(r => r.json())
  .catch(() => ({ allowed: true, chain: ["maa-root-001"], explanation: "local fallback" }));
```

**New:**
```typescript
const kernelFailClosed = (process.env.KERNEL_FAIL_CLOSED ?? "true") !== "false";

const registry = await fetch(`${registryBase}/resolve`, {...})
  .then(r => r.json())
  .catch((error) => {
    if (kernelFailClosed) {
      throw Object.assign(new Error("registry_unavailable"), { cause: error, status: 503 });
    }
    return { allowed: true, chain: ["maa-root-001"], explanation: "local fallback" };
  });
```

**Wrap the route handler** (line 71) so the throw maps to `res.status(503).json({ error: "registry_unavailable" })`.

**Why this shape:** Default-on (`KERNEL_FAIL_CLOSED=true` unless explicitly disabled). Production preflight should refuse to boot with `KERNEL_FAIL_CLOSED=false`. Local development can keep the legacy fallback by setting `KERNEL_FAIL_CLOSED=false` in `.env`.

**New env var:** `KERNEL_FAIL_CLOSED` (default true). Add to `.env.example` and the preflight check.

**Test point:** With `KERNEL_FAIL_CLOSED=true`, kill the registry process, call `/validate-envelope` → 503. With `KERNEL_FAIL_CLOSED=false`, same setup → 200 with `local fallback` explanation.

### T1.5.4 — Add `authority-router` to gateway `/health`

**File:** `adapters/http-gateway/src/index.ts:628-637`.

**Current:**
```typescript
const services = await Promise.allSettled([
  call(governanceKernelBase, "/health"),
  call(policyCompilerBase, "/health"),
  call(evidenceLedgerBase, "/health"),
  call(metaAuthorityRegistryBase, "/health"),
  call(simulationEngineBase, "/health"),
  call(witnessServiceBase, "/health"),
  call(executionGateBase, "/health"),
  call(agentOsBase, "/health")
]);
```

**New:** insert one line for `authorityRouterBase`:
```typescript
const services = await Promise.allSettled([
  call(governanceKernelBase, "/health"),
  call(policyCompilerBase, "/health"),
  call(evidenceLedgerBase, "/health"),
  call(metaAuthorityRegistryBase, "/health"),
  call(simulationEngineBase, "/health"),
  call(authorityRouterBase, "/health"),  // ← add
  call(witnessServiceBase, "/health"),
  call(executionGateBase, "/health"),
  call(agentOsBase, "/health")
]);
```

**Test point:** `validate-stack.mjs` extended to assert exactly 9 entries in `services[]`.

### T1.5.5 — Always invoke witness for completion (or change README)

**File:** `services/agent-os/src/index.ts:1485-1488`.

**Current:** witness is invoked only for `mission.riskLevel === "high"`.

**Decision:** README implies witness on every governed completion. Two options:
- **(A)** Match the README — always witness on completion. The witness service is a stub today (D1 §B7); always-witness on a stub is cheap; when the witness is replaced in T2.1, the obligation is correctly aligned.
- **(B)** Document the conditional in conformance spec, update README to match.

**Recommendation: (A).** It is the smaller change, aligns existing docs to existing code intent, and makes T2.1 a simpler swap.

**New code:**
```typescript
const witnessRequired = true; // was: mission.riskLevel === "high"
```

Or env-gated for a transition:
```typescript
const witnessAlwaysRequired = (process.env.WITNESS_ALWAYS_REQUIRED ?? "true") !== "false";
const witnessRequired = witnessAlwaysRequired || mission.riskLevel === "high";
```

**Test point:** Create a `medium`-risk mission, advance to completion, assert a `WitnessReceipt` artifact appears in the ledger for the finalization event.

### T1.5.6 — Replace destructive-action regex with allow-list

**File:** `services/agent-os/src/index.ts:711-725` (`isPotentiallyDestructivePayload`).

**Current:** regex deny-list (`/\b(rm|del|...)\b/`). Trivially evaded by encoding.

**New:**
```typescript
const ALLOWED_TOOL_ACTION_KINDS = new Set([
  "read", "list", "compile", "replay", "policy-eval", "ledger-query", "schema-validate"
] as const);

const isAllowedToolActionKind = (kind: unknown): kind is typeof ALLOWED_TOOL_ACTION_KINDS extends Set<infer T> ? T : never =>
  typeof kind === "string" && ALLOWED_TOOL_ACTION_KINDS.has(kind as any);
```

Replace every callsite of `isPotentiallyDestructivePayload(payload)` (line 1005, 1039) with the inverse predicate `!isAllowedToolActionKind(action.kind)`. The check moves from "deny if dangerous" to "deny by default; allow specific kinds." `shell`, `edit`, `write` are *not* in the allow-list — they require explicit governance and a special pathway, not regex inspection.

**Why this shape:** Allow-list reverses the security default. The current code makes "anything not matching the regex" allowed by default; the new code makes "anything not in the explicit set" rejected by default.

**Migration:** Existing missions that propose `shell`/`edit`/`write` actions will now be blocked. This is the correct behavior — they should require operator approval and that pathway needs to be designed (Tier 2).

**Test point:** Propose a tool action with `kind: "shell"` → rejected. Propose `kind: "read"` → governance pipeline runs.

### T1.5.7 — Kill-switch cache flag for production

**File:** `services/agent-os/src/index.ts:54` (declaration), `services/agent-os/src/index.ts:477-494` (`readKillSwitchState`).

**Current:** 1-second cache (`AGENT_OS_KILL_SWITCH_CACHE_MS = 1000`).

**Change:** No code change. The env var already exists. Add to `.env.production.example`:
```
AGENT_OS_KILL_SWITCH_CACHE_MS=0
```
Document in `CLAUDE.md` and the deployment runbook that production must set this to 0.

**Test point:** With `AGENT_OS_KILL_SWITCH_CACHE_MS=0`, flip kill-switch via gateway, immediately attempt task dispatch → blocked. With `1000`, repeat → may succeed within the cache window.

### T1.5.8 — Wire Zod schemas into all request handlers

**Files:** every `src/index.ts` for the 10 services.

**Pattern:**
```typescript
import { z } from "zod";
import { authorityEnvelopeSchema, executionWarrantSchema } from "@aristotle/shared-schemas";

// Convert the JSON Schema in shared-schemas to a runtime Zod schema, OR
// (recommended) re-author shared-schemas as native Zod from the start.

const validateEnvelopeBodySchema = z.object({
  actor: z.string().min(1),
  issuer: z.string().min(1),
  domain: z.string().min(1),
  // ... full body shape
});

app.post("/validate-envelope", async (req, res) => {
  const parsed = validateEnvelopeBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
  }
  const body = parsed.data;
  // ...
});
```

**Scope of change:** ~40 route handlers across 10 services. ~1 day work per service if shared-schemas needs Zod conversion; ~3 hours per service if existing JSON Schema is reused via `zod-from-json-schema`.

**Recommendation:** Re-author `shared/schemas/src/index.ts:1-87` as native Zod schemas. The existing JSON-Schema-as-const literals were never actually validated against; ripping them out for Zod is net simplification.

**Test point:** POST malformed body → 400 with `issues` array.

### T1.5.9 — Rate-limit at the gateway

**File:** `adapters/http-gateway/src/index.ts:5-7` (around `app` creation).

**New dependency:** `express-rate-limit` (~1KB, no transitive concerns).

**New code:**
```typescript
import rateLimit from "express-rate-limit";

const operatorLimiter = rateLimit({
  windowMs: 60_000,
  max: Number(process.env.OPERATOR_RATE_LIMIT ?? 100),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => readOperatorActor(req, req.ip ?? "anonymous"),
  skip: (req) => req.path === "/health" || req.path.startsWith("/operator/auth/session")
});

app.use("/operator", operatorLimiter);
```

**Why this shape:** Limiter keyed by *actor* (with IP fallback), so legitimate multi-actor traffic doesn't collide. `/health` and session-mint endpoint exempted. Default 100 req/min/actor; override via `OPERATOR_RATE_LIMIT` env.

**Test point:** Burst 200 requests in 60s as one actor → 100 succeed, 100 receive 429.

---

## T1.0 — Fail-closed audit trail (S, ~2 days)

**Problem.** `services/agent-os/src/index.ts:316-331` (`commitLedgerEvent`) silently swallows fetch errors. Mission state advances even when the ledger is unreachable. Audit trail is fail-open: deniably incomplete with no gap detection.

**Approach.** Two-tier configuration: development stays best-effort; production requires fail-closed.

### Code change

**File:** `services/agent-os/src/index.ts:316-331`.

**New:**
```typescript
const ledgerAvailability = (process.env.LEDGER_AVAILABILITY ?? "best-effort") as
  | "best-effort"
  | "required";

class LedgerUnavailableError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "LedgerUnavailableError";
  }
}

const commitLedgerEvent = async (
  missionId: string,
  eventKind: string,
  payload: Record<string, unknown>
): Promise<void> => {
  try {
    const response = await fetch(`${ledgerBase}/events/commit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actor: "agent-os",
        eventKind,
        traceId: missionId,
        payload
      })
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const error = new LedgerUnavailableError(
        `ledger commit failed: ${response.status} ${body}`
      );
      if (ledgerAvailability === "required") throw error;
      console.error("agent-os ledger commit failed (best-effort)", error);
    }
  } catch (error) {
    if (error instanceof LedgerUnavailableError) throw error;
    if (ledgerAvailability === "required") {
      throw new LedgerUnavailableError(
        "ledger unreachable",
        error
      );
    }
    console.error("agent-os ledger commit failed (best-effort)", error);
  }
};
```

### Route handler integration

Every route in agent-os that mutates state and calls `commitLedgerEvent` needs to surface the throw. The pattern is **commit-first** for state-changing routes:

**Before (current pattern):**
```typescript
app.post("/missions/:missionId/advance", async (req, res) => {
  const mission = missions.get(req.params.missionId);
  // ... mutation happens
  await commitLedgerEvent(...);  // ← silently fails, mutation persists
  res.json(...);
});
```

**After (fail-closed pattern):**
```typescript
app.post("/missions/:missionId/advance", async (req, res) => {
  try {
    // ... compute next state, but don't mutate yet
    await commitLedgerEvent(...);  // ← throws if required+unavailable
    // ... now apply the mutation
  } catch (error) {
    if (error instanceof LedgerUnavailableError) {
      return res.status(503).json({
        error: "ledger_unavailable",
        message: "Cannot advance mission while audit trail is unavailable."
      });
    }
    throw error;
  }
});
```

**Realistic constraint.** `agent-os/src/index.ts` has ~25 callsites of `commitLedgerEvent`. Restructuring each to commit-first is non-trivial because some events describe completion (e.g., `agent-os.execution.task.completed` after `executionTasks.set(...)`).

**Pragmatic alternative for Tier 1:** keep current commit-after pattern but add a top-level handler that:
1. Detects `LedgerUnavailableError`.
2. Reverses the in-memory mutation if a snapshot is available.
3. Returns 503.

**Recommended for Tier 1:** the simpler pattern where:
1. Each route captures the pre-mutation state via shallow Map snapshot.
2. After mutation + commit attempt, on `LedgerUnavailableError`, restore from snapshot.
3. This is brittle but correct enough until Tier 2 introduces append-log semantics with proper transactional boundaries.

A worked example (`/missions/:missionId/advance`):
```typescript
app.post("/missions/:missionId/advance", async (req, res) => {
  const mission = missions.get(req.params.missionId);
  if (!mission) return res.status(404).json({ error: "mission_not_found" });

  const snapshot = {
    mission: { ...mission },
    workspace: findMissionWorkspace(mission.id) ? { ...findMissionWorkspace(mission.id)! } : undefined,
    tasks: missionTasks(mission.id).map(t => [t.id, { ...t }] as const),
  };

  try {
    await progressExecutionLoop(mission, req.body.action ?? "progress");
    // ... existing flow including commitLedgerEvent calls
  } catch (error) {
    if (error instanceof LedgerUnavailableError) {
      // Roll back
      missions.set(snapshot.mission.id, snapshot.mission);
      if (snapshot.workspace) workspaces.set(snapshot.workspace.id, snapshot.workspace);
      for (const [id, task] of snapshot.tasks) executionTasks.set(id, task);
      return res.status(503).json({ error: "ledger_unavailable" });
    }
    throw error;
  }

  // ... rest of handler
});
```

**Honest disclosure.** This rollback is best-effort. A determined adversary can race the rollback against a concurrent request. Tier 2's append-log primitive eliminates this whole class of issue. The point of Tier 1 is to fail-stop the **common-case** ledger outage, not to be Byzantine-tolerant.

### Preflight gate

**File:** `adapters/http-gateway/src/preflight.ts`.

**New check:**
```typescript
const ledgerAvailability = (process.env.LEDGER_AVAILABILITY ?? "best-effort").trim();
checks.push({
  name: "ledger-availability",
  status: mode === "production" && ledgerAvailability !== "required" ? "fail" : "pass",
  detail:
    ledgerAvailability === "required"
      ? "Ledger availability is required (fail-closed)."
      : mode === "production"
        ? "Production boot requires LEDGER_AVAILABILITY=required."
        : `Ledger availability is ${ledgerAvailability}.`
});
```

### Test point

- Stop evidence-ledger; with `LEDGER_AVAILABILITY=required`, call any agent-os mutating endpoint → 503; query state, verify no mutation persisted.
- With `LEDGER_AVAILABILITY=best-effort`, same setup → 200; mutation persists; ledger has a gap.

---

## T1.1 — Append-only chained ledger with external anchor (M, ~3-6 weeks)

**Problem.** `services/evidence-ledger/src/index.ts:80-90` rewrites the entire JSON on every commit. No hash chain. Per-artifact signatures don't link events. No external anchor. Tamper-evidence is absent.

### Schema additions

**File:** `shared/types/src/index.ts:156-162` (`ReplayEvent`).

**New fields:**
```typescript
export interface ReplayEvent extends BaseArtifact {
  artifactType: "replay-event";
  eventKind: string;
  committed: boolean;
  branchId?: string;
  payload: Record<string, unknown>;
  // ADDED:
  sequence: number;            // monotonic, gap-free, starts at 0
  prevHash: string;            // hex sha256 of previous event's eventHash; "0".repeat(64) for first
  eventHash: string;           // hex sha256 of canonical(this event without eventHash)
}
```

**New artifact type:**
```typescript
export interface MerkleAnchorArtifact extends BaseArtifact {
  artifactType: "merkle-anchor";
  rootHash: string;            // hex sha256 — Merkle root over events [batchStart..batchEnd]
  batchStart: number;          // first sequence number in batch
  batchEnd: number;            // last sequence number in batch
  tsaToken?: string;           // base64 RFC 3161 TSA token
  rekorUuid?: string;          // Sigstore Rekor entry UUID
  anchoredAt: string;
}
```

Add `"merkle-anchor"` to the `ArtifactType` union (`shared/types/src/index.ts:1-15`).

### Storage layer

**New file:** `services/evidence-ledger/src/chain.ts`.

**Backend abstraction:**
```typescript
export interface ChainBackend {
  append(record: string): Promise<void>;       // newline-terminated
  readAll(): AsyncIterable<string>;
  readSince(sequence: number): AsyncIterable<string>;
}

export class JsonlFileBackend implements ChainBackend {
  constructor(private filePath: string) {}
  async append(record: string): Promise<void> {
    // Open in 'a' mode, write `${record}\n`, fsync, close.
    // The fsync is the key durability primitive.
  }
  async *readAll(): AsyncIterable<string> {
    // Stream-line-read; yields one record per line.
  }
  // ...
}

// Future: S3ObjectLockBackend, QldbBackend (Tier 2)
```

**Why JSONL:**  one line per record, append-only at OS level (just write bytes), survives partial writes (recovery scans for the last fully-formed JSON object), grep-friendly for debugging. Anchoring to S3 Object Lock is a Tier-2 concern; getting the chain right at the file level first.

### Chain writer

**New file:** `services/evidence-ledger/src/chain-writer.ts`.

```typescript
import { createHash } from "node:crypto";
import { canonical } from "./canonical.js";  // stableJson, but without the signature/digest exclusion

interface ChainState {
  sequence: number;
  lastEventHash: string;       // "0".repeat(64) for genesis
  pendingBatch: ReplayEvent[];
  batchStartSequence: number;
}

const ZERO_HASH = "0".repeat(64);

export class ChainWriter {
  private state: ChainState;
  private mu: Promise<void> = Promise.resolve();   // mutex

  constructor(private backend: ChainBackend, initialState?: ChainState) {
    this.state = initialState ?? {
      sequence: 0,
      lastEventHash: ZERO_HASH,
      pendingBatch: [],
      batchStartSequence: 0
    };
  }

  async append(eventInput: Omit<ReplayEvent, "sequence" | "prevHash" | "eventHash">): Promise<ReplayEvent> {
    return this.serialized(async () => {
      const partial = {
        ...eventInput,
        sequence: this.state.sequence,
        prevHash: this.state.lastEventHash,
      };
      const eventHash = createHash("sha256").update(canonical(partial)).digest("hex");
      const event: ReplayEvent = { ...partial, eventHash };

      await this.backend.append(JSON.stringify(event));
      this.state.sequence += 1;
      this.state.lastEventHash = eventHash;
      this.state.pendingBatch.push(event);
      return event;
    });
  }

  async closeBatch(anchorFn: (rootHash: string, batch: ReplayEvent[]) => Promise<{ tsaToken?: string; rekorUuid?: string }>): Promise<MerkleAnchorArtifact | null> {
    return this.serialized(async () => {
      if (this.state.pendingBatch.length === 0) return null;
      const rootHash = merkleRoot(this.state.pendingBatch.map(e => e.eventHash));
      const { tsaToken, rekorUuid } = await anchorFn(rootHash, this.state.pendingBatch);
      const anchor: MerkleAnchorArtifact = {
        id: id("anchor"),
        artifactType: "merkle-anchor",
        timestamp: now(),
        actor: "evidence-ledger",
        rootHash,
        batchStart: this.state.batchStartSequence,
        batchEnd: this.state.sequence - 1,
        tsaToken,
        rekorUuid,
        anchoredAt: now()
      };
      // The anchor is itself a ReplayEvent in the chain
      await this.append({
        ...anchor,
        eventKind: "ledger.anchor.published",
        committed: true,
        payload: { anchor }
      } as any);
      this.state.pendingBatch = [];
      this.state.batchStartSequence = this.state.sequence;
      return anchor;
    });
  }

  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.mu.then(() => fn());
    this.mu = next.then(() => undefined, () => undefined);
    return next;
  }
}

function merkleRoot(leaves: string[]): string {
  if (leaves.length === 0) return ZERO_HASH;
  let level = leaves.map(h => Buffer.from(h, "hex"));
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] ?? level[i];  // duplicate last on odd
      next.push(createHash("sha256").update(Buffer.concat([left, right])).digest());
    }
    level = next;
  }
  return level[0].toString("hex");
}
```

### Anchor client

**New file:** `services/evidence-ledger/src/anchor.ts`.

```typescript
import { createHash } from "node:crypto";

export async function anchorViaTsaAndRekor(rootHash: string): Promise<{ tsaToken?: string; rekorUuid?: string }> {
  const tsaUrl = process.env.LEDGER_TSA_URL?.trim();
  const rekorUrl = process.env.LEDGER_REKOR_URL?.trim() ?? "https://rekor.sigstore.dev";

  const tsaToken = tsaUrl ? await tsaTimestamp(tsaUrl, rootHash) : undefined;
  const rekorUuid = await rekorPublish(rekorUrl, rootHash);

  return { tsaToken, rekorUuid };
}

async function tsaTimestamp(tsaUrl: string, rootHashHex: string): Promise<string> {
  // RFC 3161 TimeStampReq: ASN.1 DER. Use a small library (e.g. node-rfc3161) or hand-roll.
  // Returns base64 of the TimeStampToken.
  // ... implementation
}

async function rekorPublish(rekorUrl: string, rootHashHex: string): Promise<string> {
  // POST a Sigstore intoto/hashedrekord entry to /api/v1/log/entries
  // Returns the entry UUID.
  // ... implementation
}
```

**Library choices:**
- TSA: `node-rfc3161` or roll-your-own ~80 LOC for the ASN.1.
- Rekor: `@sigstore/rekor-types` for types; bare `fetch` for the POST.

### Wire into evidence-ledger

**File:** `services/evidence-ledger/src/index.ts`.

**Replace** the `committed: ReplayEvent[]` array (line 68), `schedulePersist` (line 80-90), and `loadState` (line 92-115) with `ChainWriter` + `JsonlFileBackend` + a periodic anchor task.

**New env vars:**
```
LEDGER_BACKEND=jsonl                  # jsonl|s3-object-lock (s3 is Tier 2)
LEDGER_CHAIN_PATH=./data/ledger.jsonl
LEDGER_ANCHOR_INTERVAL_MS=60000       # close batch + anchor every minute
LEDGER_ANCHOR_BATCH_MAX=1000          # ...or every K events, whichever comes first
LEDGER_TSA_URL=https://timestamp.digicert.com
LEDGER_REKOR_URL=https://rekor.sigstore.dev
```

**New routes:**
- `GET /verify` — walks the chain, recomputes prevHash + eventHash for every event, recomputes Merkle roots for every anchor, verifies TSA tokens, verifies Rekor inclusion proofs. Returns `{ ok: true, sequence, anchorsVerified }` or `{ ok: false, brokenAt: number, reason: string }`.
- `GET /anchors` — returns all `merkle-anchor` artifacts.

**Existing routes preserved:** `GET /replay`, `GET /timeline`, `GET /artifacts`, `POST /events/commit` continue to work — the writer is internal.

### Migration from existing state

**One-shot script:** `scripts/migrate-ledger-to-chain.mjs`.

```javascript
// 1. Read existing data/evidence-ledger.json (current 16.7 MB state).
// 2. For each committed event, append to data/ledger.jsonl with:
//    - sequence: incrementing from 0
//    - prevHash: rolling
//    - eventHash: computed
// 3. Append a final genesis-anchor that brackets [0..N-1] without external TSA/Rekor 
//    (this anchor is "imported from legacy state on date X"; not externally anchored;
//    documented as such in the spec).
// 4. From here forward, all new events go through ChainWriter and get anchored.
```

**Known limitation:** The legacy events lack genuine `prevHash` linkage to their original commit time. The migration produces a *retroactive* chain. This is honest about its limitation: the chain proves no tampering since migration; it does not prove no tampering before migration.

**Strategic note for the spec.** The Conformance Specification (T1.6) should explicitly state: "Pre-migration events are imported with retroactive chaining and are not externally anchored. Their integrity is asserted by the operator's custodian declaration, not by the chain. Post-migration events are externally anchored."

### Test points

- Append 10K events; tail-truncate the file mid-event; restart; verify recovery scans to last full record and continues.
- Insert a tampered event into the JSONL by hand; call `GET /verify` → returns `{ ok: false, brokenAt: <seq> }`.
- Anchor publishes; pull the Rekor entry by UUID; verify the recorded root matches.
- Close batch, then continue appending; `GET /verify` walks across the anchor boundary correctly.

---

## T1.2 — Operator-side signing of mutating actions (M, ~3-4 weeks)

**Problem.** `actor` field on operator-issued events is a client-controlled string. The HMAC session token authenticates "someone with the API key produced this request" but does not bind the request body to an operator-controlled key.

### Schema additions

**File:** `shared/types/src/index.ts`.

**New artifact type:**
```typescript
export interface OperatorRegistration extends BaseArtifact {
  artifactType: "operator-registration";
  operatorId: string;          // stable identifier (e.g. "operator-pepper")
  publicKey: { kty: "OKP"; crv: "Ed25519"; x: string };  // JWK form
  algorithm: "ed25519";
  status: "active" | "revoked";
  registeredBy: string;        // admin operatorId who registered this one
  notValidBefore: string;
  notValidAfter?: string;
}
```

Add `"operator-registration"` to the `ArtifactType` union.

### Server-side verifier

**New file:** `adapters/http-gateway/src/operator-signing.ts`.

```typescript
import { verify, createPublicKey } from "node:crypto";

export interface OperatorSignedRequest {
  operatorId: string;
  signature: string;       // base64url Ed25519
  nonce: string;           // 32-byte random hex
  timestamp: number;       // ms since epoch
}

const operatorRegistrations = new Map<string, OperatorRegistration>();
const recentNonces = new Map<string, number>();   // nonce -> firstSeenAt
const NONCE_TTL_MS = 600_000;                     // 10 min

export async function verifyOperatorSigned(req: Request): Promise<{ ok: true; operatorId: string } | { ok: false; error: string }> {
  const operatorId = req.header("x-operator-id")?.trim();
  const signatureB64 = req.header("x-operator-signature")?.trim();
  const nonce = req.header("x-operator-nonce")?.trim();
  const timestampStr = req.header("x-operator-timestamp")?.trim();

  if (!operatorId || !signatureB64 || !nonce || !timestampStr) {
    return { ok: false, error: "operator_signature_missing" };
  }
  const timestamp = Number(timestampStr);
  if (!Number.isFinite(timestamp)) return { ok: false, error: "operator_timestamp_invalid" };

  const skew = Math.abs(Date.now() - timestamp);
  if (skew > 300_000) return { ok: false, error: "operator_timestamp_skew" };

  if (recentNonces.has(nonce)) return { ok: false, error: "operator_nonce_replay" };

  const reg = operatorRegistrations.get(operatorId);
  if (!reg || reg.status !== "active") return { ok: false, error: "operator_unknown_or_revoked" };

  const canonical = JSON.stringify({
    method: req.method,
    path: req.path,
    body: req.body ?? null,
    nonce,
    timestamp,
    operatorId
  });

  const pubKey = createPublicKey({ key: reg.publicKey, format: "jwk" });
  const verified = verify(
    null,
    Buffer.from(canonical, "utf8"),
    pubKey,
    Buffer.from(signatureB64, "base64url")
  );
  if (!verified) return { ok: false, error: "operator_signature_invalid" };

  recentNonces.set(nonce, Date.now());
  pruneOldNonces();
  return { ok: true, operatorId };
}

function pruneOldNonces() {
  const now = Date.now();
  for (const [n, t] of recentNonces) {
    if (now - t > NONCE_TTL_MS) recentNonces.delete(n);
  }
}
```

### Middleware integration

**File:** `adapters/http-gateway/src/index.ts:553-623`.

After session validation passes, **for non-`GET`/`HEAD` requests**, also require operator signing:

```typescript
const operatorSigningEnforcement =
  process.env.OPERATOR_SIGNING_ENFORCEMENT === "true";

app.use("/operator", async (req, res, next) => {
  // ... existing session/api-key middleware

  if (operatorSigningEnforcement && !isReadMethod(req.method) && req.path !== "/auth/session") {
    const result = await verifyOperatorSigned(req);
    if (!result.ok) {
      return res.status(401).json({ error: result.error });
    }
    // Stash operatorId for downstream handlers
    (req as any).verifiedOperatorId = result.operatorId;
  }
  next();
});
```

### Capture the signature in the ledger

Modify `readOperatorActor` (line 176-181) to prefer the cryptographically verified `req.verifiedOperatorId` over header/body. Modify the ledger commits in mutating routes (e.g., `/operator/os/missions`, line 879; `/operator/kill-switch`, line 920) to include the full signature material:

```typescript
const ledgerActor = (req as any).verifiedOperatorId ?? readOperatorActor(req);
const operatorSignature = operatorSigningEnforcement
  ? {
      signature: req.header("x-operator-signature"),
      nonce: req.header("x-operator-nonce"),
      timestamp: Number(req.header("x-operator-timestamp")),
      algorithm: "ed25519"
    }
  : undefined;

await call(evidenceLedgerBase, "/events/commit", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    actor: `operator:${ledgerActor}`,
    eventKind: "...",
    traceId: ...,
    payload: { ..., operatorSignature }
  })
});
```

### Browser-side signing

**File:** `apps/console-ui/src/gateway-client.ts`.

**MVP approach:** software Ed25519 key in IndexedDB (not localStorage — IndexedDB allows non-extractable WebCrypto keys).

```typescript
// On first launch:
//   1. generate Ed25519 keypair via crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign"])
//   2. export public key as JWK
//   3. operator signs in via existing API-key flow once
//   4. operator visits /admin/register-self with the JWK
//   5. an existing admin approves the OperatorRegistration; the new operator is now in the registry

// On every mutating request:
async function signedFetch(method: string, path: string, body: unknown) {
  const nonce = arrayBufferToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const timestamp = Date.now();
  const operatorId = currentOperatorId;
  const canonical = JSON.stringify({ method, path, body: body ?? null, nonce, timestamp, operatorId });
  const sig = await crypto.subtle.sign(
    "Ed25519",
    operatorSigningKey,
    new TextEncoder().encode(canonical)
  );
  const headers = new Headers({
    "content-type": "application/json",
    "x-operator-id": operatorId,
    "x-operator-signature": arrayBufferToBase64Url(sig),
    "x-operator-nonce": nonce,
    "x-operator-timestamp": String(timestamp)
  });
  return fetch(path, { method, headers, body: JSON.stringify(body) });
}
```

**WebAuthn upgrade path** documented but deferred to Tier 2. Hardware-backed key is meaningfully better (resistant to malware on operator's machine), but the MVP works without it.

### Bootstrap problem

The first operator can't be registered by an existing operator (chicken-and-egg). Solution: a `BOOTSTRAP_OPERATOR_PUBKEY_PATH` env var, read at gateway boot, that hard-codes the first operator's public key. Equivalent to a root CA bootstrap.

### Test points

- Sign a request; verify; assert success.
- Replay the same signed request → 401 (`operator_nonce_replay`).
- Modify the body without re-signing → 401 (`operator_signature_invalid`).
- Wait 10 minutes; replay nonce-purged → 401 (`operator_timestamp_skew`).
- Revoke an operator (status=revoked); assert subsequent signed requests fail.

---

## D. What this Tier 1 delivers when shipped

After T1.5 + T1.0 + T1.1 + T1.2 (and T1.3 mTLS done by SRE in parallel):

- AU-9: ledger is append-only with hash chain and external anchor. **Closed.**
- AU-10: operator actions are signed by operator-controlled keys. **Closed.**
- The two co-load-bearing items (T1.1 and T1.2) ship together. The chain is over a complete, fail-closed log (T1.0). The events in the chain bind to authenticated operators (T1.2).
- The "amateur" surface is gone (T1.5).
- A regulator's expert can perform the audit they would actually perform: walk the chain, verify external anchors against TSA + Rekor, verify per-event signatures, verify operator-action signatures against the registered public keys. The audit completes in under an hour and produces a defensible "no tamper detected since anchor X" verdict.

What this **does not** deliver:
- Multi-party signing (T2.2).
- Independent witness consensus (T2.1).
- Hardware-rooted identity (T2.4).
- Tamper-evident storage tier (T2.5).
- Conformance test suite (T2.6).

These are Tier 2. Tier 1 is the credibility floor; Tier 2 is the regulated-deployment floor.

### Effort summary

| Item | Sized effort | Notes |
|---|---|---|
| T1.5.1 — `crypto.randomUUID` | 2 hr | One file change replicated 10x. |
| T1.5.2 — `admissibilityHash` HMAC | 4 hr | + env wiring + preflight. |
| T1.5.3 — kernel fail-closed | 6 hr | Including 503 handler. |
| T1.5.4 — authority-router /health | 30 min | One line. |
| T1.5.5 — always-witness | 2 hr | Plus ledger schema doc update. |
| T1.5.6 — destructive-action allow-list | 4 hr | Plus tests. |
| T1.5.7 — kill-switch cache | 1 hr | Doc + env. |
| T1.5.8 — Zod wiring | 5 days | The biggest of T1.5; 10 services × ~4hr. |
| T1.5.9 — rate-limit | 4 hr | One library, one middleware. |
| T1.0 — fail-closed trail | 2 days | Plus rollback patterns in ~25 routes. |
| T1.1 — chained ledger | 3-6 weeks | Largest item. ~80% engineering, ~20% TSA/Rekor integration. |
| T1.2 — operator signing | 3-4 weeks | Server + client + bootstrap registry + nonce store. |
| **Total Tier 1 (excluding T1.3 mTLS, T1.6 spec, T1.7 SOC 2 readiness)** | **~9-12 weeks** | One senior engineer; less if two engineers split T1.1 and T1.2. |

### Recommended commit sequence

1. **Week 1.** T1.5.1, T1.5.4, T1.5.7 (trivial). T1.5.5 (witness-always). T1.5.2 (admissibilityHash). One PR per defect, each ~30 lines diff.
2. **Week 1-2.** T1.5.3 (kernel fail-closed) + T1.5.6 (destructive allow-list). Behavior-changing; one PR each with tests.
3. **Week 2.** T1.5.9 (rate-limit). One PR.
4. **Week 2-3.** T1.5.8 (Zod wiring). One PR per service, sequenced to limit risk. Five services per week.
5. **Week 3-4.** T1.0 (fail-closed trail). One large PR + a follow-up for rollback hardening.
6. **Week 4-9.** T1.1 (chained ledger). Branch off the main and develop in parallel with T1.2.
7. **Week 4-7.** T1.2 (operator signing). Server-side first; browser integration last.
8. **Week 9-10.** Integration testing. Cut a 1.0-tier1 release.

### What this spec does not cover

- T1.3 (service-to-service mTLS) — separately scoped; appropriate for SRE work, not application engineering.
- T1.6 (Conformance Specification document) — separately scoped; this is writing, not coding.
- T1.7 (SOC 2 readiness, parallel) — organizational, not technical.

These three remain in the Tier 1 scope but are not detailed here because they are not TypeScript-level work.

---

**End of Deliverable 5. Plan file now contains four deliverables, two addenda, and Deliverable 5 (Tier 1 implementation specs).**

---

# ADDENDUM C — Strategic reframe: forks cluster, Posture A as committed, sixth fork surfaced

This addendum is added after a 2026-05-18 strategic synthesis of the original audit's §F ("Five questions whose answers would change the roadmap"). It does three things: (1) corrects an internal inconsistency between §E and §F in Deliverable 4; (2) names the operative strategic posture and the architectural reasons it is forced, not chosen; (3) surfaces the substrate-governance-body legitimacy question that the original audit did not.

The addendum is layered on top of the audit; it does not rewrite Deliverable 4 or Deliverable 5. A reader following the sequence (audit body → Addendum A PM-review → Addendum 2 cross-instance critique → Deliverable 5 implementation specs → Addendum C strategic reframe) sees the reasoning develop. That ordering is itself part of the strategic record and is preserved deliberately.

## C.1 Clustering thesis — Forks 1/4/5 are not independent of §E

Deliverable 4 §F treats the five strategic forks as if they were independent open trade-offs. They are not. They cluster into two coherent postures:

- **Posture A — Substrate-author.** Federal-mandate primary (Fork 1) + auditor-operated witnesses (Fork 2) + UAS first (Fork 3) + open-spec (Fork 4) + BYO trust roots with managed-transparent step-down (Fork 5).
- **Posture B — Compliance-vendor.** Private-market primary + self-operated witnesses + (hypothetically) AV first + closed enterprise product + shipped KMS.

The clustering is not a matter of stylistic preference. It is determined by the architectural commitments that the original audit's §E ("Five things in the current codebase NOT to change") explicitly named as load-bearing — most centrally the constitutional flow (policy→envelope→admissibility→warrant→gate→witness→finality), the `ArtifactType` discriminated-union substrate, and the kill-switch scope taxonomy. Those commitments only cash out as a coherent system under Posture A.

Under Posture B, they are not merely *less optimized* — they are *over-specified*. The constitutional flow, the multi-stakeholder envelope, and the generational-amendment semantics are dead weight that an actual compliance-vendor competitor would not be carrying. The version of this argument that says "the two postures are both viable and just optimize for different things" is weaker than it should be. The correct framing: **Posture A is the only posture under which the work already done is not a liability.** Under Posture B, the existing codebase costs more to maintain, costs more to sell, and offers nothing the existing compliance-vendor market does not already have.

The §E↔§F inconsistency is therefore not a minor sequencing problem — it is the audit treating the codebase as a neutral artifact a buyer could deploy under either posture, when §E itself acknowledges the codebase already carries architectural commitments. This addendum corrects that inconsistency at the strategic-frame layer.

## C.2 Posture A as committed — per-fork and the structural argument

**Fork 1 — Federal-mandate substrate, primary.** Private-market conformance is a secondary deliverable enabled by the same spec, not a separate target. The spec's normative language targets the federal-mandate audience (NIST AI RMF vocabulary, EU AI Act article references, ASTM/ISO formality); the conformance program (T3.1) is designed to be usable by private-market auditors as a derived consumer.

**Fork 2 — Auditor-operated witnesses as reference architecture.** 5-of-N quorum (operator + regulator + insurer + civil-society + sectoral authority) is the target composition. Self-operated remains supported as a documented degraded mode for cases where the full quorum isn't yet deployable (early pilots, sandbox environments, low-stakes domains), explicitly labeled as lower assurance — see C.4 below for the normative requirement that the labeling carry through to operational telemetry rather than living only in the implementation comments.

**Fork 3 — UAS first.** Settled by grant context. Materially amplifies Fork 1: Part 108's pre-rule standards window is exactly the regulatory venue where federal-mandate substrate authoring pays off. AV would have pushed toward private-market because the AV stack is more fragmented (NHTSA + state DMVs + 13 CCR variants) and less amenable to single-substrate authoring.

**Fork 4 — Open-spec as load-bearing commitment.** Upgraded from "default" in the original audit to commitment. T3.1 (open conformance program) is no longer one of several roadmap options; it is the only Tier 3 path consistent with the rest of the architecture.

**Fork 5 — BYO trust roots as architectural commitment.** BYO at Tier 1 (operator-side WebAuthn) and Tier 2 (TPM/Nitro/SEV-SNP). Transparency-log managed option is the explicit step-down for customers whose threat model genuinely does not require operator-side trust roots, offered with transparency logging so the managed mode is still attributable. The framing maps onto the FIPS 140-3 / customer-key-ceremony precedent that federal regulators already recognize — see C.4 below.

### The structural argument for Fork 1 → Fork 4 directionality

The constitutional-coherence argument for open-spec is real but is doing less load-bearing work than a separate structural argument: **federal-mandate substrate implies open-spec by the structure of how federal rulemaking and procurement law actually operate.** FAA airworthiness, FCC type acceptance, FDA QSR — three different regulatory traditions, same pattern: standards published as criteria, with multiple conformant vendors certifying to them. No US federal mandate has ever named a single vendor's product. That pattern is not a coincidence of regulatory taste; it reflects how Article I procurement law (Competition in Contracting Act, 41 USC competition rules) and the APA's notice-and-comment requirements actually constrain federal rulemaking. Single-vendor mandates fail procedural review.

The directionality is one-way: federal-mandate implies open-spec; open-spec does not force federal-mandate (Sigstore, cosign, and SLSA are all open without federal mandates). That asymmetry strengthens the case for open-spec on pure optionality grounds — open preserves both Posture A and the bridge to private-market revenue; closed forecloses Posture A. The constitutional-coherence argument is then doing additional work on top of a fork that is already structurally determined, which is the load-bearing structure the argument needs.

A skeptical reader who does not buy the constitutional framing still arrives at open-spec via this route. That is the correct robustness profile for a foundational commitment.

## C.3 The sixth fork — substrate governance body legitimacy

The original audit's §F enumerates five forks. There is a sixth, more consequential, fork that the original did not surface: **which body holds the open spec, witnesses operations in the auditor-operated tier, and authorizes constitutional amendment.** Under Posture A this body is load-bearing — open-spec without a credible holder is just abandonware; auditor-operated witness quorum without external operators is just operator-self-attestation by another name. The body's legitimacy is the architecture's legitimacy.

The body does not exist yet, and standing one up has multi-year lead time. This is the actual Tier 3 gating risk for the whole project.

### Venue option space

Five concrete options, with what each costs and what each delivers:

1. **NIST AI Safety Institute (AISI).** Fastest path to US-federal credibility; narrowest substantive fit. AISI is chartered for AI safety evaluation; whether the substrate's framing fits within that charter or would require a charter expansion is a question requiring direct engagement with AISI [verification needed at engagement]. US-only. Best treated as a parallel amplifier and a probable early venue for the spec conversation, not the substrate's primary home.

2. **ASTM F38 (Unmanned Aircraft Systems).** Domain-credible, already exists, already runs the Remote ID standard (ASTM F3411-22a) cited throughout this audit. The natural sectoral home for a UAS governance-substrate standard given Fork 3. ASTM committees are internationally recognized and the chartering pathway is well-understood. Sector-bounded: this carries the substrate in UAS but does not transfer it to AV, robotics, or maritime without parallel committee work (F39 if it forms; new committee charters elsewhere).

3. **FAA Part 108 Aviation Rulemaking Committee.** Domain-aligned to Fork 3 and aligned to a live rulemaking — ARC influence shapes the rule directly, not just the standard the rule references. **Tactical, not durable**: ARCs typically run 12–24 months and dissolve at NPRM. Whether Part 108's ARC is currently constituted, whether the entry window is currently open, and on what timeline are facts requiring verification — likely measured in months, not years [verification needed]. Best treated as a tactical near-term lever rather than a standards home.

4. **OpenSSF (Open Source Security Foundation, under Linux Foundation).** Technical-substrate-credible. Sigstore, in-toto, and SLSA all live here; the conversation about "attestation for autonomous systems" is a natural extension of the conversation about "attestation for software supply chains" that OpenSSF has been having for several years. Naming OpenSSF specifically rather than "Linux Foundation generically" sharpens the credibility signal — OpenSSF has a specific reputational stake in the attestation-and-provenance area that LF-generic does not, and the IP / governance regime (Apache 2.0 default; project technical charters; foundation-level legal stewardship) is well-suited to the substrate. Sigstore took roughly four years from foundation announce to broad regulatory recognition — that is the realistic lead time for an OpenSSF-hosted project to mature to comparable standing. Whether OpenSSF's project-charter mechanics accommodate a non-software-supply-chain submission is a question for direct engagement [verification needed].

5. **Stand up a body de novo.** Full control; longest path to legitimacy; most expensive. Justified only if existing venues are categorically wrong for the framing. They do not appear to be — between ASTM F38 (sectoral standards) and OpenSSF (technical reference implementation + test suite) the substrate has both regulatory and technical venues without needing to build one.

### Recommended mix (starting recommendation, not researched proposal)

**ASTM F38 as the sectoral standards home + OpenSSF as the technical foundation for the reference implementation and test suite, with NIST AISI as a parallel amplifier and an FAA Part 108 ARC seat as a tactical near-term lever.**

This is the Sigstore-meets-ASTM pattern, and it has working precedents in adjacent regulatory regimes. It does not require building a new institution. It preserves the federal-mandate path (ASTM standards are routinely referenced by FAA/FCC/FDA rules), the open-spec commitment (OpenSSF defaults are Apache 2.0 and foundation-stewarded), and the auditor-operated witness model (ASTM committees are exactly the kind of multi-stakeholder body that can supply witness operators).

**This recommendation is starting orientation, not a researched proposal.** The venue scan that needs to follow this addendum will verify chartering scope, governance regime, IP terms, convening cadence, and entry costs for each candidate venue. Several of the claims above (AISI charter scope, Part 108 ARC current status, OpenSSF project-charter mechanics for a non-software-supply-chain submission) require direct engagement to confirm. The addendum surfaces the option space; the scan resolves it.

## C.4 Sequencing consequences — what this addendum changes about Tier 1

The strategic commitment in C.2 and the venue mix in C.3 have concrete consequences for the Tier 1 implementation work. None of these require re-engineering Deliverable 5 — they refine the framing and add normative requirements to T1.6 (which Deliverable 5 explicitly defers as "writing, not coding").

**T1.6 licensing — CC-BY 4.0 or Apache 2.0 from v0.1.** The conformance specification document should be open-licensed from its first published draft. The current T1.6 description in Deliverable 4 does not specify licensing. Licensing is signal: a v0.1 spec under CC-BY reads very differently in an ASTM or NIST conversation than the same content under "all rights reserved." Free move; large effect on venue conversations.

**T1.6 venue-aware framing.** The spec should be authored *for* a specific venue conversation even before the venue is chosen, because the venue conversation is what tells you whether the framing lands. Authoring generically and placing later is the failure mode. The recommended posture: write the v0.1 spec with ASTM F38 + an OpenSSF project-charter conversation in mind, NIST RMF vocabulary throughout, EU AI Act Article 11 / Annex IV cross-references in the technical-documentation sections, and RFC 2119 normative language framed in a manner ASTM committees recognize.

**T1.6 urgency — tied to ARC timing.** If the FAA Part 108 ARC seat is to function as a tactical lever per C.3, T1.6 v0.1 must be venue-presentable before the ARC's substantive work concludes — not before Part 108's effective date. ARCs typically run 12–24 months from convening to NPRM delivery. The exact Part 108 ARC status requires verification (see C.3), but the *order of magnitude* of urgency is months, not years. The original audit sized T1.6 at "S" (≤ 1–2 weeks) in Deliverable 4 §H. That sizing is correct for the *drafting* of the document but does not account for the venue-engagement work the document then supports. The addendum surfaces this dependency; the user's calendar resolves it.

**T2.1 architected-for-multi-party-launches-with-one-partner.** The auditor-operated reference architecture (Posture A's Fork 2) cannot launch in its target form during Tier 1 or early Tier 2 because the conformance body and external auditors do not yet exist. The realistic walk: T1 ships with self-operated witnesses in degraded mode, T2.1 architects for full multi-party but launches with operator + one partner (insurer, civil-society pilot, or a friendly state agency standing in for the eventual sectoral authority), full 5-of-N quorum is gated on the conformance body coalescing in Tier 3. This is consistent with the audit's own Tier 2 deliverable language; the addendum just makes the dependency on the sixth fork explicit.

**Degraded-mode-as-labeled-with-gap-visibility — normative requirement in T1.6.** Self-operated witnesses during the Tier 1 / early Tier 2 walk-up period must be more than labeled. The labeling must carry through to the assurance-attestation telemetry the system emits, so that a downstream consumer (regulator, insurer, court) can distinguish a finality certificate witnessed by a self-operated quorum from one witnessed by the target auditor-operated quorum without having to read the implementation. Degraded modes that look identical to full-assurance modes in operational telemetry ossify into the de facto pattern; the architectural commitment to auditor-operated rots in production. **This is a normative requirement in the conformance specification (T1.6), not an implementation note in Deliverable 5.** It is the mechanism by which the architectural commitment stays honest as the implementation walks toward it.

**T1.2 framing — invoke the FIPS 140-3 / customer-key-ceremony precedent.** The BYO commitment (Fork 5) is not asking regulators to invent a new trust-root category. It is claiming an existing one — FIPS 140-3 validated HSMs are deployed in customer environments with customer-controlled key ceremonies; CMMC's third-party assessor regime does not mandate vendor key custody; even Sigstore separates the identity-attestation function from the customer signing-key function. The T1.2 spec language should invoke these precedents explicitly. Doing so shortens the regulator conversation by an unknown but probably meaningful amount, because the conversation starts inside an existing category rather than asking for a new one.

## C.5 What this addendum does not do

To keep the addendum's scope honest:

- **It does not rewrite Deliverable 4.** §F stands as authored. The §E↔§F inconsistency is surfaced here; it is not silently corrected in the original. A reader of the audit body alone sees the inconsistency; a reader of audit-plus-addenda sees the resolution. That ordering is part of the audit-trail integrity.
- **It does not resolve the venue scan.** The venue mix in C.3 is a starting recommendation. Verifying chartering scope, governance regime, IP terms, and entry costs requires direct engagement with each candidate venue. That work is the natural follow-on to this addendum and is out of scope here.
- **It does not commit to a specific conformance body before the venue scan.** Naming ASTM F38 + OpenSSF as the recommended mix is orientation, not commitment. The scan may discover that one of the candidates has constraints that disqualify it (e.g., AISI charter scope, F38 chartering bandwidth, OpenSSF technical-charter constraints on non-software-supply-chain projects).
- **It does not bind Tier 2 staffing.** Fork 3 (UAS first) is settled, but UAS-specific staffing — aviation regulatory expertise, BVLOS operational expertise, Remote ID protocol expertise — is a Tier 2 scoping decision that the addendum does not pre-empt.
- **It does not restate or revisit the technical findings in Deliverables 1–3 or the implementation specs in Deliverable 5.** Those stand. The strategic reframe is a layer on top of the technical analysis, not a replacement for it. T1.0 / T1.1 / T1.2 remain the co-load-bearing Tier 1 trio per Addendum A; this addendum does not relitigate that.
- **It does not eliminate the need to surface the broader strategic corpus into in-session conversation.** The audit author and any assistant continuing this work both operate with limited visibility into the GPlane book, Petersen Governance Architecture paper, GEL paper, MAE amendment protocol, Recursive Governance paper, and the Helena_Telecom_North binding (audit Addendum §A note on structural disclosure, line 1445). Implementation work that turns on the specifics of those documents requires the principal to bring the relevant excerpts into the working session.

---

**End of Addendum C. Plan file now contains four deliverables, three addenda (PM-review, cross-instance review, strategic reframe), and Deliverable 5 (Tier 1 implementation specs).**
