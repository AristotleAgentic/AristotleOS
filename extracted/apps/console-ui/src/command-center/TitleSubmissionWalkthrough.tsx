import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Play,
  RotateCcw,
  Send,
  ShieldCheck,
  Wrench
} from "lucide-react";
import React from "react";
import { Badge, Metric, Panel, cx } from "./primitives.js";

/**
 * Outbound title submission walkthrough.
 *
 * Runs an end-to-end demonstration of the warrant -> submit -> receipt ->
 * evidence-bundle-binding -> verify chain that ships in
 * shared/execution-control-runtime/src/title.ts (submitTitlePacket,
 * DemonstrationTitleSubmissionTransport, verifyTitleSubmissionReceipt).
 *
 * The runtime contract is implemented for real on the server; this UI runs
 * the same cryptographic shape entirely client-side using Web Crypto
 * SHA-256 + a stable JSON stringify. The hashes shown here are real -- the
 * tamper-detection demo actually re-verifies and observes a mismatch.
 */

// --- Pure helpers (browser Web Crypto) ------------------------------------

async function sha256Hex(s: string): Promise<string> {
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

// --- Types ----------------------------------------------------------------

interface CanonicalAction {
  action_id: string;
  ward_id: string;
  subject: string;
  action_type: string;
  params: Record<string, unknown>;
  requested_at: string;
}

interface SubmissionAuthorization {
  warrant_id: string;
  warrant_signature: string;
  consumed: true;
  consumed_at: string;
  action_hash: string;
  jurisdiction: string;
  transaction_type: string;
}

interface SubmissionReceipt {
  packet_id: string;
  jurisdiction: string;
  transport: string;
  channel: "demonstration-echo";
  remote_receipt_id: string;
  ack_at: string;
  ack_kind: "accepted" | "queued" | "pending-review";
  warrant_id: string;
  action_hash: string;
  production_validated: false;
  receipt_hash: string;
}

interface BundleSnapshot {
  bundle_version: "aristotle.title-evidence.v1";
  context_hash: string;
  bundle_hash: string;
}

interface Verification {
  receipt_ok: boolean;
  bundle_ok: boolean;
  failures: string[];
}

// --- Step state machine ---------------------------------------------------

type StepKey = "action" | "warrant" | "submit" | "bind" | "verify";

interface StepState {
  key: StepKey;
  title: string;
  description: string;
}

const STEPS: StepState[] = [
  { key: "action", title: "1 · Build canonical action", description: "Operator intent serialized to a Canonical Governed Action, hashed for binding." },
  { key: "warrant", title: "2 · Commit Gate → Warrant", description: "Gate ALLOWs; single-use Ed25519 Warrant issued, pinned to the action hash." },
  { key: "submit", title: "3 · Demo transport submit", description: "submitTitlePacket → DemonstrationTitleSubmissionTransport. Receipt hash covers warrant_id + action_hash + ack metadata." },
  { key: "bind", title: "4 · Bind into Title Evidence Bundle", description: "Receipt embedded in TitleEvidenceContext. Bundle hash now covers the receipt transitively." },
  { key: "verify", title: "5 · Verify (and tamper-detect)", description: "verifyTitleSubmissionReceipt + verifyTitleEvidenceBundle. Tamper mutates remote_receipt_id post-export." }
];

// --- The component --------------------------------------------------------

export function TitleSubmissionWalkthrough() {
  const [running, setRunning] = React.useState<boolean>(false);
  const [stepIdx, setStepIdx] = React.useState<number>(-1);
  const [action, setAction] = React.useState<CanonicalAction | null>(null);
  const [actionHash, setActionHash] = React.useState<string | null>(null);
  const [authz, setAuthz] = React.useState<SubmissionAuthorization | null>(null);
  const [receipt, setReceipt] = React.useState<SubmissionReceipt | null>(null);
  const [bundle, setBundle] = React.useState<BundleSnapshot | null>(null);
  const [verification, setVerification] = React.useState<Verification | null>(null);
  const [tampered, setTampered] = React.useState<boolean>(false);

  const reset = () => {
    setStepIdx(-1);
    setAction(null);
    setActionHash(null);
    setAuthz(null);
    setReceipt(null);
    setBundle(null);
    setVerification(null);
    setTampered(false);
  };

  const run = async () => {
    if (running) return;
    setRunning(true);
    reset();

    // Deterministic-ish timestamp so the demo is reproducible across runs.
    const now = "2026-05-26T15:00:00.000Z";

    // 1) Action
    setStepIdx(0);
    const a: CanonicalAction = {
      action_id: "act-title-mt-0007",
      ward_id: "ward-title-mt-lender-ops",
      subject: "agent:lender-orchestrator",
      action_type: "title.lien_release",
      params: {
        vin: "1HGCM82633A123456",
        jurisdiction: "MT",
        transaction_type: "lien_release",
        lienholder_id: "lender:demo-bank-mt",
        payoff_quote_id: "pq-001"
      },
      requested_at: now
    };
    const aHash = "sha256:" + (await sha256Hex(stableStringify(a)));
    setAction(a);
    setActionHash(aHash);
    await sleep(180);

    // 2) Warrant
    setStepIdx(1);
    const z: SubmissionAuthorization = {
      warrant_id: "warrant:demo-MT-" + (await shortHex(a.action_id, 6)),
      warrant_signature: "ed25519:" + (await shortHex(aHash, 32)),
      consumed: true,
      consumed_at: "2026-05-26T15:00:00.500Z",
      action_hash: aHash,
      jurisdiction: "MT",
      transaction_type: "lien_release"
    };
    setAuthz(z);
    await sleep(180);

    // 3) Submit through demo transport
    setStepIdx(2);
    const remoteReceiptId = "demo-MT-" + (await shortHex(z.warrant_id, 6));
    const partial = {
      packet_id: "pkt-MT-0007",
      jurisdiction: "MT",
      transport: "demonstration-echo",
      channel: "demonstration-echo" as const,
      remote_receipt_id: remoteReceiptId,
      ack_at: "2026-05-26T15:00:01.000Z",
      ack_kind: "accepted" as const,
      warrant_id: z.warrant_id,
      action_hash: z.action_hash,
      production_validated: false as const
    };
    const receipt_hash = await sha256Hex(stableStringify(partial));
    const r: SubmissionReceipt = { ...partial, receipt_hash };
    setReceipt(r);
    await sleep(220);

    // 4) Bind into bundle
    setStepIdx(3);
    const titleCtx = {
      actor_id: "actor:lender-signer-jane",
      organization_id: "org:demo-bank-mt",
      organization_kind: "lender",
      jurisdiction: "MT",
      state_rule_version: "mt-demo-2026-05-25",
      transaction_id: "TX-LIEN-MT-2026-05-26-0007",
      transaction_type: "lien_release",
      vin: "1HGCM82633A123456",
      title_state: "clear",
      rule_validation_state: "demonstration",
      submission_receipt: r
    };
    const context_hash = await sha256Hex(stableStringify(titleCtx));
    const bundle_hash = await sha256Hex(stableStringify({
      bundle_version: "aristotle.title-evidence.v1",
      exported_at: "2026-05-26T15:00:01.250Z",
      context_hash,
      execution_bundle_hash: "0x" + (await shortHex(aHash + z.warrant_id, 16))
    }));
    setBundle({ bundle_version: "aristotle.title-evidence.v1", context_hash, bundle_hash });
    await sleep(180);

    // 5) Verify
    setStepIdx(4);
    const recheckPartial = { ...r };
    const { receipt_hash: _drop, ...recheckBody } = recheckPartial;
    void _drop;
    const recomputedReceiptHash = await sha256Hex(stableStringify(recheckBody));
    const recomputedContextHash = await sha256Hex(stableStringify(titleCtx));
    setVerification({
      receipt_ok: recomputedReceiptHash === r.receipt_hash,
      bundle_ok: recomputedContextHash === context_hash,
      failures: []
    });

    setRunning(false);
  };

  const tamper = async () => {
    if (!receipt || !bundle) return;
    setTampered(true);
    // Mutate remote_receipt_id post-export. Re-verify bundle context_hash and
    // receipt_hash to demonstrate detection.
    const mutated: SubmissionReceipt = { ...receipt, remote_receipt_id: "demo-MT-000666-MITM" };
    const mutatedTitleCtx = {
      actor_id: "actor:lender-signer-jane",
      organization_id: "org:demo-bank-mt",
      organization_kind: "lender",
      jurisdiction: "MT",
      state_rule_version: "mt-demo-2026-05-25",
      transaction_id: "TX-LIEN-MT-2026-05-26-0007",
      transaction_type: "lien_release",
      vin: "1HGCM82633A123456",
      title_state: "clear",
      rule_validation_state: "demonstration",
      submission_receipt: mutated
    };
    const recomputedContextHash = await sha256Hex(stableStringify(mutatedTitleCtx));
    const { receipt_hash: _drop, ...mutatedReceiptBody } = mutated;
    void _drop;
    const recomputedReceiptHash = await sha256Hex(stableStringify(mutatedReceiptBody));
    const failures: string[] = [];
    if (recomputedReceiptHash !== receipt.receipt_hash) failures.push("receipt_hash mismatch");
    if (recomputedContextHash !== bundle.context_hash) failures.push("title_context_hash mismatch");
    setReceipt(mutated);
    setVerification({
      receipt_ok: recomputedReceiptHash === receipt.receipt_hash,
      bundle_ok: recomputedContextHash === bundle.context_hash,
      failures
    });
  };

  return (
    <Panel
      title="Outbound Submission Walkthrough"
      icon={<Send size={15} />}
      right={
        <div style={{ display: "flex", gap: 6 }}>
          <Badge tone="amber">demonstration transport</Badge>
          <button className="ac-btn" onClick={run} disabled={running}>
            <Play size={13} /> {stepIdx >= 0 ? "Re-run" : "Run"}
          </button>
          <button
            className="ac-btn"
            onClick={tamper}
            disabled={running || !receipt || tampered}
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
        End-to-end walkthrough of warrant {"->"} submit {"->"} receipt {"->"} evidence-bundle binding {"->"} verify.
        Hashes are computed live in the browser via Web Crypto SHA-256 + stable JSON canonicalization
        (the same shape the runtime uses). The demonstration transport reports
        <code> production_validated: false</code> -- the orchestrator refuses to ship its receipts into
        a real evidence bundle by default.
      </p>

      <div className="ac-grid ac-cols-2" style={{ marginTop: 12 }}>
        {STEPS.map((s, i) => (
          <div
            key={s.key}
            className={cx("ac-slo-card")}
            style={{
              opacity: stepIdx >= i ? 1 : 0.55,
              borderColor: stepIdx === i ? "var(--ac-cyan)" : undefined,
              borderWidth: 1, borderStyle: "solid"
            }}
          >
            <div className="ac-slo-head">
              <span>{s.title}</span>
              {stepIdx > i && <Badge tone="green">done</Badge>}
              {stepIdx === i && <Badge tone="cyan">active</Badge>}
              {stepIdx < i && <Badge tone="slate">pending</Badge>}
            </div>
            <p style={{ marginTop: 8 }}>{s.description}</p>
            {s.key === "action" && action && actionHash && (
              <DetailRows
                rows={[
                  ["action_id", action.action_id, true],
                  ["action_type", action.action_type, true],
                  ["action_hash", actionHash, true]
                ]}
              />
            )}
            {s.key === "warrant" && authz && (
              <DetailRows
                rows={[
                  ["warrant_id", authz.warrant_id, true],
                  ["signature", authz.warrant_signature, true],
                  ["consumed", "true", false],
                  ["bound action_hash", authz.action_hash, true]
                ]}
              />
            )}
            {s.key === "submit" && receipt && (
              <DetailRows
                rows={[
                  ["packet_id", receipt.packet_id, true],
                  ["remote_receipt_id", receipt.remote_receipt_id, true],
                  ["transport", receipt.transport + " (production_validated: false)", false],
                  ["ack_kind", receipt.ack_kind, false],
                  ["receipt_hash", receipt.receipt_hash, true]
                ]}
              />
            )}
            {s.key === "bind" && bundle && (
              <DetailRows
                rows={[
                  ["bundle_version", bundle.bundle_version, true],
                  ["title_context_hash", bundle.context_hash, true],
                  ["title_bundle_hash", bundle.bundle_hash, true]
                ]}
              />
            )}
            {s.key === "verify" && verification && (
              <VerificationBlock verification={verification} tampered={tampered} />
            )}
          </div>
        ))}
      </div>

      {stepIdx >= 0 && (
        <div className="ac-grid ac-cols-2" style={{ marginTop: 14 }}>
          <Metric label="Action hash bound" value={actionHash ? "yes" : "—"} tone="cyan" />
          <Metric label="Warrant single-use" value={authz ? "consumed" : "—"} tone={authz ? "green" : "slate"} />
          <Metric label="Demo transport receipt" value={receipt ? "issued" : "—"} tone={receipt ? "green" : "slate"} />
          <Metric label="Bundle verification" value={verification ? (verification.bundle_ok && verification.receipt_ok ? "ok" : "broken") : "—"} tone={verification ? (verification.bundle_ok && verification.receipt_ok ? "green" : "red") : "slate"} />
        </div>
      )}
    </Panel>
  );
}

function DetailRows({ rows }: { rows: Array<[string, string, boolean]> }) {
  return (
    <div className="ac-detail-grid" style={{ gridTemplateColumns: "160px 1fr", marginTop: 10 }}>
      {rows.map(([k, v, mono]) => (
        <React.Fragment key={k}>
          <dt>{k}</dt>
          <dd className={mono ? "mono" : undefined} style={{ wordBreak: "break-all" }}>{v}</dd>
        </React.Fragment>
      ))}
    </div>
  );
}

function VerificationBlock({ verification, tampered }: { verification: Verification; tampered: boolean }) {
  const allOk = verification.receipt_ok && verification.bundle_ok;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        {verification.receipt_ok
          ? <><CheckCircle2 size={14} color="var(--ac-green)" /> receipt_hash matches</>
          : <><AlertCircle size={14} color="var(--ac-red)" /> receipt_hash MISMATCH</>}
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 6 }}>
        {verification.bundle_ok
          ? <><CheckCircle2 size={14} color="var(--ac-green)" /> title_context_hash matches</>
          : <><AlertCircle size={14} color="var(--ac-red)" /> title_context_hash MISMATCH</>}
      </div>
      {!allOk && (
        <div style={{ marginTop: 10 }}>
          <Badge tone="red">verifyTitleEvidenceBundle: failed</Badge>
          {verification.failures.length > 0 && (
            <ul className="ac-muted" style={{ marginTop: 6, paddingLeft: 18 }}>
              {verification.failures.map((f) => <li key={f}>{f}</li>)}
            </ul>
          )}
          {tampered && (
            <p className="ac-muted" style={{ marginTop: 6 }}>
              The post-export mutation of <code>remote_receipt_id</code> is detected by
              <code> verifyTitleEvidenceBundle</code> because the receipt is hashed into the
              <code> title_context_hash</code> at export time. This is the same path the runtime tests
              exercise in <code>title.test.ts</code>.
            </p>
          )}
        </div>
      )}
      {allOk && (
        <p className="ac-muted" style={{ marginTop: 6 }}>
          <ShieldCheck size={13} /> Both hashes recompute. The bundle is valid; the receipt is
          cryptographically bound to <code>warrant_id</code> + <code>action_hash</code>.
        </p>
      )}
    </div>
  );
}

async function shortHex(seed: string, n: number): Promise<string> {
  return (await sha256Hex(seed)).slice(0, n);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Lazy-imported for the right card's badge inside Verify step.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _icons = { KeyRound, ShieldCheck };
