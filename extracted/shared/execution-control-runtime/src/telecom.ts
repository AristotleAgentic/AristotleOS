import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  type AristotleSigner,
  type AuthorityEnvelope,
  type CanonicalActionInput,
  type EvidenceBundle,
  type ExportEvidenceBundleInput,
  type JsonValue,
  type RuntimeRegister,
  type WardManifest,
  evaluateExecutionControl,
  exportEvidenceBundle,
  reconcileEdgeRecords,
  sha256,
  stableStringify,
  verifyEvidenceBundle,
  verifyGelChain
} from "./index.js";

/**
 * Telecom readiness primitives.
 *
 * These are intentionally AristotleOS-native: telecom systems become sources of
 * Canonical Governed Actions, runtime registers, and evidence context. They do
 * not execute vendor APIs directly. Execution still requires Commit Gate ALLOW,
 * a single-use Warrant, and GEL evidence.
 */

export type TelecomDomain = "ran" | "5gc" | "transport" | "oss-bss" | "telco-cloud" | "edge";

export type TelecomAdapterKind = "tmf-open-api" | "netconf-yang" | "gnmi-gnoi" | "oran-a1-r1";

export interface TelecomAdapterDescriptor {
  kind: TelecomAdapterKind;
  label: string;
  consequenceBoundary: string;
  actionExamples: string[];
  requiredRuntimeRegisters: string[];
}

export const TELECOM_ADAPTER_CATALOG: TelecomAdapterDescriptor[] = [
  {
    kind: "tmf-open-api",
    label: "TM Forum Open API",
    consequenceBoundary: "OSS/BSS service, resource, product, trouble-ticket, and customer-impacting mutations",
    actionExamples: ["tmf.service-order.patch", "tmf.trouble-ticket.update", "tmf.resource-inventory.patch"],
    requiredRuntimeRegisters: ["change_ticket", "noc_operator", "maintenance_window"]
  },
  {
    kind: "netconf-yang",
    label: "NETCONF/YANG",
    consequenceBoundary: "Network-element configuration edits, candidate commits, confirmed commits, and rollback markers",
    actionExamples: ["netconf.edit-config", "netconf.commit-confirmed"],
    requiredRuntimeRegisters: ["change_ticket", "device_lock", "rollback_plan"]
  },
  {
    kind: "gnmi-gnoi",
    label: "gNMI/gNOI",
    consequenceBoundary: "Telemetry-bound set operations, diagnostics, certificate rotation, and controlled device operations",
    actionExamples: ["gnmi.set", "gnoi.certificate.rotate"],
    requiredRuntimeRegisters: ["change_ticket", "telemetry_fresh", "device_identity"]
  },
  {
    kind: "oran-a1-r1",
    label: "O-RAN A1/R1",
    consequenceBoundary: "Non-RT RIC policy, rApp service exposure, AI/ML model deployment, and RAN optimization intent",
    actionExamples: ["oran.a1.policy.put", "oran.r1.model.deploy"],
    requiredRuntimeRegisters: ["change_ticket", "ric_policy_type", "impact_assessment"]
  }
];

export interface TmfOpenApiRequest {
  api: "TMF620" | "TMF622" | "TMF632" | "TMF638" | "TMF639" | "TMF641" | "TMF642" | string;
  operation: string;
  method: "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  body?: Record<string, JsonValue>;
  query?: Record<string, JsonValue>;
  action_type?: string;
}

export interface NetconfEditConfigRequest {
  datastore: "candidate" | "running" | "startup";
  device_id: string;
  yang_module: string;
  operation: "merge" | "replace" | "create" | "delete" | "remove";
  patch: Record<string, JsonValue>;
  confirmed_commit?: boolean;
  action_type?: string;
}

export interface GnmiSetRequest {
  device_id: string;
  path: string;
  operation: "update" | "replace" | "delete";
  value?: JsonValue;
  encoding?: "json" | "json_ietf" | "proto" | "bytes";
  action_type?: string;
}

export interface OranPolicyRequest {
  ric_id: string;
  interface: "A1" | "R1";
  policy_type_id: string;
  policy_instance_id: string;
  operation: "create" | "replace" | "delete" | "deploy-model";
  payload?: Record<string, JsonValue>;
  target_cells?: string[];
  action_type?: string;
}

export type TelecomAdapterRequest =
  | { kind: "tmf-open-api"; request: TmfOpenApiRequest }
  | { kind: "netconf-yang"; request: NetconfEditConfigRequest }
  | { kind: "gnmi-gnoi"; request: GnmiSetRequest }
  | { kind: "oran-a1-r1"; request: OranPolicyRequest };

export interface TelecomActionContext {
  action_id: string;
  ward_id: string;
  subject: string;
  requested_at: string;
  request_id?: string;
  telemetry?: Record<string, JsonValue>;
  classification?: CanonicalActionInput["classification"];
}

function slug(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function telecomAction(
  ctx: TelecomActionContext,
  action_type: string,
  target: string,
  params: Record<string, JsonValue>
): CanonicalActionInput {
  return {
    action_id: ctx.action_id,
    ward_id: ctx.ward_id,
    subject: ctx.subject,
    action_type,
    target,
    params,
    requested_at: ctx.requested_at,
    ...(ctx.request_id ? { request_id: ctx.request_id } : {}),
    ...(ctx.telemetry ? { telemetry: ctx.telemetry } : {}),
    ...(ctx.classification ? { classification: ctx.classification } : {})
  };
}

export function tmfOpenApiToAction(input: TmfOpenApiRequest, ctx: TelecomActionContext): CanonicalActionInput {
  const op = slug(input.operation || input.path);
  const actionType = input.action_type ?? `tmf.${op}.${input.method.toLowerCase()}`;
  return telecomAction(ctx, actionType, `${input.method} ${input.path}`, {
    adapter: "tmf-open-api",
    api: input.api,
    operation: input.operation,
    method: input.method,
    path: input.path,
    ...(input.body ? { body: input.body } : {}),
    ...(input.query ? { query: input.query } : {})
  });
}

export function netconfEditConfigToAction(input: NetconfEditConfigRequest, ctx: TelecomActionContext): CanonicalActionInput {
  return telecomAction(ctx, input.action_type ?? "netconf.edit-config", `${input.device_id}:${input.datastore}:${input.yang_module}`, {
    adapter: "netconf-yang",
    datastore: input.datastore,
    device_id: input.device_id,
    yang_module: input.yang_module,
    operation: input.operation,
    patch: input.patch,
    confirmed_commit: input.confirmed_commit ?? false
  });
}

export function gnmiSetToAction(input: GnmiSetRequest, ctx: TelecomActionContext): CanonicalActionInput {
  return telecomAction(ctx, input.action_type ?? "gnmi.set", `${input.device_id}:${input.path}`, {
    adapter: "gnmi-gnoi",
    device_id: input.device_id,
    path: input.path,
    operation: input.operation,
    ...(input.value !== undefined ? { value: input.value } : {}),
    encoding: input.encoding ?? "json_ietf"
  });
}

export function oranPolicyToAction(input: OranPolicyRequest, ctx: TelecomActionContext): CanonicalActionInput {
  const base = input.interface === "A1" ? "oran.a1.policy" : "oran.r1.service";
  const actionType = input.action_type ?? `${base}.${input.operation === "delete" ? "delete" : input.operation === "deploy-model" ? "deploy-model" : "put"}`;
  return telecomAction(ctx, actionType, `${input.ric_id}:${input.interface}:${input.policy_type_id}:${input.policy_instance_id}`, {
    adapter: "oran-a1-r1",
    ric_id: input.ric_id,
    interface: input.interface,
    policy_type_id: input.policy_type_id,
    policy_instance_id: input.policy_instance_id,
    operation: input.operation,
    ...(input.payload ? { payload: input.payload } : {}),
    ...(input.target_cells ? { target_cells: input.target_cells } : {})
  });
}

export function telecomAdapterToAction(input: TelecomAdapterRequest, ctx: TelecomActionContext): CanonicalActionInput {
  if (input.kind === "tmf-open-api") return tmfOpenApiToAction(input.request, ctx);
  if (input.kind === "netconf-yang") return netconfEditConfigToAction(input.request, ctx);
  if (input.kind === "gnmi-gnoi") return gnmiSetToAction(input.request, ctx);
  return oranPolicyToAction(input.request, ctx);
}

export interface TelecomEvidenceContext {
  change_ticket: string;
  noc_operator: string;
  network_domain: TelecomDomain;
  network_scope: string;
  maintenance_window?: { starts_at: string; ends_at: string };
  impacted_services: string[];
  impacted_regions?: string[];
  customer_impact: "none" | "low" | "moderate" | "high" | "emergency";
  rollback_plan: string;
  pre_checks: Array<{ name: string; ok: boolean; detail?: string }>;
  post_checks?: Array<{ name: string; ok: boolean; detail?: string }>;
  standards_profile: Array<"TMF_OPEN_API" | "ETSI_NFV" | "3GPP_NWDAF" | "ORAN_A1_R1" | "ORAN_O1" | "NETCONF_YANG" | "GNMI_GNOI">;
  retained_fields?: string[];
  redacted_fields?: string[];
}

export interface TelecomEvidenceBundle {
  bundle_version: "aristotle.telecom-evidence.v1";
  exported_at: string;
  telecom: TelecomEvidenceContext;
  execution_bundle: EvidenceBundle;
  hashes: {
    telecom_context_hash: string;
    execution_bundle_hash: string;
    telecom_bundle_hash: string;
  };
  verification: { ok: boolean; failures: string[]; execution_bundle_ok: boolean };
}

function evidenceBundleMaterialHash(bundle: EvidenceBundle): string {
  return sha256(stableStringify({
    bundle_version: bundle.bundle_version,
    exported_at: bundle.exported_at,
    hashes: bundle.hashes,
    selected_record: bundle.selected_record
  }));
}

function telecomBundleHash(input: Omit<TelecomEvidenceBundle, "hashes" | "verification"> & { hashes: Omit<TelecomEvidenceBundle["hashes"], "telecom_bundle_hash"> }): string {
  return sha256(stableStringify(input));
}

export function exportTelecomEvidenceBundle(input: ExportEvidenceBundleInput & { telecom: TelecomEvidenceContext }): TelecomEvidenceBundle {
  const execution_bundle = exportEvidenceBundle(input);
  const partial = {
    bundle_version: "aristotle.telecom-evidence.v1" as const,
    exported_at: input.exportedAt ?? execution_bundle.exported_at,
    telecom: JSON.parse(stableStringify(input.telecom)) as TelecomEvidenceContext,
    execution_bundle
  };
  const hashes = {
    telecom_context_hash: sha256(stableStringify(partial.telecom)),
    execution_bundle_hash: evidenceBundleMaterialHash(execution_bundle),
    telecom_bundle_hash: ""
  };
  hashes.telecom_bundle_hash = telecomBundleHash({
    ...partial,
    hashes: {
      telecom_context_hash: hashes.telecom_context_hash,
      execution_bundle_hash: hashes.execution_bundle_hash
    }
  });
  const draft: TelecomEvidenceBundle = { ...partial, hashes, verification: { ok: false, failures: [], execution_bundle_ok: false } };
  return { ...draft, verification: verifyTelecomEvidenceBundle(draft) };
}

export function verifyTelecomEvidenceBundle(bundle: TelecomEvidenceBundle): TelecomEvidenceBundle["verification"] {
  const failures: string[] = [];
  if (bundle.bundle_version !== "aristotle.telecom-evidence.v1") failures.push("unsupported telecom evidence bundle version");
  const contextHash = sha256(stableStringify(bundle.telecom));
  if (contextHash !== bundle.hashes.telecom_context_hash) failures.push("telecom context hash mismatch");
  const executionHash = evidenceBundleMaterialHash(bundle.execution_bundle);
  if (executionHash !== bundle.hashes.execution_bundle_hash) failures.push("execution bundle hash mismatch");
  const executionVerification = verifyEvidenceBundle(bundle.execution_bundle);
  if (!executionVerification.ok) failures.push(`execution evidence failed: ${executionVerification.failures.join(";")}`);
  const expected = telecomBundleHash({
    bundle_version: bundle.bundle_version,
    exported_at: bundle.exported_at,
    telecom: bundle.telecom,
    execution_bundle: bundle.execution_bundle,
    hashes: {
      telecom_context_hash: bundle.hashes.telecom_context_hash,
      execution_bundle_hash: bundle.hashes.execution_bundle_hash
    }
  });
  if (expected !== bundle.hashes.telecom_bundle_hash) failures.push("telecom bundle hash mismatch");
  return { ok: failures.length === 0, failures, execution_bundle_ok: executionVerification.ok };
}

export interface CarrierScaleBenchmarkInput {
  ward: WardManifest;
  authorityEnvelope: AuthorityEnvelope;
  actionCount?: number;
  ledgerPath?: string;
  now?: string;
  signer?: AristotleSigner;
}

export interface LatencySummary {
  min_ms: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  max_ms: number;
}

export interface CarrierScaleBenchmarkReport {
  benchmark: "aristotle.telecom.carrier-scale.v1";
  generated_at: string;
  action_count: number;
  allowed: number;
  refused: number;
  escalated: number;
  total_ms: number;
  decisions_per_second: number;
  latency: LatencySummary;
  ledger_verification: { ok: boolean; count: number; failure?: string };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))];
}

function latencySummary(values: number[]): LatencySummary {
  const sorted = [...values].sort((a, b) => a - b);
  const round = (n: number) => Number(n.toFixed(3));
  return {
    min_ms: round(sorted[0] ?? 0),
    p50_ms: round(percentile(sorted, 0.5)),
    p95_ms: round(percentile(sorted, 0.95)),
    p99_ms: round(percentile(sorted, 0.99)),
    max_ms: round(sorted.at(-1) ?? 0)
  };
}

function benchmarkAction(input: CarrierScaleBenchmarkInput, i: number, now: string): CanonicalActionInput {
  const allowed = input.authorityEnvelope.allowed_actions[0] ?? "tmf.service-order.patch";
  return {
    action_id: `telco-bench-${i.toString().padStart(8, "0")}`,
    ward_id: input.ward.ward_id,
    subject: input.authorityEnvelope.subject,
    action_type: allowed,
    target: `network-scope/${input.ward.ward_id}/change-${i}`,
    params: {
      adapter: allowed.startsWith("oran.") ? "oran-a1-r1" : allowed.startsWith("netconf.") ? "netconf-yang" : allowed.startsWith("gnmi.") ? "gnmi-gnoi" : "tmf-open-api",
      change_ticket: `CHG-${100000 + i}`,
      maintenance_window: "approved",
      noc_operator: "benchmark-operator",
      cost: 1
    },
    telemetry: {
      change_ticket: `CHG-${100000 + i}`,
      maintenance_window: "approved",
      noc_operator: "benchmark-operator",
      precheck_passed: true,
      telemetry_fresh: true,
      device_identity: "attested"
    },
    requested_at: now,
    request_id: `req-telco-bench-${i}`
  };
}

export function runCarrierScaleBenchmark(input: CarrierScaleBenchmarkInput): CarrierScaleBenchmarkReport {
  const actionCount = input.actionCount ?? 1000;
  const now = input.now ?? new Date().toISOString();
  const ledgerPath = input.ledgerPath ?? path.join(mkdtempSync(path.join(tmpdir(), "aos-telecom-bench-")), "gel.jsonl");
  const latencies: number[] = [];
  let allowed = 0;
  let refused = 0;
  let escalated = 0;
  const started = performance.now();
  for (let i = 0; i < actionCount; i++) {
    const t0 = performance.now();
    const result = evaluateExecutionControl({
      ward: input.ward,
      authorityEnvelope: input.authorityEnvelope,
      action: benchmarkAction(input, i, now),
      ledgerPath,
      now,
      signer: input.signer,
      replayProtection: false,
      runtimeRegister: {
        policy_version: input.ward.policy_version,
        registers: {
          change_ticket: `CHG-${100000 + i}`,
          maintenance_window: "approved",
          noc_operator: "benchmark-operator",
          precheck_passed: true,
          telemetry_fresh: true,
          device_identity: "attested"
        }
      }
    });
    latencies.push(performance.now() - t0);
    if (result.decision === "ALLOW") allowed += 1;
    else if (result.decision === "REFUSE") refused += 1;
    else escalated += 1;
  }
  const total = performance.now() - started;
  return {
    benchmark: "aristotle.telecom.carrier-scale.v1",
    generated_at: now,
    action_count: actionCount,
    allowed,
    refused,
    escalated,
    total_ms: Number(total.toFixed(3)),
    decisions_per_second: Number((actionCount / Math.max(0.001, total / 1000)).toFixed(2)),
    latency: latencySummary(latencies),
    ledger_verification: verifyGelChain(ledgerPath)
  };
}

export interface ReconnectStormInput {
  ward: WardManifest;
  authorityEnvelope: AuthorityEnvelope;
  edgeNodes?: number;
  recordsPerNode?: number;
  now?: string;
}

export interface ReconnectStormReport {
  simulation: "aristotle.telecom.reconnect-storm.v1";
  generated_at: string;
  edge_nodes: number;
  records_per_node: number;
  total_records: number;
  total_ms: number;
  records_per_second: number;
  agreements: number;
  conflicts: number;
  by_kind: Record<string, number>;
}

function stormAction(input: ReconnectStormInput, edge: number, index: number, now: string): CanonicalActionInput {
  const cycle = index % 5;
  const action_type = cycle === 0
    ? "tmf.service-order.patch"
    : cycle === 1
      ? "netconf.edit-config"
      : cycle === 2
        ? "gnmi.set"
        : cycle === 3
          ? "oran.a1.policy.put"
          : "ran.cell.shutdown";
  return {
    action_id: `edge-${edge}-reconnect-${index}`,
    ward_id: input.ward.ward_id,
    subject: input.authorityEnvelope.subject,
    action_type,
    target: `edge-node-${edge}/record-${index}`,
    params: {
      change_ticket: `EDGE-${edge}-${index}`,
      maintenance_window: cycle === 4 ? "missing" : "approved",
      noc_operator: `edge-${edge}`,
      adapter: action_type.startsWith("oran.") ? "oran-a1-r1" : action_type.startsWith("netconf.") ? "netconf-yang" : action_type.startsWith("gnmi.") ? "gnmi-gnoi" : "tmf-open-api"
    },
    telemetry: {
      change_ticket: `EDGE-${edge}-${index}`,
      maintenance_window: cycle === 4 ? "" : "approved",
      noc_operator: `edge-${edge}`,
      precheck_passed: cycle !== 4,
      telemetry_fresh: true,
      device_identity: "attested"
    },
    requested_at: now,
    request_id: `req-edge-${edge}-${index}`
  };
}

export function runReconnectStormSimulation(input: ReconnectStormInput): ReconnectStormReport {
  const edgeNodes = input.edgeNodes ?? 50;
  const recordsPerNode = input.recordsPerNode ?? 100;
  const now = input.now ?? new Date().toISOString();
  const records = [];
  for (let edge = 0; edge < edgeNodes; edge++) {
    for (let i = 0; i < recordsPerNode; i++) {
      records.push({
        action: stormAction(input, edge, i, now),
        edge_decision: "ALLOW" as const,
        edge_policy_version: input.ward.policy_version,
        occurred_at: now,
        runtimeRegister: {
          policy_version: input.ward.policy_version,
          registers: {
            change_ticket: `EDGE-${edge}-${i}`,
            maintenance_window: i % 5 === 4 ? "" : "approved",
            noc_operator: `edge-${edge}`,
            precheck_passed: i % 5 !== 4,
            telemetry_fresh: true,
            device_identity: "attested"
          }
        }
      });
    }
  }
  const started = performance.now();
  const report = reconcileEdgeRecords({ records, ward: input.ward, authorityEnvelope: input.authorityEnvelope, now });
  const total = performance.now() - started;
  return {
    simulation: "aristotle.telecom.reconnect-storm.v1",
    generated_at: now,
    edge_nodes: edgeNodes,
    records_per_node: recordsPerNode,
    total_records: records.length,
    total_ms: Number(total.toFixed(3)),
    records_per_second: Number((records.length / Math.max(0.001, total / 1000)).toFixed(2)),
    agreements: report.agreements,
    conflicts: report.conflicts,
    by_kind: report.by_kind
  };
}

export interface MultiRegionLedgerSoakInput {
  ward: WardManifest;
  authorityEnvelope: AuthorityEnvelope;
  regions?: string[];
  decisionsPerRegion?: number;
  ledgerPath?: string;
  now?: string;
  signer?: AristotleSigner;
}

export interface MultiRegionLedgerSoakReport {
  soak: "aristotle.telecom.multi-region-ledger.v1";
  generated_at: string;
  regions: string[];
  decisions_per_region: number;
  total_decisions: number;
  total_ms: number;
  decisions_per_second: number;
  ledger_verification: { ok: boolean; count: number; failure?: string };
  region_counts: Record<string, number>;
}

export function simulateMultiRegionLedgerSoak(input: MultiRegionLedgerSoakInput): MultiRegionLedgerSoakReport {
  const regions = input.regions ?? ["east", "central", "west"];
  const decisionsPerRegion = input.decisionsPerRegion ?? 200;
  const now = input.now ?? new Date().toISOString();
  const ledgerPath = input.ledgerPath ?? path.join(mkdtempSync(path.join(tmpdir(), "aos-telecom-ha-")), "gel.jsonl");
  const region_counts: Record<string, number> = {};
  const started = performance.now();
  for (const region of regions) {
    region_counts[region] = 0;
    for (let i = 0; i < decisionsPerRegion; i++) {
      evaluateExecutionControl({
        ward: input.ward,
        authorityEnvelope: input.authorityEnvelope,
        action: {
          ...benchmarkAction(input, i + region_counts[region], now),
          action_id: `ha-${region}-${i}`,
          request_id: `req-ha-${region}-${i}`,
          target: `${region}/network-change/${i}`,
          params: { region, change_ticket: `HA-${region}-${i}`, maintenance_window: "approved", noc_operator: `noc-${region}`, precheck_passed: true },
          telemetry: {
            change_ticket: `HA-${region}-${i}`,
            maintenance_window: "approved",
            noc_operator: `noc-${region}`,
            precheck_passed: true,
            telemetry_fresh: true,
            device_identity: "attested"
          }
        },
        ledgerPath,
        now,
        signer: input.signer,
        replayProtection: false,
        runtimeRegister: {
          policy_version: input.ward.policy_version,
          registers: {
            change_ticket: `HA-${region}-${i}`,
            maintenance_window: "approved",
            noc_operator: `noc-${region}`,
            precheck_passed: true,
            telemetry_fresh: true,
            device_identity: "attested"
          }
        }
      });
      region_counts[region] += 1;
    }
  }
  const total = performance.now() - started;
  const totalDecisions = regions.length * decisionsPerRegion;
  return {
    soak: "aristotle.telecom.multi-region-ledger.v1",
    generated_at: now,
    regions,
    decisions_per_region: decisionsPerRegion,
    total_decisions: totalDecisions,
    total_ms: Number(total.toFixed(3)),
    decisions_per_second: Number((totalDecisions / Math.max(0.001, total / 1000)).toFixed(2)),
    ledger_verification: verifyGelChain(ledgerPath),
    region_counts
  };
}
