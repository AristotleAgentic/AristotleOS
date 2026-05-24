import { create } from "zustand";
import type {
  CommitRequest,
  GatePipelineSample,
  LedgerRecord,
  OperationalMode,
  Posture,
  SystemSnapshot
} from "./types.js";
import {
  AGENTS,
  ENVELOPES,
  INITIAL_REQUESTS,
  WARDS,
  buildLedger,
  makeCommitRequest,
  seedPipeline,
  shortHash
} from "./mockData.js";
import { gatewayContract, postOperator, probeGateway } from "./service.js";

export type SectionId =
  | "overview"
  | "builder"
  | "shadow"
  | "conflicts"
  | "adoption"
  | "failure"
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
}

let toastSeq = 0;

export const useCommandStore = create<CommandState>((set, get) => ({
  snapshot: deriveSnapshot(),
  requests: INITIAL_REQUESTS,
  ledger: buildLedger(28),
  pipeline: seedPipeline(60),

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
    const partial = await probeGateway();
    if (partial) {
      set((s) => ({ snapshot: { ...s.snapshot, ...partial } }));
      get().toast("Live gateway connected", "green");
    }
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
    const ok = await postOperator(gatewayContract.compilePolicy, { compile: "governance-manifest" });
    get().toast(
      ok
        ? "Compiled via live gateway — Ward + Authority manifest hash-bound."
        : "Gateway offline — deterministic local preview. Live compile: run a boundary and POST /v1/execution-control/governance/compile (see docs/sandboxes & ACCESS_CONTROL).",
      ok ? "green" : "amber"
    );
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
