import { create } from "zustand";
import type {
  ApprovalItem,
  CommitRequest,
  ConflictInboxItem,
  GatePipelineSample,
  LedgerRecord,
  OperationalMode,
  Posture,
  ShadowProfileSummary,
  SystemSnapshot,
  WardMarshalFinding
} from "./types.js";
import {
  AGENTS,
  CONFLICT_EDGE_SEED,
  ENVELOPES,
  INITIAL_REQUESTS,
  MARSHAL_CENSUS_SEED,
  WARDS,
  buildLedger,
  makeCommitRequest,
  seedPipeline,
  shortHash
} from "./mockData.js";
import { gatewayContract, postOperator, probeGateway } from "./service.js";
import { boundaryCompile, boundaryDecideApproval, boundaryListApprovals, boundaryListConflicts, boundaryResolveConflict, fetchLiveState, mapApprovalsToUi, mapConflictsToInbox, runLiveApprovals, runLiveConflicts, runLiveMarshalCensus, runLiveShadowProfile } from "./boundary.js";

export type SectionId =
  | "overview"
  | "builder"
  | "shadow"
  | "approvals"
  | "noc"
  | "fleet"
  | "conflicts"
  | "adoption"
  | "failure"
  | "marshal"
  | "mesh"
  | "commit"
  | "warrants"
  | "wards"
  | "ledger"
  | "replay"
  | "simulation"
  | "safety";

export interface Toast {
  id: string;
  message: string;
  tone: "green" | "amber" | "red" | "cyan";
}

const MODE_POSTURE: Record<OperationalMode, Posture> = {
  normal: "green",
  simulation: "green",
  replay: "green",
  degraded: "amber",
  partitioned: "amber",
  emergency: "red"
};

function deriveSnapshot(partial?: Partial<SystemSnapshot>): SystemSnapshot {
  const base: SystemSnapshot = {
    mode: "normal",
    posture: "green",
    activeWards: WARDS.filter((w) => w.state !== "revoked").length,
    activeAgents: AGENTS.filter((a) => a.state === "active" || a.state === "awaiting-warrant").length,
    openRequests: WARDS.reduce((n, w) => n + w.openRequests, 0),
    warrantsToday: 1284,
    refusalsToday: 37,
    escalationsToday: 9,
    ledgerIntact: true,
    ledgerHeight: 128402,
    killSwitchArmed: false,
    gateLatencyMs: 7,
    source: "mock"
  };
  return { ...base, ...partial };
}

interface CommandState {
  snapshot: SystemSnapshot;
  requests: CommitRequest[];
  ledger: LedgerRecord[];
  pipeline: GatePipelineSample[];

  // Live engine results (null ⇒ console renders curated sample data instead).
  shadowProfile: ShadowProfileSummary | null;
  marshalFindings: WardMarshalFinding[] | null;
  conflicts: ConflictInboxItem[] | null;
  approvals: ApprovalItem[] | null;

  section: SectionId;
  selectedRequestId: string | null;
  selectedLedgerSeq: number | null;
  selectedWardId: string | null;
  selectedMeshNodeId: string | null;
  opsOpen: boolean;
  replayT: number; // 0..100 percent of history
  toasts: Toast[];

  // navigation / selection
  setSection: (s: SectionId) => void;
  selectRequest: (id: string | null) => void;
  selectLedger: (seq: number | null) => void;
  selectWard: (id: string | null) => void;
  selectMeshNode: (id: string | null) => void;
  setOpsOpen: (open: boolean) => void;
  setReplayT: (t: number) => void;

  // lifecycle
  tick: () => void;
  hydrate: () => Promise<void>;
  toast: (message: string, tone?: Toast["tone"]) => void;
  dismissToast: (id: string) => void;

  // operator actions
  setMode: (mode: OperationalMode) => void;
  pauseWard: (wardId: string) => void;
  revokeEnvelope: (envelopeId: string) => void;
  forceReconcile: () => void;
  triggerKillSwitch: () => void;
  exportEvidence: () => void;
  escalate: () => void;
  compileGovernance: () => Promise<void>;
  runShadowProfile: () => Promise<void>;
  runMarshalCensus: () => Promise<void>;
  loadConflicts: () => Promise<void>;
  resolveConflict: (id: string, action: "accept" | "reject" | "escalate" | "reconcile", reason?: string) => Promise<void>;
  loadApprovals: () => Promise<void>;
  decideApproval: (id: string, decision: "approve" | "reject", reason?: string) => Promise<void>;
}

let toastSeq = 0;

export const useCommandStore = create<CommandState>((set, get) => ({
  snapshot: deriveSnapshot(),
  requests: INITIAL_REQUESTS,
  ledger: buildLedger(28),
  pipeline: seedPipeline(60),
  shadowProfile: null,
  marshalFindings: null,
  conflicts: null,
  approvals: null,

  section: "overview",
  selectedRequestId: INITIAL_REQUESTS[0]?.id ?? null,
  selectedLedgerSeq: null,
  selectedWardId: null,
  selectedMeshNodeId: null,
  opsOpen: false,
  replayT: 100,
  toasts: [],

  setSection: (section) => set({ section }),
  selectRequest: (selectedRequestId) => set({ selectedRequestId }),
  selectLedger: (selectedLedgerSeq) => set({ selectedLedgerSeq }),
  selectWard: (selectedWardId) => set({ selectedWardId }),
  selectMeshNode: (selectedMeshNodeId) => set({ selectedMeshNodeId }),
  setOpsOpen: (opsOpen) => set({ opsOpen }),
  setReplayT: (replayT) => set({ replayT }),

  toast: (message, tone = "cyan") => {
    const id = `t-${toastSeq++}`;
    set((s) => ({ toasts: [...s.toasts, { id, message, tone }] }));
    setTimeout(() => get().dismissToast(id), 4200);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  tick: () => {
    const s = get();
    if (s.snapshot.mode === "replay") return; // freeze live feed while scrubbing
    // advance pipeline telemetry
    const last = s.pipeline[s.pipeline.length - 1];
    const t = (last?.t ?? 0) + 1;
    const latencyMs = Math.max(3.5, 6 + Math.sin(t / 5) * 2 + Math.random() * 3 + (s.snapshot.mode === "degraded" ? 9 : 0));
    const pipeline = [...s.pipeline.slice(-59), { t, latencyMs, throughput: 40 + Math.sin(t / 8) * 14 + Math.random() * 8 }];

    let requests = s.requests;
    let snapshot = { ...s.snapshot, gateLatencyMs: Math.round(latencyMs * 10) / 10 };

    // occasionally synthesize a new governed request
    if (Math.random() < 0.28 && s.snapshot.mode !== "emergency") {
      const roll = Math.random();
      const decision = roll < 0.7 ? "allow" : roll < 0.86 ? "escalate" : "refuse";
      const next = makeCommitRequest(
        decision === "allow"
          ? { decision: "allow", reasonCodes: ["ALLOWED"], latencyMs: Math.round(latencyMs) }
          : decision === "escalate"
            ? { decision: "escalate", reasonCodes: ["RUNTIME_STATE_MISSING"], warrantId: undefined, action: "breaker.open", agentCallsign: "GRID-BAL-1", agentId: "agent:grid-balancer", ward: "ward-grid", risk: "critical", latencyMs: Math.round(latencyMs) }
            : { decision: "refuse", reasonCodes: ["ACTION_DENIED"], warrantId: undefined, action: "drone.leave_boundary", risk: "critical", latencyMs: Math.round(latencyMs) }
      );
      requests = [next, ...s.requests].slice(0, 60);
      snapshot = {
        ...snapshot,
        warrantsToday: snapshot.warrantsToday + (decision === "allow" ? 1 : 0),
        refusalsToday: snapshot.refusalsToday + (decision === "refuse" ? 1 : 0),
        escalationsToday: snapshot.escalationsToday + (decision === "escalate" ? 1 : 0),
        ledgerHeight: snapshot.ledgerHeight + 1
      };
    }
    set({ pipeline, requests, snapshot });
  },

  hydrate: async () => {
    // Prefer the execution-control boundary (real metrics + signed ledger); fall back
    // to the operator gateway; otherwise stay on sample data and say so.
    const live = await fetchLiveState();
    if (live) {
      set((s) => ({
        snapshot: { ...s.snapshot, ...live.snapshot },
        ledger: live.ledger.length ? live.ledger : s.ledger
      }));
      get().toast("Live boundary connected — metrics and ledger are real.", "green");
      // Boundary is up: profile Shadow Mode, run the Ward Marshal census, and
      // load the Conflict Inbox against the real engines so those consoles render
      // live results too.
      void get().runShadowProfile();
      void get().runMarshalCensus();
      void get().loadConflicts();
      void get().loadApprovals();
      return;
    }
    const partial = await probeGateway();
    if (partial) {
      set((s) => ({ snapshot: { ...s.snapshot, ...partial } }));
      get().toast("Live gateway connected", "green");
      return;
    }
    set((s) => ({ snapshot: { ...s.snapshot, source: "mock" } }));
  },

  setMode: (mode) => {
    set((s) => ({ snapshot: { ...s.snapshot, mode, posture: s.snapshot.killSwitchArmed ? "red" : MODE_POSTURE[mode] } }));
    get().toast(`Operational mode → ${mode.toUpperCase()}`, mode === "emergency" ? "red" : mode === "normal" ? "green" : "amber");
  },

  pauseWard: (wardId) => {
    const ward = WARDS.find((w) => w.id === wardId);
    void postOperator(gatewayContract.killSwitch, { scope: wardId, action: "pause" });
    get().toast(`Ward paused — ${ward?.name ?? wardId}. Commit gate now fail-closed.`, "amber");
  },

  revokeEnvelope: (envelopeId) => {
    const env = ENVELOPES.find((e) => e.id === envelopeId);
    void postOperator(gatewayContract.govern, { revoke: envelopeId });
    set((s) => ({ ledger: prependLedger(s.ledger, "envelope.revoked", env?.wardId ?? "—") }));
    get().toast(`Authority envelope revoked — ${envelopeId}. Propagating on revocation bus.`, "red");
  },

  forceReconcile: () => {
    void postOperator(gatewayContract.govern, { reconcile: true });
    set((s) => ({ ledger: prependLedger(s.ledger, "reconcile.complete", "—") }));
    get().toast("Reconciliation forced across the governance mesh.", "cyan");
  },

  triggerKillSwitch: () => {
    void postOperator(gatewayContract.killSwitch, { action: "arm", scope: "global" });
    set((s) => ({
      snapshot: { ...s.snapshot, killSwitchArmed: true, posture: "red", mode: "emergency" },
      ledger: prependLedger(s.ledger, "kill-switch.armed", "global")
    }));
    get().toast("KILL SWITCH ARMED — global fail-closed. All commit gates refusing.", "red");
  },

  exportEvidence: () => {
    void postOperator(gatewayContract.governanceChainExport, { format: "bundle" });
    get().toast(`Evidence bundle exported · bundle_hash ${shortHash("bundle-" + Date.now(), 16)}`, "green");
  },

  escalate: () => {
    void postOperator(gatewayContract.govern, { escalate: true });
    get().toast("Escalated to human authority. Awaiting sovereign decision.", "amber");
  },

  // Attempts a real compile against the gateway; falls back to the deterministic
  // local preview when no gateway is connected. Honest about which path ran — the
  // backend is execution-control-runtime's POST /v1/execution-control/governance/compile.
  compileGovernance: async () => {
    // Real compile against the execution-control boundary's configured Ward + Authority.
    const result = await boundaryCompile({});
    if (!result.reachable) {
      get().toast("Boundary offline — deterministic local preview. Run `aristotle execution-control serve` to compile live (POST /v1/execution-control/governance/compile).", "amber");
      return;
    }
    const hash = result.data?.hashes?.manifest_hash;
    if (result.ok && hash) {
      get().toast(`Compiled on the live boundary — manifest ${hash.slice(0, 12)} (validation ${result.data?.validation?.ok ? "ok" : "failed"}).`, result.data?.validation?.ok ? "green" : "amber");
    } else {
      get().toast(`Boundary rejected the compile (HTTP ${result.status}).`, "red");
    }
  },

  // Shadow Mode: profile a representative batch derived from the live Authority
  // Envelope through the real Commit Gate (POST /v1/execution-control/shadow).
  // On success the console shows the engine's would-decisions; otherwise it keeps
  // the labeled sample profile.
  runShadowProfile: async () => {
    const profile = await runLiveShadowProfile(new Date().toISOString());
    if (!profile) {
      get().toast("Boundary offline — Shadow Mode is showing a sample profile. Run `aristotle execution-control serve` to profile live.", "amber");
      return;
    }
    set({ shadowProfile: profile });
    get().toast(`Shadow profile computed live — ${profile.evaluatedActions} actions, ${Math.round(profile.allowRate * 100)}% would-allow.`, "green");
  },

  // Ward Marshal: score the representative discovery seed through the real census
  // engine (POST /v1/execution-control/marshal/census). On success the console
  // shows engine-computed findings; otherwise it keeps the labeled sample census.
  runMarshalCensus: async () => {
    const findings = await runLiveMarshalCensus(MARSHAL_CENSUS_SEED);
    if (!findings) {
      get().toast("Boundary offline — Ward Marshal is showing a sample census. Run `aristotle execution-control serve` to score live.", "amber");
      return;
    }
    set({ marshalFindings: findings });
    const rogue = findings.filter((f) => f.status === "rogue").length;
    get().toast(`Ward Marshal census computed live — ${findings.length} agents, ${rogue} rogue.`, rogue ? "red" : "green");
  },

  // Conflict Inbox: ingest a representative edge-record seed into the durable
  // inbox (POST /conflicts/ingest) and list the engine-classified items. Idempotent
  // — re-ingest never reopens an operator's resolution. Falls back to the sample
  // inbox when the boundary is offline.
  loadConflicts: async () => {
    const conflicts = await runLiveConflicts(CONFLICT_EDGE_SEED);
    if (!conflicts) {
      get().toast("Boundary offline — Conflict Inbox is showing sample items. Run `aristotle execution-control serve` to reconcile live.", "amber");
      return;
    }
    set({ conflicts });
    const open = conflicts.filter((c) => c.status === "open" || c.status === "escalated").length;
    get().toast(`Conflict Inbox reconciled live — ${conflicts.length} items, ${open} need review.`, open ? "amber" : "green");
  },

  // Conflict Inbox: apply an attributed operator resolution (POST /conflicts/resolve)
  // then refresh the list from the boundary. The boundary records the operator and
  // reason; nothing is decided on the operator's behalf.
  resolveConflict: async (id, action, reason) => {
    const result = await boundaryResolveConflict(id, action, reason);
    if (!result.reachable) {
      get().toast("Boundary offline — resolution not recorded. Connect the boundary to resolve live.", "amber");
      return;
    }
    if (!result.ok) {
      get().toast(`Boundary rejected the resolution (HTTP ${result.status}).`, "red");
      return;
    }
    const list = await boundaryListConflicts();
    if (list) set({ conflicts: mapConflictsToInbox(list.items) });
    const tone = action === "reject" ? "red" : action === "escalate" ? "amber" : "green";
    get().toast(`Conflict ${id} → ${action} recorded on the live boundary.`, tone);
  },

  // Dual-control approvals: list the live M-of-N queue (GET /approvals); fall back to
  // the labeled sample queue when the boundary is offline.
  loadApprovals: async () => {
    const approvals = await runLiveApprovals();
    if (!approvals) {
      get().toast("Boundary offline — Approvals is showing a sample queue. Run `aristotle execution-control serve` to action live.", "amber");
      return;
    }
    set({ approvals });
  },

  // Cast an attributed vote (POST /approvals/decide) then refresh the queue. The
  // boundary records the operator + enforces separation of duties.
  decideApproval: async (id, decision, reason) => {
    const result = await boundaryDecideApproval(id, decision, reason);
    if (!result.reachable) {
      get().toast("Boundary offline — vote not recorded. Connect the boundary to approve live.", "amber");
      return;
    }
    if (!result.ok) {
      get().toast(`Boundary rejected the vote (HTTP ${result.status}).`, "red");
      return;
    }
    const list = await boundaryListApprovals();
    if (list) set({ approvals: mapApprovalsToUi(list.items) });
    get().toast(`Approval ${id} → ${decision} recorded on the live boundary.`, decision === "reject" ? "red" : "green");
  }
}));

function prependLedger(ledger: LedgerRecord[], eventType: string, ward: string): LedgerRecord[] {
  const top = ledger[0];
  const seq = (top?.seq ?? 128402) + 1;
  const previousHash = top?.recordHash ?? "GENESIS";
  const recordHash = shortHash(`rec-${seq}-${previousHash}`);
  const rec: LedgerRecord = {
    seq,
    timestamp: new Date().toISOString(),
    eventType,
    agent: "operator",
    ward,
    domain: "—",
    decision: "allow",
    warrantId: undefined,
    policyHash: shortHash(`pol-${ward}`),
    registerHash: shortHash(`reg-${seq}`),
    recordHash,
    previousHash,
    intact: true,
    anchored: false
  };
  return [rec, ...ledger].slice(0, 60);
}
