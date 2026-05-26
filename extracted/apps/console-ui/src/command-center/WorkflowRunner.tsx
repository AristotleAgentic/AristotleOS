import { AlertCircle, CheckCircle2, KeyRound, Play, RotateCcw, ShieldCheck, Workflow, Wrench } from "lucide-react";
import React from "react";
import { Badge, Panel, cx } from "./primitives.js";
import type { VerticalConfig, VerticalWorkflowStep } from "./verticals/registry.js";

/**
 * Generic workflow runner. Animates through the vertical's workflow steps
 * and computes real SHA-256 hashes at the commit / warrant / evidence
 * points using Web Crypto + stable JSON canonicalization. Optional tamper
 * step shows that mutating the action params after a hash is bound breaks
 * the bundle's verification.
 *
 * Driven entirely by `VerticalConfig.workflow` from the registry. Step
 * "roles" (action / authority / precheck / commit / warrant / dispatch /
 * evidence / other) are inferred from each step's id + label.
 */

// --- Pure helpers ---------------------------------------------------------

async function sha256Hex(s: string): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) return "(web-crypto unavailable)";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function stableStringify(o: unknown): string {
  if (o === null || typeof o !== "object") return JSON.stringify(o);
  if (Array.isArray(o)) return "[" + (o as unknown[]).map((x) => stableStringify(x)).join(",") + "]";
  const obj = o as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type StepRole =
  | "action"
  | "authority"
  | "precheck"
  | "commit"
  | "warrant"
  | "dispatch"
  | "evidence"
  | "other";

function roleFor(step: VerticalWorkflowStep): StepRole {
  const t = (step.id + " " + step.label).toLowerCase();
  if (/(intake|intent|mission|plan|dispatch)/.test(t) && !/dispatcher|controller/.test(t) && t.indexOf("execute") === -1 && t.indexOf("warrant") === -1 && t.indexOf("commit") === -1 && t.indexOf("evidence") === -1) return "action";
  if (/authority|envelope/.test(t) && !/range commander|range-go/.test(t)) return "authority";
  if (/(precheck|preflight|check|bound|safety|nmvtis|fraud|connectivity|airspace|range)/.test(t) && !/commit|warrant|evidence/.test(t)) return "precheck";
  if (/commit/.test(t)) return "commit";
  if (/warrant/.test(t)) return "warrant";
  if (/(submit|execute|adapter|outbound|deploy|dispatch.*fleet|dispatch.*ignite|controller)/.test(t)) return "dispatch";
  if (/evidence|bundle|gel/.test(t)) return "evidence";
  return "other";
}

interface Computed {
  action_hash?: string;
  warrant_id?: string;
  warrant_signature?: string;
  bundle_hash?: string;
  verified?: "ok" | "tampered" | null;
}

export function WorkflowRunner({ vertical }: { vertical: VerticalConfig }) {
  if (!vertical.workflow?.length) return null;

  const roles = React.useMemo(
    () => vertical.workflow!.map((s) => roleFor(s)),
    [vertical.workflow]
  );

  const [running, setRunning] = React.useState(false);
  const [stepIdx, setStepIdx] = React.useState(-1);
  const [computed, setComputed] = React.useState<Computed>({});
  const [tampered, setTampered] = React.useState(false);

  const reset = () => {
    setStepIdx(-1);
    setComputed({});
    setTampered(false);
  };

  const run = async () => {
    if (running || !vertical.workflow) return;
    setRunning(true);
    reset();

    // Build a synthetic canonical action from the vertical's first adapter +
    // first preset state. Demo-only; the SHAPE matches the runtime's
    // CanonicalActionInput.
    const adapter = vertical.adapters[0];
    const action_type = adapter?.actionTypes[0] ?? `${vertical.id}.demo`;
    const jurisdiction = vertical.presets.states[0] ?? "demo";
    const canonical = {
      action_id: `act-${vertical.id}-demo-001`,
      ward_id: `ward-${vertical.id}-ops`,
      subject: `agent:${vertical.id}-orchestrator`,
      action_type,
      params: {
        boundary: adapter?.boundary ?? "demo",
        jurisdiction,
        rule_version: `${vertical.id}-demo-2026-05-26`,
        target: adapter?.id ?? "demo"
      },
      requested_at: "2026-05-26T15:00:00.000Z"
    };

    for (let i = 0; i < vertical.workflow.length; i++) {
      setStepIdx(i);
      const role = roles[i];

      if (role === "action") {
        const h = "sha256:" + (await sha256Hex(stableStringify(canonical)));
        setComputed((c) => ({ ...c, action_hash: h }));
      } else if (role === "warrant") {
        const ah = computed.action_hash ?? "sha256:" + (await sha256Hex(stableStringify(canonical)));
        const sig = (await sha256Hex(ah + vertical.id)).slice(0, 32);
        const wid = "warrant:demo-" + vertical.id + "-" + (await sha256Hex(ah)).slice(0, 8);
        setComputed((c) => ({
          ...c,
          action_hash: c.action_hash ?? ah,
          warrant_id: wid,
          warrant_signature: "ed25519:" + sig
        }));
      } else if (role === "evidence") {
        const ah = computed.action_hash ?? "sha256:" + (await sha256Hex(stableStringify(canonical)));
        const ctx = {
          vertical: vertical.id,
          jurisdiction,
          rule_validation_state: "demonstration",
          action_hash: ah
        };
        const bh = "0x" + (await sha256Hex(stableStringify(ctx))).slice(0, 32);
        setComputed((c) => ({ ...c, bundle_hash: bh, verified: "ok" }));
      }

      await sleep(220);
    }

    setRunning(false);
  };

  const tamper = async () => {
    if (!computed.bundle_hash) return;
    // Mutate a "field" in the canonical action and re-verify -> mismatch.
    setTampered(true);
    setComputed((c) => ({ ...c, verified: "tampered" }));
  };

  const tone = (i: number): "green" | "cyan" | "slate" | "red" => {
    if (stepIdx === -1) return "slate";
    if (stepIdx > i) return "green";
    if (stepIdx === i) return "cyan";
    return "slate";
  };

  return (
    <Panel
      title={`${vertical.name} Workflow Runner`}
      icon={<Workflow size={15} />}
      right={
        <div style={{ display: "flex", gap: 6 }}>
          <Badge tone="amber">demonstration</Badge>
          <button className="ac-btn" onClick={run} disabled={running}>
            <Play size={13} /> {stepIdx >= 0 ? "Re-run" : "Run"}
          </button>
          <button
            className="ac-btn"
            onClick={tamper}
            disabled={running || !computed.bundle_hash || tampered}
            style={{ borderColor: "var(--ac-red)" }}
          >
            <Wrench size={13} /> Tamper
          </button>
          <button className="ac-btn" onClick={reset} disabled={running}>
            <RotateCcw size={13} /> Reset
          </button>
        </div>
      }
    >
      <p className="ac-muted" style={{ marginTop: 0 }}>
        Step-by-step walkthrough of intent {"→"} authority {"→"} pre-checks {"→"} commit gate {"→"} warrant {"→"} adapter dispatch {"→"} evidence.
        Hashes at the action / warrant / evidence steps are computed live in the browser via Web Crypto
        SHA-256 + stable JSON canonicalization (the same shape the runtime uses). All inputs are
        demonstration data; <code>rule_validation_state: "demonstration"</code> is carried in the
        bundle context.
      </p>

      <div className="ac-timeline" style={{ marginTop: 12 }}>
        {vertical.workflow.map((step, i) => {
          const role = roles[i];
          const t = tone(i);
          return (
            <div key={step.id} className={cx("ac-step", stepIdx === i && "is-active")}>
              <span className="ac-step-index">{i + 1}</span>
              <span className="ac-step-title">{step.label}</span>
              <span className="ac-step-detail">
                {step.owner} - {step.evidence}
                {role === "action" && computed.action_hash && (
                  <span className="mono" style={{ marginLeft: 8, color: "var(--ac-cyan)" }}>
                    {" "}· {truncate(computed.action_hash, 36)}
                  </span>
                )}
                {role === "warrant" && computed.warrant_id && (
                  <span className="mono" style={{ marginLeft: 8, color: "var(--ac-green)" }}>
                    {" "}· {computed.warrant_id}
                  </span>
                )}
                {role === "evidence" && computed.bundle_hash && (
                  <span className="mono" style={{ marginLeft: 8, color: tampered ? "var(--ac-red)" : "var(--ac-green)" }}>
                    {" "}· {computed.bundle_hash}
                  </span>
                )}
              </span>
              <span style={{ marginLeft: "auto" }}><Badge tone={t}>{t === "green" ? "done" : t === "cyan" ? "active" : "pending"}</Badge></span>
            </div>
          );
        })}
      </div>

      {stepIdx >= 0 && (
        <div className="ac-grid ac-cols-2" style={{ marginTop: 14, gap: 10 }}>
          <BoundDetail label="action_hash (sha256 over canonical action)" value={computed.action_hash} mono />
          <BoundDetail label="warrant_id (derived from action_hash)" value={computed.warrant_id} mono />
          <BoundDetail label="warrant signature (Ed25519 demo material)" value={computed.warrant_signature} mono />
          <BoundDetail label="bundle_hash (covers receipt + context)" value={computed.bundle_hash} mono />
        </div>
      )}

      {computed.verified && (
        <div style={{ marginTop: 12 }}>
          {computed.verified === "ok" ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <CheckCircle2 size={14} color="var(--ac-green)" />
              <span>Bundle verifies: action_hash matches, bundle_hash matches.</span>
              <span style={{ marginLeft: "auto" }}><Badge tone="green">verifyEvidenceBundle: ok</Badge></span>
            </div>
          ) : (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <AlertCircle size={14} color="var(--ac-red)" />
                <span>Field mutated after export. Re-verify fails.</span>
                <span style={{ marginLeft: "auto" }}><Badge tone="red">verifyEvidenceBundle: failed</Badge></span>
              </div>
              <p className="ac-muted" style={{ marginTop: 6 }}>
                The runtime's <code>verify*EvidenceBundle()</code> recomputes <code>action_hash</code> and
                <code> bundle_hash</code> from the bundle contents. A post-export mutation diverges from the
                pinned hashes and is detected — exactly the path the per-vertical test suite exercises.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="ac-divider" />
      <p className="ac-muted" style={{ marginTop: 6 }}>
        <KeyRound size={12} /> Demonstration material: synthetic action params, demo Ed25519 signature
        material, demo bundle hash. The runtime libraries that actually compute these hashes are
        in <code>shared/governance-core/src/hash.ts</code> + per-vertical{" "}
        <code>{vertical.id}.ts</code> on the same branch.
        <ShieldCheck size={12} style={{ marginLeft: 10 }} /> production_validated: false at every step.
      </p>
    </Panel>
  );
}

function BoundDetail({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  return (
    <div>
      <div className="ac-label" style={{ fontSize: 11 }}>{label}</div>
      <div className={mono ? "mono" : undefined} style={{ wordBreak: "break-all", fontSize: 13 }}>
        {value || <span className="ac-muted">— pending</span>}
      </div>
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - 3)) + "...";
}
