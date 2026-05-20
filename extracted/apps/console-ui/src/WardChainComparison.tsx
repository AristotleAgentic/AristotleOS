import { useCallback, useEffect, useState, type CSSProperties } from "react";
import {
  fetchGovernanceChainLedger,
  fetchGovernanceChainMetrics,
  fetchLedgerArtifacts,
  type ChainMetricsView,
  type GelRecordView,
  type GovernanceChainLedger,
  type LedgerArtifactList,
} from "./gateway-client.js";

/**
 * Ward / Warrant chain comparison view (GOVERNANCE_CHAIN_V2).
 *
 * Additive surface that sets the ORIGINAL governance evidence (the legacy
 * evidence-ledger artifacts) side by side with the NEW Ward/Warrant chain (the
 * kernel's hash-chained GEL ledger, read through /operator/governance-chain/gel).
 * It changes nothing about the original console — it only observes both.
 */

interface Props {
  gatewayBaseUrl?: string;
  autoRefreshMs?: number;
}

const C = {
  text: "#e2e8f0",
  muted: "#94a3b8",
  faint: "#64748b",
  accent: "#22d3ee",
  card: "rgba(15, 23, 42, 0.6)",
  border: "rgba(148, 163, 184, 0.2)",
  allow: "#34d399",
  deny: "#f87171",
  failclosed: "#ef4444",
  escalate: "#fbbf24",
};

const AUTHORITY_TYPES = ["authority-envelope", "execution-warrant", "witness-receipt", "execution-decision", "finality-certificate"];

const CONTRAST: Array<{ dim: string; original: string; chain: string }> = [
  {
    dim: "Sovereignty",
    original: "mission.requestedBy — a bare string; identity and the protected interest are conflated.",
    chain: "A first-class Ward: protected interest + accountable party, constituted by a human/institutional origin act.",
  },
  {
    dim: "Authority unit",
    original: "Authority Envelope + an Execution Warrant.",
    chain: "Meta Authority Envelope → Ward → Authority Envelope → Warrant (a complete, validated chain).",
  },
  {
    dim: "Warrant lifecycle",
    original: "Reused across dispatch + completion; no nonce, no consumption state.",
    chain: "Single-use: nonce + consumption_state, consumed at the gate — replay-proof.",
  },
  {
    dim: "Commit gate",
    original: "Trusts caller-computed booleans; adds a kill-switch check.",
    chain: "Validates the whole chain, consumes the warrant, and fails CLOSED on any gap.",
  },
  {
    dim: "Receipt",
    original: "Append-only, signed events.",
    chain: "Hash-chained, tamper-evident GEL records proving authority lineage + consumption.",
  },
];

const shortId = (id?: string) => (id ? (id.length > 14 ? `${id.slice(0, 10)}…${id.slice(-4)}` : id) : "—");
const shortHash = (h?: string) => (h ? `${h.slice(0, 12)}…` : "—");
const fmt = (ts?: string) => (ts ? new Date(ts).toLocaleTimeString() : "—");

const decisionColor = (d: GelRecordView["decision"]) =>
  d === "Allow" ? C.allow : d === "Escalate" ? C.escalate : d === "FailClosed" ? C.failclosed : C.deny;

const verifyColor = (s?: string) => (s === "verified" ? C.allow : s === "failed" ? C.deny : C.faint);

function metricCell(label: string, value: string | number, color?: string) {
  return (
    <div key={label} style={styles.statCell}>
      <span style={{ ...styles.statValue, color: color ?? C.text }}>{value}</span>
      <span style={styles.statLabel}>{label}</span>
    </div>
  );
}

export default function WardChainComparison({ gatewayBaseUrl, autoRefreshMs = 8000 }: Props) {
  const [legacy, setLegacy] = useState<LedgerArtifactList | null>(null);
  const [chain, setChain] = useState<GovernanceChainLedger | null>(null);
  const [metrics, setMetrics] = useState<ChainMetricsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string>("");

  const load = useCallback(async () => {
    const [legacyRes, chainRes, metricsRes] = await Promise.allSettled([
      fetchLedgerArtifacts(gatewayBaseUrl),
      fetchGovernanceChainLedger(gatewayBaseUrl),
      fetchGovernanceChainMetrics(gatewayBaseUrl),
    ]);
    if (legacyRes.status === "fulfilled") setLegacy(legacyRes.value);
    if (chainRes.status === "fulfilled") setChain(chainRes.value);
    if (metricsRes.status === "fulfilled") setMetrics(metricsRes.value);
    setError(legacyRes.status === "rejected" ? `evidence ledger unreachable: ${String(legacyRes.reason)}` : null);
    setUpdatedAt(new Date().toLocaleTimeString());
    setLoading(false);
  }, [gatewayBaseUrl]);

  useEffect(() => {
    void load();
    if (!autoRefreshMs) return;
    const handle = setInterval(() => void load(), autoRefreshMs);
    return () => clearInterval(handle);
  }, [load, autoRefreshMs]);

  const authorityArtifacts = (legacy?.items ?? []).filter((a) => AUTHORITY_TYPES.includes(a.artifactType));
  const legacyCounts = AUTHORITY_TYPES.map((t) => ({ type: t, n: authorityArtifacts.filter((a) => a.artifactType === t).length }));
  const recentRecords = [...(chain?.records ?? [])].reverse().slice(0, 12);

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.h1}>Governance: original vs. Ward / Warrant chain</h1>
          <p style={styles.subtitle}>
            The legacy evidence ledger on the left; the new constitutional chain on the right. Read-only — the original
            console and its behavior are untouched.
          </p>
        </div>
        <div style={styles.headerRight}>
          <span style={styles.updated}>{loading ? "loading…" : `updated ${updatedAt}`}</span>
          <button style={styles.refresh} onClick={() => void load()}>↻ refresh</button>
        </div>
      </header>

      {error ? <div style={styles.errorBar}>{error}</div> : null}

      <section style={styles.contrastCard}>
        <div style={styles.contrastHead}>
          <span style={{ ...styles.contrastCell, ...styles.dimCol, color: C.muted }}>Dimension</span>
          <span style={{ ...styles.contrastCell, color: C.muted }}>Original</span>
          <span style={{ ...styles.contrastCell, color: C.accent }}>Ward / Warrant chain</span>
        </div>
        {CONTRAST.map((row) => (
          <div key={row.dim} style={styles.contrastRow}>
            <span style={{ ...styles.contrastCell, ...styles.dimCol }}>{row.dim}</span>
            <span style={{ ...styles.contrastCell, color: C.muted }}>{row.original}</span>
            <span style={{ ...styles.contrastCell, color: C.text }}>{row.chain}</span>
          </div>
        ))}
      </section>

      {metrics ? (
        <section style={styles.metricsStrip}>
          {metricCell("Wards", metrics.wards)}
          {metricCell("Envelopes", metrics.authority_envelopes)}
          {metricCell("Warrants", `${metrics.warrants.consumed}/${metrics.warrants.total}`)}
          {metricCell("Allow", metrics.gel.by_decision.Allow, C.allow)}
          {metricCell("Deny", metrics.gel.by_decision.Deny, C.deny)}
          {metricCell("Escalate", metrics.gel.by_decision.Escalate, C.escalate)}
          {metricCell("GEL records", metrics.gel.records)}
          {metricCell("Integrity", metrics.gel.integrity_ok ? "✓" : "✗", metrics.gel.integrity_ok ? C.allow : C.deny)}
          {metrics.spend.map((s) => metricCell(`Spend ${s.currency}`, s.amount, C.accent))}
        </section>
      ) : null}

      <div style={styles.columns}>
        {/* ORIGINAL */}
        <section style={styles.card}>
          <div style={styles.cardHead}>
            <h2 style={styles.h2}>Original — evidence ledger</h2>
            <span style={styles.badgeNeutral}>{authorityArtifacts.length} authority artifacts</span>
          </div>
          <div style={styles.countGrid}>
            {legacyCounts.map((c) => (
              <div key={c.type} style={styles.countCell}>
                <span style={styles.countNum}>{c.n}</span>
                <span style={styles.countLabel}>{c.type}</span>
              </div>
            ))}
          </div>
          <p style={styles.note}>Append-only, individually signed — but not chained: each artifact stands alone.</p>
          <ul style={styles.list}>
            {authorityArtifacts.slice(0, 12).map((a) => (
              <li key={a.id} style={styles.row}>
                <span style={styles.typeTag}>{a.artifactType}</span>
                <span style={styles.mono}>{shortId(a.id)}</span>
                <span style={{ ...styles.dot, background: verifyColor(a.verification?.status) }} title={a.verification?.status ?? "unverified"} />
                <span style={styles.rowTime}>{fmt(a.timestamp)}</span>
              </li>
            ))}
            {authorityArtifacts.length === 0 ? <li style={styles.empty}>No authority artifacts yet.</li> : null}
          </ul>
        </section>

        {/* WARD CHAIN */}
        <section style={{ ...styles.card, borderColor: "rgba(34, 211, 238, 0.35)" }}>
          <div style={styles.cardHead}>
            <h2 style={{ ...styles.h2, color: C.accent }}>Ward / Warrant chain — GEL</h2>
            {chain?.enabled ? (
              <span style={{ ...styles.badge, background: chain.integrity?.ok ? "rgba(52,211,153,0.15)" : "rgba(248,113,113,0.15)", color: chain.integrity?.ok ? C.allow : C.deny }}>
                {chain.integrity?.ok ? "✓ chain verified" : "✗ chain broken"} · {chain.count ?? 0} records
              </span>
            ) : (
              <span style={styles.badgeOff}>disabled</span>
            )}
          </div>

          {!chain?.enabled ? (
            <div style={styles.offNotice}>
              <strong style={{ color: C.text }}>GOVERNANCE_CHAIN_V2 is off or unreachable.</strong>
              <p style={styles.note}>
                Set <code style={styles.code}>GOVERNANCE_CHAIN_V2=true</code> on the gateway + kernel (and let agent-os run
                in <code style={styles.code}>shadow</code> or <code style={styles.code}>enforce</code> mode) to populate this column.
              </p>
              {chain?.reason ? <p style={{ ...styles.note, color: C.faint }}>{chain.reason}</p> : null}
            </div>
          ) : (
            <>
              <p style={styles.note}>
                Each record is hash-linked to its predecessor and proves the full authority lineage
                (MAE → Ward → Envelope → Warrant) with a consumption proof.
              </p>
              <ul style={styles.list}>
                {recentRecords.map((r) => (
                  <li key={r.gel_record_id} style={styles.recordRow}>
                    <div style={styles.recordTop}>
                      <span style={{ ...styles.decisionPill, color: decisionColor(r.decision), borderColor: decisionColor(r.decision) }}>
                        {r.decision}
                      </span>
                      <span style={styles.recordAction}>{r.action}</span>
                      <span style={styles.recordSeq}>#{r.sequence}</span>
                    </div>
                    <div style={styles.recordMeta}>
                      <span>ward {shortId(r.ward_id)}</span>
                      <span>
                        warrant{" "}
                        {r.warrant_consumption_proof ? (
                          <span style={{ color: C.allow }}>consumed ✓</span>
                        ) : (
                          <span style={{ color: C.faint }}>—</span>
                        )}
                      </span>
                      <span style={styles.mono}>{shortHash(r.gel_record_hash)}</span>
                      <span style={styles.rowTime}>{fmt(r.timestamp)}</span>
                    </div>
                  </li>
                ))}
                {recentRecords.length === 0 ? <li style={styles.empty}>Chain enabled, no records committed yet.</li> : null}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  page: { maxWidth: 1200, margin: "0 auto", padding: "24px 28px 64px", color: C.text },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 20 },
  h1: { margin: 0, fontSize: 22, fontWeight: 600 },
  subtitle: { margin: "6px 0 0", color: C.muted, fontSize: 13, maxWidth: 720, lineHeight: 1.5 },
  headerRight: { display: "flex", alignItems: "center", gap: 12, whiteSpace: "nowrap" },
  updated: { color: C.faint, fontSize: 12 },
  refresh: { background: "rgba(34,211,238,0.12)", color: C.accent, border: `1px solid ${C.border}`, borderRadius: 8, padding: "6px 12px", cursor: "pointer" },
  errorBar: { background: "rgba(248,113,113,0.12)", color: C.deny, border: "1px solid rgba(248,113,113,0.3)", borderRadius: 8, padding: "8px 12px", marginBottom: 16, fontSize: 13 },
  contrastCard: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 4, marginBottom: 24, overflow: "hidden" },
  contrastHead: { display: "grid", gridTemplateColumns: "140px 1fr 1fr", gap: 12, padding: "10px 14px", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 },
  contrastRow: { display: "grid", gridTemplateColumns: "140px 1fr 1fr", gap: 12, padding: "12px 14px", borderTop: `1px solid ${C.border}`, fontSize: 13, lineHeight: 1.45 },
  contrastCell: {},
  dimCol: { fontWeight: 600, color: C.text },
  metricsStrip: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8, marginBottom: 24 },
  statCell: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", textAlign: "center" },
  statValue: { display: "block", fontSize: 18, fontWeight: 700 },
  statLabel: { display: "block", fontSize: 10.5, color: C.faint, marginTop: 3 },
  columns: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" },
  card: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 },
  cardHead: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14 },
  h2: { margin: 0, fontSize: 16, fontWeight: 600 },
  badge: { fontSize: 12, padding: "4px 10px", borderRadius: 999, fontWeight: 600 },
  badgeNeutral: { fontSize: 12, padding: "4px 10px", borderRadius: 999, background: "rgba(148,163,184,0.12)", color: C.muted },
  badgeOff: { fontSize: 12, padding: "4px 10px", borderRadius: 999, background: "rgba(148,163,184,0.12)", color: C.faint },
  countGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", gap: 8, marginBottom: 12 },
  countCell: { background: "rgba(2,6,23,0.5)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 8px", textAlign: "center" },
  countNum: { display: "block", fontSize: 20, fontWeight: 700 },
  countLabel: { display: "block", fontSize: 10.5, color: C.faint, marginTop: 2 },
  note: { color: C.muted, fontSize: 12.5, lineHeight: 1.5, margin: "6px 0 12px" },
  code: { background: "rgba(2,6,23,0.6)", border: `1px solid ${C.border}`, borderRadius: 4, padding: "1px 5px", fontSize: 12 },
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 },
  row: { display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", background: "rgba(2,6,23,0.4)", borderRadius: 8, fontSize: 12.5 },
  typeTag: { fontSize: 11, color: C.muted, minWidth: 132 },
  mono: { fontFamily: "ui-monospace, SFMono-Regular, monospace", color: C.faint, fontSize: 11.5 },
  dot: { width: 8, height: 8, borderRadius: 999, display: "inline-block" },
  rowTime: { marginLeft: "auto", color: C.faint, fontSize: 11 },
  empty: { color: C.faint, fontSize: 12.5, padding: "8px 10px", fontStyle: "italic" },
  offNotice: { background: "rgba(2,6,23,0.4)", border: `1px dashed ${C.border}`, borderRadius: 8, padding: 14 },
  recordRow: { padding: "9px 10px", background: "rgba(2,6,23,0.4)", borderRadius: 8, display: "flex", flexDirection: "column", gap: 5 },
  recordTop: { display: "flex", alignItems: "center", gap: 10 },
  decisionPill: { fontSize: 11, fontWeight: 700, border: "1px solid", borderRadius: 6, padding: "1px 7px" },
  recordAction: { fontSize: 12.5, color: C.text },
  recordSeq: { marginLeft: "auto", color: C.faint, fontSize: 11 },
  recordMeta: { display: "flex", alignItems: "center", gap: 14, color: C.muted, fontSize: 11.5, flexWrap: "wrap" },
};
