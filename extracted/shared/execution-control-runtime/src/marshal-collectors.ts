import { spawnSync } from "node:child_process";
import {
  type AgentObservation,
  type AgentObservationSource,
  type CommandRunner,
  type CommandRunResult,
  type JsonValue
} from "./index.js";

/**
 * Ward Marshal — discovery collectors (ingestion).
 *
 * Census answers "which agents exist"; it can only do so if something feeds it
 * observations. These collectors turn live environment signals into the
 * AgentObservation stream the census consumes. They follow the same injected-client
 * pattern as the interdiction adapters: pure parsers (deterministic, tested without
 * a live cluster) plus a thin collector that runs an injected command and parses
 * the result. AristotleOS imports no cloud/k8s SDK — you inject the runner, and the
 * collector runs inside your environment so no telemetry leaves it.
 *
 * Honest scope: shipping collectors *everywhere* (every cluster, host, SaaS, network
 * tap) is operational work. What's here is the real parsing + the explicit ingestion
 * boundary; wiring each source is a deployment step, not a code gap.
 */

export interface AgentCollector {
  readonly source: AgentObservationSource;
  collect(): Promise<AgentObservation[]>;
}

function defaultRunner(command: string, args: string[]): CommandRunResult {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? result.error?.message ?? "" };
}

// --- Kubernetes -------------------------------------------------------------

export interface KubernetesCollectorOptions {
  /** Injected runner; defaults to spawnSync(kubectl). */
  runner?: CommandRunner;
  kubectlPath?: string;
  kubeContext?: string;
  /** Limit to these namespaces; when omitted, all namespaces (-A). */
  namespaces?: string[];
  /** Stable observation timestamp (for determinism); defaults to now. */
  now?: string;
}

interface K8sPod {
  metadata?: { namespace?: string; name?: string; labels?: Record<string, string>; annotations?: Record<string, string> };
  spec?: { serviceAccountName?: string; containers?: Array<{ name?: string; image?: string }> };
  status?: { phase?: string };
}

/** Parse `kubectl get pods -o json` into AgentObservations. Pure + deterministic. */
export function parseKubernetesPods(doc: { items?: K8sPod[] }, now: string): AgentObservation[] {
  return (doc.items ?? [])
    .map((pod) => {
      const namespace = pod.metadata?.namespace ?? "default";
      const name = pod.metadata?.name ?? "unknown";
      const labels = pod.metadata?.labels ?? {};
      const annotations = pod.metadata?.annotations ?? {};
      const containers = pod.spec?.containers ?? [];
      const csv = (value?: string): string[] | undefined => value ? value.split(",").map((v) => v.trim()).filter(Boolean) : undefined;
      const observation: AgentObservation = {
        observation_id: `k8s:${namespace}/${name}`,
        source: "kubernetes",
        observed_at: now,
        location: `${namespace}/${name}`,
        process_name: containers[0]?.name,
        container_image: containers.map((c) => c.image).filter((image): image is string => Boolean(image)).join(",") || undefined,
        service_account: pod.spec?.serviceAccountName,
        declared_agent_id: labels["aristotle.agent-id"] ?? annotations["aristotle.io/agent-id"],
        owner: labels["owner"] ?? labels["app.kubernetes.io/managed-by"] ?? annotations["aristotle.io/owner"],
        ward_id: labels["aristotle.ward"] ?? annotations["aristotle.io/ward"],
        tool_targets: csv(annotations["aristotle.io/tools"]),
        credential_refs: csv(annotations["aristotle.io/credentials"]),
        llm_endpoints: csv(annotations["aristotle.io/llm-endpoints"]),
        labels: { ...labels, "k8s.phase": pod.status?.phase ?? "Unknown" }
      };
      return observation;
    })
    .sort((a, b) => a.observation_id.localeCompare(b.observation_id));
}

export function kubernetesCollector(options: KubernetesCollectorOptions = {}): AgentCollector {
  const runner: CommandRunner = options.runner ?? (({ command, args }) => defaultRunner(command, args));
  const kubectl = options.kubectlPath ?? "kubectl";
  const contextArgs = options.kubeContext ? ["--context", options.kubeContext] : [];
  return {
    source: "kubernetes",
    async collect() {
      const now = options.now ?? new Date().toISOString();
      const calls = options.namespaces?.length
        ? options.namespaces.map((ns) => [...contextArgs, "get", "pods", "-n", ns, "-o", "json"])
        : [[...contextArgs, "get", "pods", "-A", "-o", "json"]];
      const observations: AgentObservation[] = [];
      for (const args of calls) {
        const result = await runner({ command: kubectl, args });
        if (result.status !== 0 || !result.stdout) continue;
        let doc: { items?: K8sPod[] };
        try { doc = JSON.parse(result.stdout) as { items?: K8sPod[] }; } catch { continue; }
        observations.push(...parseKubernetesPods(doc, now));
      }
      return dedupeObservations(observations);
    }
  };
}

// --- Generic normalizer (CI / SaaS / host / network feeds) ------------------

export interface ObservationFieldMapping {
  observation_id?: string;
  location?: string;
  process_name?: string;
  container_image?: string;
  service_account?: string;
  command_line?: string;
  declared_agent_id?: string;
  owner?: string;
  ward_id?: string;
  outbound_hosts?: string;
  llm_endpoints?: string;
  tool_targets?: string;
  credential_refs?: string;
}

export interface NormalizeOptions {
  source: AgentObservationSource;
  mapping: ObservationFieldMapping;
  now?: string;
  /** Field whose value (when present) seeds labels; otherwise the whole record is captured under labels as strings. */
  captureLabels?: boolean;
}

/** Map arbitrary records from any feed into AgentObservations. Pure + deterministic. */
export function normalizeObservations(records: Array<Record<string, JsonValue>>, options: NormalizeOptions): AgentObservation[] {
  const now = options.now ?? new Date().toISOString();
  const str = (record: Record<string, JsonValue>, key?: string): string | undefined => {
    if (!key) return undefined;
    const value = record[key];
    return typeof value === "string" ? value : undefined;
  };
  const list = (record: Record<string, JsonValue>, key?: string): string[] | undefined => {
    if (!key) return undefined;
    const value = record[key];
    if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
    if (typeof value === "string") return value.split(",").map((v) => v.trim()).filter(Boolean);
    return undefined;
  };
  const m = options.mapping;
  return records
    .map((record, index) => {
      const labels = options.captureLabels
        ? Object.fromEntries(Object.entries(record).filter(([, v]) => typeof v === "string") as [string, string][])
        : undefined;
      const observation: AgentObservation = {
        observation_id: str(record, m.observation_id) ?? `${options.source}:${index}`,
        source: options.source,
        observed_at: now,
        location: str(record, m.location) ?? options.source,
        process_name: str(record, m.process_name),
        container_image: str(record, m.container_image),
        service_account: str(record, m.service_account),
        command_line: str(record, m.command_line),
        declared_agent_id: str(record, m.declared_agent_id),
        owner: str(record, m.owner),
        ward_id: str(record, m.ward_id),
        outbound_hosts: list(record, m.outbound_hosts),
        llm_endpoints: list(record, m.llm_endpoints),
        tool_targets: list(record, m.tool_targets),
        credential_refs: list(record, m.credential_refs),
        labels
      };
      return observation;
    })
    .sort((a, b) => a.observation_id.localeCompare(b.observation_id));
}

// --- Orchestration ----------------------------------------------------------

/** Run every collector and merge into one deduped, deterministically-ordered set. */
export async function collectObservations(collectors: AgentCollector[]): Promise<AgentObservation[]> {
  const all: AgentObservation[] = [];
  for (const collector of collectors) all.push(...await collector.collect());
  return dedupeObservations(all);
}

function dedupeObservations(observations: AgentObservation[]): AgentObservation[] {
  const byId = new Map<string, AgentObservation>();
  for (const observation of observations) byId.set(observation.observation_id, observation);
  return [...byId.values()].sort((a, b) => a.observation_id.localeCompare(b.observation_id));
}
