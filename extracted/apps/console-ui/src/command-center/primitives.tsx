import React from "react";
import { Inbox, RotateCcw, TriangleAlert, X } from "lucide-react";
import type { CommitDecision, NodeState, RiskLevel } from "./types.js";

export type Tone = "green" | "amber" | "red" | "cyan" | "violet" | "slate";

export const cx = (...parts: Array<string | false | null | undefined>): string => parts.filter(Boolean).join(" ");

/* ---------- domain → presentation mappings ---------- */
export function stateTone(state: NodeState): Tone {
  switch (state) {
    case "active": return "green";
    case "degraded": return "amber";
    case "awaiting-warrant": return "cyan";
    case "escalated": return "violet";
    case "partitioned": return "amber";
    case "revoked": return "red";
    case "fail-closed": return "red";
    default: return "slate";
  }
}
export function stateLabel(state: NodeState): string {
  return state.replace(/-/g, " ");
}
export function decisionTone(d: CommitDecision): Tone {
  switch (d) {
    case "allow": return "green";
    case "refuse": return "red";
    case "escalate": return "violet";
    case "simulate": return "cyan";
    case "fail-closed": return "red";
    default: return "slate";
  }
}
export function riskTone(r: RiskLevel): Tone {
  switch (r) {
    case "routine": return "slate";
    case "elevated": return "cyan";
    case "high": return "amber";
    case "critical": return "red";
    default: return "slate";
  }
}

/* ---------- formatters ---------- */
export function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.round(diff / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}
export function truncHash(h: string, head = 8): string {
  if (!h || h.length <= head + 2) return h;
  return `${h.slice(0, head)}…`;
}

/* ---------- primitives ---------- */
export function StatusDot({ tone, pulse, idle }: { tone?: Tone; pulse?: boolean; idle?: boolean }) {
  return <span className={cx("ac-dot", idle ? "is-idle" : `is-${tone ?? "slate"}`, pulse && "pulse")} />;
}

export function Badge({ tone = "slate", children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={cx("ac-badge", `t-${tone}`)}>{children}</span>;
}

export function StateBadge({ state }: { state: NodeState }) {
  return <span className={cx("ac-badge", `t-${stateTone(state)}`)}><StatusDot tone={stateTone(state)} pulse={state === "escalated" || state === "awaiting-warrant"} />{stateLabel(state)}</span>;
}

export function Panel({
  title,
  icon,
  right,
  children,
  flush,
  className,
  style
}: {
  title?: React.ReactNode;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  flush?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <section className={cx("ac-panel", className)} style={style}>
      {title !== undefined && (
        <header className="ac-panel-head">
          {icon && <span className="ac-ph-icon">{icon}</span>}
          <span className="ac-ph-title">{title}</span>
          {right && <span className="ac-ph-right">{right}</span>}
        </header>
      )}
      <div className={cx("ac-panel-body", flush && "is-flush")}>{children}</div>
    </section>
  );
}

export function Metric({ label, value, unit, tone, sm }: { label: string; value: React.ReactNode; unit?: string; tone?: Tone; sm?: boolean }) {
  return (
    <div className="ac-metric">
      <span className="ac-metric-label">{label}</span>
      <span className={cx("ac-metric-val", sm && "sm")} style={tone ? { color: `var(--ac-${tone})` } : undefined}>
        {value}
        {unit && <span className="ac-metric-unit"> {unit}</span>}
      </span>
    </div>
  );
}

/* SVG ring gauge — value 0..1 */
export function RingGauge({ value, label, tone = "cyan", size = 92 }: { value: number; label?: string; tone?: Tone; size?: number }) {
  const r = size / 2 - 8;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  const color = `var(--ac-${tone})`;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--ac-panel-3)" strokeWidth={7} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dashoffset 0.5s ease", filter: `drop-shadow(0 0 5px ${color})` }}
        />
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fontFamily="var(--ac-mono)" fontSize={size * 0.2} fill="var(--ac-text)" fontWeight={600}>
          {Math.round(v * 100)}%
        </text>
      </svg>
      {label && <span className="ac-gauge-label">{label}</span>}
    </div>
  );
}

/* SVG sparkline */
export function Sparkline({ data, width = 240, height = 48, tone = "cyan", fill = true }: { data: number[]; width?: number; height?: number; tone?: Tone; fill?: boolean }) {
  if (data.length === 0) return <svg width={width} height={height} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const stepX = width / (data.length - 1 || 1);
  const pts = data.map((d, i) => [i * stepX, height - 4 - ((d - min) / span) * (height - 8)] as const);
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const color = `var(--ac-${tone})`;
  const gid = React.useId();
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ width: "100%" }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#${gid})`} />}
      <path d={line} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function Drawer({ title, icon, onClose, children }: { title: React.ReactNode; icon?: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div className="ac-drawer-scrim" onClick={onClose} />
      <aside className="ac-drawer" role="dialog" aria-modal="true">
        <header className="ac-drawer-head">
          {icon && <span className="ac-ph-icon">{icon}</span>}
          <span className="ac-ph-title" style={{ fontSize: 13 }}>{title}</span>
          <button className="ac-iconbtn" style={{ marginLeft: "auto" }} onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="ac-drawer-body">{children}</div>
      </aside>
    </>
  );
}

export function DetailGrid({ rows }: { rows: Array<[string, React.ReactNode, boolean?]> }) {
  return (
    <dl className="ac-detail-grid">
      {rows.map(([k, v, mono], i) => (
        <React.Fragment key={i}>
          <dt>{k}</dt>
          <dd className={mono ? "mono" : undefined}>{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/* Two-stage confirm for dangerous operator actions */
export function ConfirmAction({
  label,
  icon,
  description,
  danger,
  onConfirm
}: {
  label: string;
  icon?: React.ReactNode;
  description: string;
  danger?: boolean;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = React.useState(false);
  if (!armed) {
    return (
      <button className={cx("ac-ops-btn", danger && "danger")} onClick={() => setArmed(true)}>
        <span className="ic">{icon}</span>
        <span>
          <span className="t">{label}</span>
          <span className="d">{description}</span>
        </span>
      </button>
    );
  }
  return (
    <div className={cx("ac-ops-btn", danger && "danger")} style={{ flexDirection: "column", gap: 10 }}>
      <span className="d" style={{ color: danger ? "var(--ac-red)" : "var(--ac-amber)" }}>
        Confirm: {label}? This is logged to the evidence ledger.
      </span>
      <div style={{ display: "flex", gap: 8 }}>
        <button className={cx("ac-btn", danger ? "is-danger" : "is-primary")} onClick={() => { setArmed(false); onConfirm(); }}>Confirm</button>
        <button className="ac-btn" onClick={() => setArmed(false)}>Cancel</button>
      </div>
    </div>
  );
}

/* ---------- empty / error states ---------- */
export function EmptyState({ icon, title, hint }: { icon?: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="ac-state">
      <span className="ac-state-icon">{icon ?? <Inbox size={22} />}</span>
      <span className="ac-state-title">{title}</span>
      {hint && <span className="ac-state-hint">{hint}</span>}
    </div>
  );
}

export function ErrorState({ title, detail, onRetry }: { title: string; detail?: string; onRetry?: () => void }) {
  return (
    <div className="ac-state is-error">
      <span className="ac-state-icon"><TriangleAlert size={22} /></span>
      <span className="ac-state-title">{title}</span>
      {detail && <span className="ac-state-hint">{detail}</span>}
      {onRetry && (
        <button className="ac-btn" style={{ marginTop: 12 }} onClick={onRetry}>
          <RotateCcw size={13} /> Try again
        </button>
      )}
    </div>
  );
}

/**
 * Catches render errors in a section so a single broken panel shows a clear,
 * recoverable message instead of blanking the whole console. Resets when the
 * active section changes.
 */
export class SectionErrorBoundary extends React.Component<
  { children: React.ReactNode; section?: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidUpdate(prev: { section?: string }): void {
    if (prev.section !== this.props.section && this.state.error) this.setState({ error: null });
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <ErrorState
          title="This view hit an unexpected error"
          detail={`${this.state.error.message}. The governance boundary is unaffected — this is a console rendering issue.`}
          onRetry={() => this.setState({ error: null })}
        />
      );
    }
    return this.props.children;
  }
}
