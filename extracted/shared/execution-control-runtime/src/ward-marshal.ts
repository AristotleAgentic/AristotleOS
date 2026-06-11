import { createHash } from "node:crypto";
import type { CanonicalActionInput, JsonValue } from "./index.js";

export type AgentObservationSource =
  | "kubernetes"
  | "developer-workstation"
  | "ci"
  | "mcp"
  | "saas-automation"
  | "api-gateway"
  | "edge-node"
  | "network";

export type AgentFindingStatus = "governed" | "shadow" | "rogue" | "orphaned" | "contained";
export type AgentRiskBand = "low" | "medium" | "high" | "critical";
export type WardMarshalDisposition =
  | "bind_to_ward"
  | "shadow_profile"
  | "request_authority_review"
  | "quarantine"
  | "revoke_credentials"
  | "terminate_execution";

export type WardMarshalInterdictionKind =
  | "quarantine"
  | "revoke_credentials"
  | "disable_tool_access"
  | "scale_to_zero"
  | "terminate_execution";

export interface AgentObservation {
  observation_id: string;
  source: AgentObservationSource;
  observed_at: string;
  location: string;
  process_name?: string;
  container_image?: string;
  service_account?: string;
  executable_path?: string;
  command_line?: string;
  declared_agent_id?: string;
  owner?: string;
  ward_id?: string;
  outbound_hosts?: string[];
  llm_endpoints?: string[];
  tool_targets?: string[];
  credential_refs?: string[];
  labels?: Record<string, string>;
  telemetry?: Record<string, JsonValue>;
}

export interface RegisteredAgent {
  agent_id: string;
  subject: string;
  ward_id: string;
  owner: string;
  approved_tools: string[];
  credential_refs: string[];
  status: "approved" | "shadow" | "revoked" | "retired";
}

export interface AgentRegistry {
  registry_version: string;
  agents: RegisteredAgent[];
}

export interface AgentRiskSignal {
  code: string;
  weight: number;
  detail: string;
}

export interface WardMarshalFinding {
  finding_id: string;
  agent_id: string;
  subject: string;
  ward_id?: string;
  status: AgentFindingStatus;
  risk_score: number;
  risk_band: AgentRiskBand;
  owner?: string;
  observed_locations: string[];
  observed_tools: string[];
  credential_refs: string[];
  last_seen: string;
  signals: AgentRiskSignal[];
  recommended_disposition: WardMarshalDisposition;
  evidence_hash: string;
  observation_ids: string[];
}

export interface WardMarshalReport {
  report_version: "aristotle.ward-marshal.report.v1";
  generated_at: string;
  registry_version?: string;
  doctrine: "authority-before-consequence";
  summary: {
    observed: number;
    governed: number;
    shadow: number;
    rogue: number;
    orphaned: number;
    contained: number;
    high_or_critical: number;
  };
  findings: WardMarshalFinding[];
  report_hash: string;
}

export interface WardMarshalCensusInput {
  observations: AgentObservation[];
  registry?: AgentRegistry;
  generatedAt?: string;
}

export interface WardMarshalInterdictionInput {
  finding: WardMarshalFinding;
  kind: WardMarshalInterdictionKind;
  requestedBy: string;
  requestedAt: string;
  reason: string;
  target?: string;
  requestId?: string;
}

export function runWardMarshalCensus(input: WardMarshalCensusInput): WardMarshalReport {
  const generated_at = input.generatedAt ?? new Date().toISOString();
  const registry = input.registry ?? { registry_version: "none", agents: [] };
  const registryByAgent = new Map(registry.agents.map((agent) => [agent.agent_id, agent]));
  const registryBySubject = new Map(registry.agents.map((agent) => [agent.subject, agent]));
  const grouped = new Map<string, AgentObservation[]>();

  for (const observation of input.observations) {
    const key = observation.declared_agent_id
      ?? inferSubject(observation)
      ?? `unknown:${observation.location}:${observation.process_name ?? observation.container_image ?? observation.observation_id}`;
    grouped.set(key, [...(grouped.get(key) ?? []), observation]);
  }

  const findings = [...grouped.entries()]
    .map(([key, observations]) => buildFinding(key, observations, registryByAgent, registryBySubject))
    .sort((left, right) => left.finding_id.localeCompare(right.finding_id));

  const summary = {
    observed: findings.length,
    governed: findings.filter((finding) => finding.status === "governed").length,
    shadow: findings.filter((finding) => finding.status === "shadow").length,
    rogue: findings.filter((finding) => finding.status === "rogue").length,
    orphaned: findings.filter((finding) => finding.status === "orphaned").length,
    contained: findings.filter((finding) => finding.status === "contained").length,
    high_or_critical: findings.filter((finding) => finding.risk_band === "high" || finding.risk_band === "critical").length
  };

  const material = stableStringify({
    doctrine: "authority-before-consequence",
    findings,
    generated_at,
    registry_version: input.registry?.registry_version,
    summary
  });

  return {
    report_version: "aristotle.ward-marshal.report.v1",
    generated_at,
    registry_version: input.registry?.registry_version,
    doctrine: "authority-before-consequence",
    summary,
    findings,
    report_hash: sha256(material)
  };
}

export function buildWardMarshalInterdictionAction(input: WardMarshalInterdictionInput): CanonicalActionInput {
  const action_type = `ward_marshal.${input.kind}`;
  return {
    action_id: `wm-${input.kind}-${input.finding.finding_id}`,
    ward_id: input.finding.ward_id ?? "unassigned-ward",
    subject: input.requestedBy,
    action_type,
    target: input.target ?? input.finding.subject,
    params: {
      target_agent_id: input.finding.agent_id,
      target_subject: input.finding.subject,
      containment_kind: input.kind,
      risk_score: input.finding.risk_score,
      risk_band: input.finding.risk_band,
      observed_locations: input.finding.observed_locations,
      observed_tools: input.finding.observed_tools,
      credential_refs: input.finding.credential_refs,
      evidence_hash: input.finding.evidence_hash,
      reason: input.reason
    },
    requested_at: input.requestedAt,
    request_id: input.requestId ?? `req-${input.kind}-${input.finding.finding_id}`,
    telemetry: {
      source: "ward-marshal",
      finding_id: input.finding.finding_id,
      recommended_disposition: input.finding.recommended_disposition
    }
  };
}

export function explainWardMarshalFinding(finding: WardMarshalFinding): string {
  const signalText = finding.signals.length
    ? finding.signals.map((signal) => `${signal.code}(${signal.weight})`).join(", ")
    : "no elevated signals";
  return `${finding.subject} is ${finding.status} in ${finding.ward_id ?? "no assigned Ward"} with ${finding.risk_band} risk (${finding.risk_score}). Recommended disposition: ${finding.recommended_disposition}. Signals: ${signalText}.`;
}

function buildFinding(
  key: string,
  observations: AgentObservation[],
  registryByAgent: Map<string, RegisteredAgent>,
  registryBySubject: Map<string, RegisteredAgent>
): WardMarshalFinding {
  const sorted = [...observations].sort((left, right) => left.observation_id.localeCompare(right.observation_id));
  const first = sorted[0];
  const subject = inferSubject(first) ?? `agent:unclaimed:${sha256(key).slice(0, 10)}`;
  const registered = (first.declared_agent_id ? registryByAgent.get(first.declared_agent_id) : undefined) ?? registryBySubject.get(subject);
  const observedTools = unique(sorted.flatMap((observation) => observation.tool_targets ?? []));
  const credentials = unique(sorted.flatMap((observation) => observation.credential_refs ?? []));
  const locations = unique(sorted.map((observation) => observation.location));
  const last_seen = sorted.map((observation) => observation.observed_at).sort().at(-1) ?? new Date(0).toISOString();
  const signals = riskSignals(sorted, registered);
  const risk_score = Math.min(100, signals.reduce((total, signal) => total + signal.weight, 0));
  const risk_band = riskBand(risk_score);
  const status = findingStatus(registered, sorted, risk_band);
  const recommended_disposition = dispositionFor(status, risk_band, credentials.length);
  const ward_id = registered?.ward_id ?? sorted.find((observation) => observation.ward_id)?.ward_id;
  const agent_id = registered?.agent_id ?? first.declared_agent_id ?? `discovered-${sha256(stableStringify({ subject, locations })).slice(0, 12)}`;
  const owner = registered?.owner ?? sorted.find((observation) => observation.owner)?.owner;
  const observation_ids = sorted.map((observation) => observation.observation_id);
  const evidenceMaterial = {
    agent_id,
    credential_refs: credentials,
    observation_ids,
    observed_tools: observedTools,
    risk_band,
    risk_score,
    status,
    subject,
    ward_id
  };
  const evidence_hash = sha256(stableStringify(evidenceMaterial));
  return {
    finding_id: `wmf-${evidence_hash.slice(0, 16)}`,
    agent_id,
    subject,
    ward_id,
    status,
    risk_score,
    risk_band,
    owner,
    observed_locations: locations,
    observed_tools: observedTools,
    credential_refs: credentials,
    last_seen,
    signals,
    recommended_disposition,
    evidence_hash,
    observation_ids
  };
}

function inferSubject(observation: AgentObservation): string | undefined {
  if (observation.declared_agent_id) return `agent:${observation.declared_agent_id.replace(/^agent:/, "")}`;
  const explicit = observation.labels?.["aristotle.subject"] ?? observation.labels?.subject;
  if (explicit) return explicit;
  if (observation.service_account?.startsWith("agent:")) return observation.service_account;
  return undefined;
}

function findingStatus(registered: RegisteredAgent | undefined, observations: AgentObservation[], risk: AgentRiskBand): AgentFindingStatus {
  if (registered?.status === "revoked" || registered?.status === "retired") return "orphaned";
  if (registered?.status === "shadow") return "shadow";
  if (registered?.status === "approved") return "governed";
  if (observations.some((observation) => observation.labels?.["aristotle.contained"] === "true")) return "contained";
  return risk === "low" ? "shadow" : "rogue";
}

function dispositionFor(status: AgentFindingStatus, risk: AgentRiskBand, credentialCount: number): WardMarshalDisposition {
  if (status === "governed") return "shadow_profile";
  if (status === "contained") return "shadow_profile";
  if (status === "orphaned") return credentialCount > 0 ? "revoke_credentials" : "terminate_execution";
  if (risk === "critical") return "terminate_execution";
  if (risk === "high") return credentialCount > 0 ? "revoke_credentials" : "quarantine";
  if (risk === "medium") return "request_authority_review";
  return "bind_to_ward";
}

function riskBand(score: number): AgentRiskBand {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}

function riskSignals(observations: AgentObservation[], registered?: RegisteredAgent): AgentRiskSignal[] {
  const signals: AgentRiskSignal[] = [];
  const tools = unique(observations.flatMap((observation) => observation.tool_targets ?? []));
  const credentials = unique(observations.flatMap((observation) => observation.credential_refs ?? []));
  const llmEndpoints = unique(observations.flatMap((observation) => observation.llm_endpoints ?? []));
  const serviceAccounts = unique(observations.map((observation) => observation.service_account).filter(Boolean) as string[]);
  const commands = observations.map((observation) => `${observation.process_name ?? ""} ${observation.command_line ?? ""} ${observation.container_image ?? ""}`.toLowerCase());

  if (!registered) signals.push({ code: "UNREGISTERED_AGENT", weight: 30, detail: "no matching approved agent registry entry" });
  if (credentials.length) signals.push({ code: "CREDENTIAL_ACCESS", weight: Math.min(25, 10 + credentials.length * 5), detail: `${credentials.length} credential reference(s) observed` });
  if (llmEndpoints.length) signals.push({ code: "LLM_EGRESS", weight: 10, detail: `${llmEndpoints.length} LLM endpoint(s) observed` });
  if (tools.some((tool) => /(write|delete|deploy|refund|transfer|firewall|scale|terminate|exec|shell|kubectl)/i.test(tool))) {
    signals.push({ code: "CONSEQUENTIAL_TOOL_ACCESS", weight: 20, detail: "tool surface can mutate infrastructure, money, records, or execution state" });
  }
  if (tools.some((tool) => /(prod|production|customer|payment|identity|secrets|cluster-admin)/i.test(tool))) {
    signals.push({ code: "SENSITIVE_TARGET", weight: 15, detail: "tool target touches production or sensitive enterprise surface" });
  }
  if (serviceAccounts.some((account) => /(admin|cluster|root|owner|prod)/i.test(account))) {
    signals.push({ code: "PRIVILEGED_IDENTITY", weight: 20, detail: "privileged service account observed" });
  }
  if (commands.some((command) => /(langgraph|autogen|crewai|openai|anthropic|claude|cursor|mcp|agent)/i.test(command))) {
    signals.push({ code: "AGENT_RUNTIME_SIGNATURE", weight: 10, detail: "process or container resembles an autonomous agent runtime" });
  }
  if (observations.some((observation) => !observation.owner) && !registered?.owner) {
    signals.push({ code: "UNKNOWN_OWNER", weight: 10, detail: "no accountable owner declared" });
  }
  if (registered?.status === "revoked") signals.push({ code: "REVOKED_REGISTRY_ENTRY", weight: 40, detail: "registry entry is revoked" });
  if (registered?.status === "retired") signals.push({ code: "RETIRED_REGISTRY_ENTRY", weight: 25, detail: "registry entry is retired but still observed" });

  return signals.sort((left, right) => left.code.localeCompare(right.code));
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)].sort((left, right) => String(left).localeCompare(String(right)));
}

function stableNormalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => stableNormalize(item));
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Ward Marshal material cannot contain non-finite numbers");
    return Number(value);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableNormalize(entry)])
    );
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableNormalize(value));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
