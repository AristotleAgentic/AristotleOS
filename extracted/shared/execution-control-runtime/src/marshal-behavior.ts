import {
  type ExecutionControlDecision,
  type GelRecord,
  sha256,
  stableStringify
} from "./index.js";

/**
 * Ward Marshal — behavioral analysis.
 *
 * Detection over a time-ordered stream of governance events. Per-subject signals:
 * denial bursts, rate spikes vs a baseline, first-seen agents, off-hours activity,
 * target fan-out, privilege escalation (routine → sensitive pivot), and new-capability
 * scope creep. Cross-agent / fleet signals: configurable sequence chains (the
 * "A reads → B exfiltrates → C deletes" collusion pattern), coordinated campaigns
 * (one action refused across many agents at once), peer-group volume outliers, and
 * shared-credential lateral movement.
 *
 * Two properties make this AristotleOS-native rather than a generic SIEM rule:
 *   1. It runs over the signed Governance Evidence Ledger as its substrate — the
 *      same tamper-evident record the gate already produces (see behaviorEventsFromGel).
 *   2. Findings are deterministic + content-hashed and carry a recommended Ward
 *      Marshal disposition, so a high/critical detection can route straight into
 *      warrant-gated interdiction. Detection is not the end state — governed
 *      response is. (sverm-class behavioral analysis stops at the alert.)
 */

export type BehaviorFindingKind =
  | "denial_burst"
  | "rate_spike"
  | "first_seen"
  | "off_hours"
  | "target_fanout"
  | "sequence_chain"
  | "coordinated_denial"
  | "peer_anomaly"
  | "privilege_escalation"
  | "new_capability"
  | "credential_reuse";

export type BehaviorSeverity = "low" | "medium" | "high" | "critical";
export type BehaviorDisposition = "observe" | "shadow_profile" | "request_authority_review" | "quarantine" | "terminate_execution";

export interface BehaviorEvent {
  event_id: string;
  occurred_at: string;
  subject: string;
  action_type?: string;
  target?: string;
  decision?: ExecutionControlDecision;
  reason_codes?: string[];
  ward_id?: string;
  /** Optional usage/cost signal for spike detection (e.g. tokens, dollars, calls). */
  cost?: number;
  /** Credential references this event used; the same ref across subjects is lateral movement. */
  credential_refs?: string[];
  labels?: Record<string, string>;
}

/** One step of a cross-agent sequence rule: a case-insensitive regex on action_type. */
export interface SequenceStep {
  match: string;
  /** When set, the step only matches events with this decision. */
  decision?: ExecutionControlDecision;
}

export interface SequenceRule {
  id: string;
  name: string;
  steps: SequenceStep[];
  /** Max elapsed time from the first step to the last, in ms. */
  withinMs: number;
  /** When true, steps may be performed by different subjects (collusion). Default false. */
  crossSubject?: boolean;
  severity: BehaviorSeverity;
}

export interface BehaviorAnalysisConfig {
  now?: string;
  /** Rolling window for denial/rate/fanout detectors, in ms. Default 1h. */
  windowMs?: number;
  /** REFUSE count within the window (per subject) that trips a denial burst. Default 5. */
  denialBurstThreshold?: number;
  /** Recent-vs-baseline rate multiple that trips a spike. Default 3. */
  rateSpikeFactor?: number;
  /** Minimum recent-window events before a rate spike can trip (noise floor). Default 5. */
  rateSpikeMinEvents?: number;
  /** Distinct targets within the window (per subject) that trips fan-out. Default 8. */
  fanoutThreshold?: number;
  /** Allowed activity hours [startUtc, endUtc) in UTC 0-23; activity outside flags off_hours. */
  allowedHoursUtc?: { start: number; end: number };
  /** Known/approved subjects; a subject absent from this set flags first_seen. */
  knownSubjects?: string[];
  /** Cross-agent sequence rules. */
  sequenceRules?: SequenceRule[];
  /** Distinct subjects refused the *same* action within the window that trips a coordinated campaign. Default 3. */
  coordinatedThreshold?: number;
  /** Minimum distinct subjects before peer-group outlier analysis runs (noise floor). Default 4. */
  peerMinSubjects?: number;
  /** Standard deviations above the peer mean that flag a volume outlier. Default 3. */
  peerStdevFactor?: number;
  /** Action-type regexes considered sensitive/privileged; escalation toward these is flagged. */
  sensitiveActions?: string[];
  /** Minimum per-subject events before new-capability (scope-creep) analysis runs. Default 4. */
  newCapabilityMinEvents?: number;
}

export interface BehaviorFinding {
  finding_id: string;
  kind: BehaviorFindingKind;
  severity: BehaviorSeverity;
  subjects: string[];
  detail: string;
  event_ids: string[];
  window: { from: string; to: string };
  recommended_disposition: BehaviorDisposition;
  evidence_hash: string;
}

export interface BehaviorReport {
  report_version: "aristotle.ward-marshal.behavior.v1";
  generated_at: string;
  doctrine: "authority-before-consequence";
  summary: {
    events: number;
    findings: number;
    high_or_critical: number;
    by_kind: Record<BehaviorFindingKind, number>;
  };
  findings: BehaviorFinding[];
  report_hash: string;
}

/** Map signed GEL records into the behavior event stream (subject/decision/timing
 *  signals). The GEL stores the action *hash*, not action_type, so sequence-chain
 *  rules need an enriched stream (e.g. from the proxy/audit layer); the other
 *  detectors run natively over the ledger. */
export function behaviorEventsFromGel(records: GelRecord[]): BehaviorEvent[] {
  return records.map((record) => ({
    event_id: record.record_id,
    occurred_at: record.timestamp,
    subject: record.subject,
    decision: record.decision,
    reason_codes: record.reason_codes,
    ward_id: record.ward_id
  }));
}

export function analyzeAgentBehavior(events: BehaviorEvent[], config: BehaviorAnalysisConfig = {}): BehaviorReport {
  const generated_at = config.now ?? new Date().toISOString();
  const windowMs = config.windowMs ?? 3_600_000;
  const sorted = [...events].sort((a, b) => (a.occurred_at === b.occurred_at ? a.event_id.localeCompare(b.event_id) : a.occurred_at.localeCompare(b.occurred_at)));

  const findings: BehaviorFinding[] = [
    ...detectDenialBursts(sorted, windowMs, config.denialBurstThreshold ?? 5),
    ...detectRateSpikes(sorted, config.rateSpikeFactor ?? 3, config.rateSpikeMinEvents ?? 5),
    ...detectFirstSeen(sorted, config.knownSubjects),
    ...detectOffHours(sorted, config.allowedHoursUtc),
    ...detectFanout(sorted, windowMs, config.fanoutThreshold ?? 8),
    ...detectSequences(sorted, config.sequenceRules ?? []),
    ...detectCoordinatedDenials(sorted, windowMs, config.coordinatedThreshold ?? 3),
    ...detectPeerAnomalies(sorted, config.peerMinSubjects ?? 4, config.peerStdevFactor ?? 3),
    ...detectPrivilegeEscalation(sorted, windowMs, config.sensitiveActions),
    ...detectNewCapability(sorted, config.newCapabilityMinEvents ?? 4),
    ...detectCredentialReuse(sorted)
  ].sort((a, b) => a.finding_id.localeCompare(b.finding_id));

  const by_kind = {
    denial_burst: 0, rate_spike: 0, first_seen: 0, off_hours: 0, target_fanout: 0, sequence_chain: 0,
    coordinated_denial: 0, peer_anomaly: 0, privilege_escalation: 0, new_capability: 0, credential_reuse: 0
  } as Record<BehaviorFindingKind, number>;
  for (const finding of findings) by_kind[finding.kind] += 1;

  const summary = {
    events: events.length,
    findings: findings.length,
    high_or_critical: findings.filter((f) => f.severity === "high" || f.severity === "critical").length,
    by_kind
  };

  const report_hash = sha256(stableStringify({ doctrine: "authority-before-consequence", findings, generated_at, summary }));
  return { report_version: "aristotle.ward-marshal.behavior.v1", generated_at, doctrine: "authority-before-consequence", summary, findings, report_hash };
}

// --- detectors --------------------------------------------------------------

function bySubject(events: BehaviorEvent[]): Map<string, BehaviorEvent[]> {
  const map = new Map<string, BehaviorEvent[]>();
  for (const event of events) map.set(event.subject, [...(map.get(event.subject) ?? []), event]);
  return map;
}

function ms(at: string): number {
  return Date.parse(at);
}

function makeFinding(kind: BehaviorFindingKind, severity: BehaviorSeverity, subjects: string[], detail: string, events: BehaviorEvent[]): BehaviorFinding {
  const event_ids = events.map((e) => e.event_id).sort();
  const times = events.map((e) => e.occurred_at).sort();
  const window = { from: times[0] ?? "", to: times.at(-1) ?? "" };
  const evidence_hash = sha256(stableStringify({ detail, event_ids, kind, severity, subjects: [...subjects].sort(), window }));
  return {
    finding_id: `wmb-${evidence_hash.slice(0, 16)}`,
    kind,
    severity,
    subjects: [...subjects].sort(),
    detail,
    event_ids,
    window,
    recommended_disposition: dispositionFor(severity),
    evidence_hash
  };
}

function dispositionFor(severity: BehaviorSeverity): BehaviorDisposition {
  if (severity === "critical") return "terminate_execution";
  if (severity === "high") return "quarantine";
  if (severity === "medium") return "request_authority_review";
  return "shadow_profile";
}

function detectDenialBursts(events: BehaviorEvent[], windowMs: number, threshold: number): BehaviorFinding[] {
  const out: BehaviorFinding[] = [];
  for (const [subject, subjectEvents] of bySubject(events)) {
    const denials = subjectEvents.filter((e) => e.decision === "REFUSE");
    if (denials.length < threshold) continue;
    // sliding window: any `threshold` denials within windowMs
    for (let i = 0; i + threshold - 1 < denials.length; i++) {
      const windowEvents = denials.slice(i, i + threshold);
      if (ms(windowEvents.at(-1)!.occurred_at) - ms(windowEvents[0].occurred_at) <= windowMs) {
        const severity: BehaviorSeverity = denials.length >= threshold * 3 ? "high" : "medium";
        out.push(makeFinding("denial_burst", severity, [subject], `${denials.length} REFUSE decisions for ${subject} (>=${threshold} within ${Math.round(windowMs / 1000)}s) — probing or misconfigured agent`, denials));
        break;
      }
    }
  }
  return out;
}

function detectRateSpikes(events: BehaviorEvent[], factor: number, minEvents: number): BehaviorFinding[] {
  const out: BehaviorFinding[] = [];
  for (const [subject, subjectEvents] of bySubject(events)) {
    if (subjectEvents.length < minEvents * 2) continue;
    const span = ms(subjectEvents.at(-1)!.occurred_at) - ms(subjectEvents[0].occurred_at);
    if (span <= 0) continue;
    const mid = ms(subjectEvents[0].occurred_at) + span / 2;
    const baseline = subjectEvents.filter((e) => ms(e.occurred_at) < mid);
    const recent = subjectEvents.filter((e) => ms(e.occurred_at) >= mid);
    if (recent.length < minEvents || baseline.length === 0) continue;
    if (recent.length >= baseline.length * factor) {
      const severity: BehaviorSeverity = recent.length >= baseline.length * factor * 2 ? "high" : "medium";
      out.push(makeFinding("rate_spike", severity, [subject], `${subject} activity rose ${baseline.length}→${recent.length} (>=${factor}x) across the observed span — volume/cost spike`, recent));
    }
  }
  return out;
}

function detectFirstSeen(events: BehaviorEvent[], knownSubjects?: string[]): BehaviorFinding[] {
  if (!knownSubjects) return [];
  const known = new Set(knownSubjects);
  const out: BehaviorFinding[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    if (known.has(event.subject) || seen.has(event.subject)) continue;
    seen.add(event.subject);
    out.push(makeFinding("first_seen", "medium", [event.subject], `${event.subject} is not in the approved registry and was first observed in this stream`, [event]));
  }
  return out;
}

function detectOffHours(events: BehaviorEvent[], allowed?: { start: number; end: number }): BehaviorFinding[] {
  if (!allowed) return [];
  const inHours = (hour: number) => allowed.start <= allowed.end
    ? hour >= allowed.start && hour < allowed.end
    : hour >= allowed.start || hour < allowed.end; // wrap past midnight
  const offBySubject = new Map<string, BehaviorEvent[]>();
  for (const event of events) {
    const hour = new Date(event.occurred_at).getUTCHours();
    if (!inHours(hour)) offBySubject.set(event.subject, [...(offBySubject.get(event.subject) ?? []), event]);
  }
  return [...offBySubject.entries()].map(([subject, evs]) =>
    makeFinding("off_hours", "low", [subject], `${subject} active outside allowed hours [${allowed.start}:00,${allowed.end}:00) UTC (${evs.length} event(s))`, evs)
  );
}

function detectFanout(events: BehaviorEvent[], windowMs: number, threshold: number): BehaviorFinding[] {
  const out: BehaviorFinding[] = [];
  for (const [subject, subjectEvents] of bySubject(events)) {
    const withTarget = subjectEvents.filter((e) => e.target);
    const targets = new Set(withTarget.map((e) => e.target!));
    if (targets.size < threshold) continue;
    const span = withTarget.length ? ms(withTarget.at(-1)!.occurred_at) - ms(withTarget[0].occurred_at) : 0;
    if (span > windowMs && withTarget.length > 0) {
      // distinct targets but spread beyond the window — still notable but lower
      out.push(makeFinding("target_fanout", "medium", [subject], `${subject} touched ${targets.size} distinct targets (>=${threshold}) — broad lateral surface`, withTarget));
    } else {
      out.push(makeFinding("target_fanout", "high", [subject], `${subject} touched ${targets.size} distinct targets (>=${threshold}) within ${Math.round(windowMs / 1000)}s — rapid lateral fan-out`, withTarget));
    }
  }
  return out;
}

function detectSequences(events: BehaviorEvent[], rules: SequenceRule[]): BehaviorFinding[] {
  const out: BehaviorFinding[] = [];
  const withType = events.filter((e) => typeof e.action_type === "string");
  for (const rule of rules) {
    if (rule.steps.length === 0) continue;
    const matchers = rule.steps.map((step) => ({ re: new RegExp(step.match, "i"), decision: step.decision }));
    for (let start = 0; start < withType.length; start++) {
      const chain = matchChainFrom(withType, start, matchers, rule);
      if (chain) {
        const subjects = [...new Set(chain.map((e) => e.subject))];
        out.push(makeFinding("sequence_chain", rule.severity, subjects, `sequence "${rule.name}" matched across ${subjects.length} subject(s) within ${Math.round(rule.withinMs / 1000)}s`, chain));
        break; // one finding per rule is enough to flag for review
      }
    }
  }
  return out;
}

function matchChainFrom(events: BehaviorEvent[], start: number, matchers: { re: RegExp; decision?: ExecutionControlDecision }[], rule: SequenceRule): BehaviorEvent[] | null {
  const first = events[start];
  if (!stepMatches(first, matchers[0])) return null;
  const deadline = ms(first.occurred_at) + rule.withinMs;
  const chain = [first];
  let step = 1;
  for (let i = start + 1; i < events.length && step < matchers.length; i++) {
    const event = events[i];
    if (ms(event.occurred_at) > deadline) break;
    if (!rule.crossSubject && event.subject !== first.subject) continue;
    if (stepMatches(event, matchers[step])) {
      chain.push(event);
      step += 1;
    }
  }
  return step === matchers.length ? chain : null;
}

function stepMatches(event: BehaviorEvent, matcher: { re: RegExp; decision?: ExecutionControlDecision }): boolean {
  if (matcher.decision && event.decision !== matcher.decision) return false;
  return typeof event.action_type === "string" && matcher.re.test(event.action_type);
}

// --- cross-agent + higher-order detectors -----------------------------------

/**
 * Coordinated campaign: the SAME action_type refused across many distinct subjects
 * within the window — a fleet of agents probing one boundary in concert, which a
 * per-subject denial burst misses. This is the cross-agent analogue of denial_burst.
 */
function detectCoordinatedDenials(events: BehaviorEvent[], windowMs: number, threshold: number): BehaviorFinding[] {
  const out: BehaviorFinding[] = [];
  const byAction = new Map<string, BehaviorEvent[]>();
  for (const e of events) {
    if (e.decision !== "REFUSE" || typeof e.action_type !== "string") continue;
    byAction.set(e.action_type, [...(byAction.get(e.action_type) ?? []), e]);
  }
  for (const [action, denials] of byAction) {
    // Slide a window; flag when >= `threshold` DISTINCT subjects are refused this action within it.
    for (let i = 0; i < denials.length; i++) {
      const windowEnd = ms(denials[i].occurred_at) + windowMs;
      const inWindow = denials.filter((e) => ms(e.occurred_at) >= ms(denials[i].occurred_at) && ms(e.occurred_at) <= windowEnd);
      const subjects = [...new Set(inWindow.map((e) => e.subject))];
      if (subjects.length >= threshold) {
        const severity: BehaviorSeverity = subjects.length >= threshold * 2 ? "high" : "medium";
        out.push(makeFinding("coordinated_denial", severity, subjects, `${subjects.length} agents were each refused "${action}" within ${Math.round(windowMs / 1000)}s — coordinated probe/campaign`, inWindow));
        break;
      }
    }
  }
  return out;
}

/**
 * Peer-group anomaly: a subject whose event volume is a statistical outlier
 * (> mean + factor·σ) versus its cohort — "one agent behaving unlike the rest."
 * Only runs with a meaningful population to avoid small-N noise.
 */
function detectPeerAnomalies(events: BehaviorEvent[], minSubjects: number, factor: number): BehaviorFinding[] {
  const groups = bySubject(events);
  if (groups.size < minSubjects) return [];
  const counts = [...groups.values()].map((e) => e.length);
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  const variance = counts.reduce((a, b) => a + (b - mean) ** 2, 0) / counts.length;
  const stdev = Math.sqrt(variance);
  if (stdev === 0) return [];
  const out: BehaviorFinding[] = [];
  for (const [subject, subjectEvents] of groups) {
    if (subjectEvents.length > mean + factor * stdev) {
      const severity: BehaviorSeverity = subjectEvents.length > mean + factor * 2 * stdev ? "high" : "medium";
      out.push(makeFinding("peer_anomaly", severity, [subject], `${subject} volume ${subjectEvents.length} is a statistical outlier vs peer mean ${mean.toFixed(1)} (>=${factor}σ, σ=${stdev.toFixed(1)}) — diverging from its cohort`, subjectEvents));
    }
  }
  return out;
}

/**
 * Privilege escalation: a subject that pivots from routine activity to a sensitive/
 * privileged action within the window. A blocked attempt (REFUSE) is more alarming
 * than an authorized one. Runs only when `sensitiveActions` patterns are configured.
 */
function detectPrivilegeEscalation(events: BehaviorEvent[], windowMs: number, sensitiveActions?: string[]): BehaviorFinding[] {
  if (!sensitiveActions || sensitiveActions.length === 0) return [];
  const matchers = sensitiveActions.map((p) => new RegExp(p, "i"));
  const isSensitive = (e: BehaviorEvent) => typeof e.action_type === "string" && matchers.some((re) => re.test(e.action_type!));
  const out: BehaviorFinding[] = [];
  for (const [subject, subjectEvents] of bySubject(events)) {
    const firstSensitiveIdx = subjectEvents.findIndex(isSensitive);
    if (firstSensitiveIdx <= 0) continue; // need prior benign activity before the pivot
    const pivot = subjectEvents[firstSensitiveIdx];
    const prior = subjectEvents.slice(0, firstSensitiveIdx).filter((e) => !isSensitive(e) && ms(pivot.occurred_at) - ms(e.occurred_at) <= windowMs);
    if (prior.length === 0) continue;
    const severity: BehaviorSeverity = pivot.decision === "REFUSE" ? "high" : "medium";
    out.push(makeFinding("privilege_escalation", severity, [subject], `${subject} escalated from ${prior.length} routine action(s) to sensitive "${pivot.action_type}" (${pivot.decision ?? "n/a"}) within ${Math.round(windowMs / 1000)}s`, [...prior, pivot]));
  }
  return out;
}

/**
 * New capability / scope creep: a subject that begins using action types absent from
 * its own baseline (first half of its history) in the recent half — an agent quietly
 * expanding what it does. Only for subjects with enough history to have a baseline.
 */
function detectNewCapability(events: BehaviorEvent[], minEvents: number): BehaviorFinding[] {
  const out: BehaviorFinding[] = [];
  for (const [subject, subjectEvents] of bySubject(events)) {
    const typed = subjectEvents.filter((e) => typeof e.action_type === "string");
    if (typed.length < minEvents) continue;
    const mid = Math.floor(typed.length / 2);
    const baseline = new Set(typed.slice(0, mid).map((e) => e.action_type!));
    const recent = typed.slice(mid);
    const newActions = [...new Set(recent.filter((e) => !baseline.has(e.action_type!)).map((e) => e.action_type!))];
    if (newActions.length === 0) continue;
    const newEvents = recent.filter((e) => newActions.includes(e.action_type!));
    const severity: BehaviorSeverity = newEvents.some((e) => e.decision === "REFUSE") ? "medium" : "low";
    out.push(makeFinding("new_capability", severity, [subject], `${subject} began using ${newActions.length} action type(s) absent from its baseline: ${newActions.sort().join(", ")} — capability/scope expansion`, newEvents));
  }
  return out;
}

/**
 * Credential reuse / lateral movement: the same credential reference used by more
 * than one distinct subject — a shared or over-broad credential crossing agent
 * identities, a classic lateral-movement signal. Requires events that carry
 * `credential_refs`.
 */
function detectCredentialReuse(events: BehaviorEvent[]): BehaviorFinding[] {
  const byCredential = new Map<string, { subjects: Set<string>; events: BehaviorEvent[] }>();
  for (const e of events) {
    for (const ref of e.credential_refs ?? []) {
      const entry = byCredential.get(ref) ?? { subjects: new Set<string>(), events: [] };
      entry.subjects.add(e.subject);
      entry.events.push(e);
      byCredential.set(ref, entry);
    }
  }
  const out: BehaviorFinding[] = [];
  for (const [ref, entry] of byCredential) {
    if (entry.subjects.size < 2) continue;
    const subjects = [...entry.subjects];
    const severity: BehaviorSeverity = entry.subjects.size >= 3 ? "critical" : "high";
    out.push(makeFinding("credential_reuse", severity, subjects, `credential "${ref}" used by ${subjects.length} distinct agents (${subjects.sort().join(", ")}) — shared/over-broad credential or lateral movement`, entry.events));
  }
  return out;
}
