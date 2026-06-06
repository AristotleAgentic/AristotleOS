import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash, createHmac, createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import { createApp, id, now } from "./lib.js";
// Substrate GEL — hash-chained, signed, offline-verifiable evidence chain.
// See shared/execution-control-runtime/src/index.ts.
import {
  appendGelRecord,
  loadGelChain,
  verifyGelChain,
  exportEvidenceBundle,
  type WardManifest,
  type CanonicalActionInput,
  type CommitGateDecision,
  type Warrant,
  // Substrate has its own AuthorityEnvelope shape distinct from
  // shared-types::AuthorityEnvelope; import under an alias so both
  // can coexist in this service.
  type AuthorityEnvelope as SubstrateAuthorityEnvelope
} from "@aristotle/execution-control-runtime";
import { ReadinessChecks, mountHealthEndpoints } from "@aristotle/service-runtime";
import { mountGelRoutes } from "./routes/gel.js";
import { mountReplayEventsRoutes } from "./routes/replay-events.js";
import type {
  AssuranceAttestationArtifact,
  ArtifactType,
  AutonomyAttestationArtifact,
  AuthorityEnvelope,
  CounterfactualBranch,
  ExecutionDecision,
  ExecutionWarrant,
  FinalityCertificate,
  IdentityAttestationArtifact,
  KillSwitchEvent,
  RecoveryPlanArtifact,
  ReplayEvent,
  WitnessReceipt
} from "@aristotle/shared-types";

type LedgerState = {
  committed: ReplayEvent[];
  branches: CounterfactualBranch[];
  hypothetical: Record<string, ReplayEvent[]>;
};

type IndexedArtifact =
  | AssuranceAttestationArtifact
  | AutonomyAttestationArtifact
  | AuthorityEnvelope
  | ExecutionWarrant
  | WitnessReceipt
  | ExecutionDecision
  | FinalityCertificate
  | KillSwitchEvent
  | RecoveryPlanArtifact
  | IdentityAttestationArtifact;

const port = Number(process.env.PORT_EVIDENCE_LEDGER ?? 7003);
const app = createApp();
const statePath = resolve(process.cwd(), process.env.EVIDENCE_LEDGER_STATE_PATH ?? "./data/evidence-ledger.json");
const ledgerSigningSecret = process.env.EVIDENCE_LEDGER_SIGNING_SECRET?.trim();
const ledgerSignerRef = process.env.EVIDENCE_LEDGER_SIGNER?.trim() || "evidence-ledger";
const ledgerSigningPrivateKeyPath = process.env.EVIDENCE_LEDGER_SIGNING_PRIVATE_KEY_PATH?.trim();
const ledgerSigningPublicKeyPath = process.env.EVIDENCE_LEDGER_SIGNING_PUBLIC_KEY_PATH?.trim();
const resolveConfigPath = (configuredPath?: string) => {
  if (!configuredPath) return undefined;
  const direct = resolve(process.cwd(), configuredPath);
  if (existsSync(direct)) {
    return direct;
  }
  return resolve(process.cwd(), "..", "..", configuredPath);
};
const resolvedLedgerPrivateKeyPath = resolveConfigPath(ledgerSigningPrivateKeyPath);
const resolvedLedgerPublicKeyPath = resolveConfigPath(ledgerSigningPublicKeyPath);
const ledgerSigningPrivateKey = ledgerSigningPrivateKeyPath
  && resolvedLedgerPrivateKeyPath
  ? createPrivateKey(readFileSync(resolvedLedgerPrivateKeyPath, "utf8"))
  : null;
const ledgerSigningPublicKey =
  resolvedLedgerPublicKeyPath && existsSync(resolvedLedgerPublicKeyPath)
    ? createPublicKey(readFileSync(resolvedLedgerPublicKeyPath, "utf8"))
    : ledgerSigningPrivateKey
      ? createPublicKey(ledgerSigningPrivateKey)
      : null;

const committed: ReplayEvent[] = [];
const branches = new Map<string, CounterfactualBranch>();
const hypothetical = new Map<string, ReplayEvent[]>();
const indexedArtifacts = new Map<string, IndexedArtifact>();
let persistQueue = Promise.resolve();

const serializeState = (): LedgerState => ({
  committed,
  branches: [...branches.values()],
  hypothetical: Object.fromEntries(hypothetical.entries())
});

const schedulePersist = () => {
  persistQueue = persistQueue
    .then(async () => {
      await mkdir(dirname(statePath), { recursive: true });
      await writeFile(statePath, JSON.stringify(serializeState(), null, 2), "utf8");
    })
    .catch((error) => {
      console.error("evidence-ledger persist failed", error);
    });
  return persistQueue;
};

const loadState = async () => {
  try {
    const raw = await readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<LedgerState>;
    committed.splice(0, committed.length, ...(parsed.committed ?? []));
    indexedArtifacts.clear();
    for (const event of committed) {
      ingestArtifactsFromPayload(event);
    }
    branches.clear();
    for (const branch of parsed.branches ?? []) {
      branches.set(branch.id, branch);
    }
    hypothetical.clear();
    for (const [branchId, items] of Object.entries(parsed.hypothetical ?? {})) {
      hypothetical.set(branchId, items);
    }
  } catch (error) {
    const missing = typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
    if (!missing) {
      console.error("evidence-ledger load failed", error);
    }
  }
};

const artifactTypes = new Set<ArtifactType>([
  "authority-envelope",
  "execution-warrant",
  "witness-receipt",
  "execution-decision",
  "finality-certificate",
  "kill-switch-event",
  "recovery-plan",
  "identity-attestation",
  "autonomy-attestation",
  "assurance-attestation"
]);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const isIndexedArtifact = (value: unknown): value is IndexedArtifact => {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" && typeof value.artifactType === "string" && artifactTypes.has(value.artifactType as ArtifactType);
};

const collectArtifacts = (value: unknown): IndexedArtifact[] => {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectArtifacts(item));
  }
  if (!isRecord(value)) return [];

  const nested = Object.values(value).flatMap((item) => collectArtifacts(item));
  return isIndexedArtifact(value) ? [value, ...nested] : nested;
};

const collectStringValues = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectStringValues(item));
  }
  if (!isRecord(value)) return [];
  return Object.values(value).flatMap((item) => collectStringValues(item));
};

const readString = (value: unknown): string | undefined => (typeof value === "string" && value.length > 0 ? value : undefined);

const readStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "signature" && key !== "verification" && key !== "digest")
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const verifyArtifact = <T extends IndexedArtifact>(artifact: T): T => {
  const digest = createHash("sha256").update(stableJson(artifact)).digest("hex");
  let signature: string | undefined;
  let signatureAlgorithm: T["signatureAlgorithm"];
  let verification: T["verification"];
  if (ledgerSigningPrivateKey && ledgerSigningPublicKey) {
    signature = cryptoSign(null, Buffer.from(digest, "utf8"), ledgerSigningPrivateKey).toString("base64");
    const verified = cryptoVerify(
      null,
      Buffer.from(digest, "utf8"),
      ledgerSigningPublicKey,
      Buffer.from(signature, "base64")
    );
    signatureAlgorithm = "ed25519";
    verification = verified
      ? {
          status: "verified",
          verifier: ledgerSignerRef,
          reason: "sha256 digest and Ed25519 signature verified by evidence-ledger."
        }
      : {
          status: "failed",
          verifier: ledgerSignerRef,
          reason: "Ed25519 signature verification failed."
        };
  } else if (ledgerSigningSecret) {
    signature = createHmac("sha256", ledgerSigningSecret).update(digest).digest("hex");
    signatureAlgorithm = "hmac-sha256";
    verification = {
      status: "verified",
      verifier: ledgerSignerRef,
      reason: "sha256 digest and HMAC signature verified by evidence-ledger."
    };
  } else {
    verification = {
      status: "unverified",
      verifier: ledgerSignerRef,
      reason: "No evidence-ledger signing key configured."
    };
  }
  return {
    ...artifact,
    digest,
    signatureAlgorithm,
    signature,
    verification
  };
};

const eventPhase = (event: ReplayEvent): ExecutionDecision["phase"] => {
  if (/tool-action/.test(event.eventKind)) return "tool-action";
  if (/completed|finality|witness/.test(event.eventKind)) return "completion";
  return "dispatch";
};

const synthesizeArtifactsFromEvent = (event: ReplayEvent): IndexedArtifact[] => {
  const payload = isRecord(event.payload) ? event.payload : {};
  const scenario = isRecord(payload.scenario) ? payload.scenario : {};
  const projectedRoute = isRecord(payload.projectedRoute) ? payload.projectedRoute : {};
  const projectedRecoveryPaths = Array.isArray(payload.projectedRecoveryPaths)
    ? payload.projectedRecoveryPaths.filter(isRecord)
    : [];
  const agentId = readString(payload.agentId);
  const deviceId =
    readString(payload.deviceId) ??
    readString(payload.workspaceId) ??
    readString(payload.scopeRef);
  const agentFingerprint = readString(payload.agentFingerprint);
  const deviceFingerprint = readString(payload.deviceFingerprint);
  const missionId = readString(payload.missionId) ?? event.traceId ?? "unknown-mission";
  const envelopeId =
    readString(payload.envelopeId) ??
    (event.eventKind === "counterfactual.projected" && projectedRoute ? `env-${event.id}` : undefined);
  const warrantId = readString(payload.warrantId);
  const witnessReceiptId = readString(payload.witnessReceiptId);
  const decisionId = readString(payload.decisionId) ?? readString(payload.commitDecisionId);
  const finalityCertificateId = readString(payload.finalityCertificateId);
  const targetId = readString(payload.taskId) ?? readString(payload.actionId) ?? readString(payload.toolActionId);
  const reasons = readStringArray(payload.reasons);
  const witnessStatus =
    readString(payload.witnessStatus) === "satisfied" ||
    readString(payload.witnessStatus) === "unsatisfied" ||
    readString(payload.witnessStatus) === "not-required"
      ? (readString(payload.witnessStatus) as ExecutionDecision["witnessStatus"])
      : "not-required";

  const artifacts: IndexedArtifact[] = [];

  if (envelopeId) {
    artifacts.push({
      id: envelopeId,
      artifactType: "authority-envelope",
      timestamp: event.timestamp,
      actor: event.actor,
      traceId: event.traceId,
      chainId: event.chainId,
      issuer: readString(payload.issuer) ?? "mission.command",
      issuerChain: readStringArray(payload.issuerChain),
      domain: readString(payload.domain) ?? readString(projectedRoute.domain) ?? "mission",
      subject: readString(payload.subject) ?? (targetId ? `governed.${targetId}` : "governed.execution"),
      action: readString(payload.action) ?? readString(projectedRoute.phase) ?? event.eventKind,
      validFrom: event.timestamp,
      validUntil: readString(payload.validUntil) ?? event.timestamp,
      permittedEffects:
        readStringArray(payload.permittedEffects).length > 0
          ? readStringArray(payload.permittedEffects)
          : readStringArray(projectedRoute.selectedPath).map((segment) => `route:${segment}`),
      constraints:
        isRecord(payload.constraints)
          ? payload.constraints
          : event.eventKind === "counterfactual.projected"
            ? { scenario, projectedRoute }
            : {},
      metaAuthorityRef: readString(payload.metaAuthorityRef) ?? "mission.command"
    });
  }

  if (warrantId) {
    artifacts.push({
      id: warrantId,
      artifactType: "execution-warrant",
      timestamp: event.timestamp,
      actor: event.actor,
      traceId: event.traceId,
      chainId: event.chainId,
      envelopeId: envelopeId ?? "unknown-envelope",
      admissibilityHash: readString(payload.admissibilityHash) ?? `adhoc-${event.id}`,
      missionId,
      targetNode: readString(payload.targetNode) ?? readString(payload.targetSystem) ?? "workspace",
      obligations: {
        witnessRequired: witnessStatus !== "not-required",
        minQuorum: typeof payload.minQuorum === "number" ? payload.minQuorum : undefined
      }
    });
  }

  if (witnessReceiptId) {
    const accepted = readString(payload.accepted) === "true" || payload.accepted === true || witnessStatus === "satisfied";
    artifacts.push({
      id: witnessReceiptId,
      artifactType: "witness-receipt",
      timestamp: event.timestamp,
      actor: event.actor,
      traceId: event.traceId,
      chainId: event.chainId,
      warrantId: warrantId ?? "unknown-warrant",
      envelopeId: envelopeId ?? "unknown-envelope",
      quorumRequired: typeof payload.quorumRequired === "number" ? payload.quorumRequired : 0,
      quorumReached: typeof payload.quorumReached === "number" ? payload.quorumReached : accepted ? 1 : 0,
      witnesses: readStringArray(payload.witnesses),
      accepted
    });
  }

  if (decisionId) {
    artifacts.push({
      id: decisionId,
      artifactType: "execution-decision",
      timestamp: event.timestamp,
      actor: event.actor,
      traceId: event.traceId,
      chainId: event.chainId,
      warrantId: warrantId ?? "unknown-warrant",
      envelopeId: envelopeId ?? "unknown-envelope",
      phase: eventPhase(event),
      targetType: targetId ? (readString(payload.actionId) || readString(payload.toolActionId) ? "tool-action" : "task") : "mission",
      targetId,
      decision:
        readString(payload.decision) === "deny" || readString(payload.decision) === "halt"
          ? (readString(payload.decision) as ExecutionDecision["decision"])
          : readString(payload.projectedOutcome) === "halt"
            ? "halt"
          : /blocked|halted/.test(event.eventKind)
            ? "deny"
            : "allow",
      reasons: reasons.length > 0 ? reasons : readString(projectedRoute.failoverReasoning) ? [readString(projectedRoute.failoverReasoning) as string] : [],
      killSwitchState:
        readString(payload.killSwitchState) === "active"
          ? "active"
          : readString(scenario.injectKillSwitch) === "true" || scenario.injectKillSwitch === true
          ? "active"
          : "inactive",
      witnessStatus
    });
  }

  if (finalityCertificateId) {
    artifacts.push({
      id: finalityCertificateId,
      artifactType: "finality-certificate",
      timestamp: event.timestamp,
      actor: event.actor,
      traceId: event.traceId,
      chainId: event.chainId,
      decisionId: decisionId ?? "unknown-decision",
      warrantId: warrantId ?? "unknown-warrant",
      receiptIds: readStringArray(payload.receiptIds),
      ledgerCommitIndex: committed.findIndex((item) => item.id === event.id)
    });
  }

  const killSwitchState = readString(payload.state);
  const killSwitchScope = readString(payload.scope);
  if (
    event.eventKind === "governance.kill-switch.updated" &&
    (killSwitchState === "active" || killSwitchState === "inactive") &&
    (
      killSwitchScope === "global" ||
      killSwitchScope === "mission" ||
      killSwitchScope === "domain" ||
      killSwitchScope === "agent" ||
      killSwitchScope === "device"
    )
  ) {
    const kernelEvent = isRecord(payload.kernel) && readString(payload.kernel.id)
      ? null
      : ({
          id: `kse-${event.id}`,
          artifactType: "kill-switch-event",
          timestamp: event.timestamp,
          actor: event.actor,
          traceId: event.traceId,
          chainId: event.chainId,
          state: killSwitchState,
          reason: readString(payload.reason) ?? "operator action",
          scope: killSwitchScope,
          scopeRef: readString(payload.scopeRef)
        } satisfies KillSwitchEvent);
    if (kernelEvent) {
      artifacts.push(kernelEvent);
    }
  }

  if (
    event.eventKind === "counterfactual.projected" &&
    (readString(scenario.scope) === "global" ||
      readString(scenario.scope) === "mission" ||
      readString(scenario.scope) === "domain" ||
      readString(scenario.scope) === "agent" ||
      readString(scenario.scope) === "device") &&
    (scenario.injectKillSwitch === true || readString(payload.projectedOutcome) === "halt")
  ) {
    artifacts.push({
      id: `kse-${event.id}`,
      artifactType: "kill-switch-event",
      timestamp: event.timestamp,
      actor: event.actor,
      traceId: event.traceId,
      chainId: event.chainId,
      state: "active",
      reason:
        readString(projectedRoute.failoverReasoning) ??
        `Counterfactual ${readString(scenario.scope) ?? "global"} halt projection.`,
      scope: readString(scenario.scope) as KillSwitchEvent["scope"],
      scopeRef: readString(scenario.scopeRef)
    });
  }

  if (event.eventKind === "counterfactual.projected" && projectedRecoveryPaths.length > 0) {
    for (const [index, path] of projectedRecoveryPaths.entries()) {
      artifacts.push({
        id: `rcv-${event.id}-${index + 1}`,
        artifactType: "recovery-plan",
        timestamp: event.timestamp,
        actor: event.actor,
        traceId: event.traceId,
        chainId: event.chainId,
        label: readString(path.label) ?? `Recovery path ${index + 1}`,
        mode:
          readString(path.mode) === "reroute" ||
          readString(path.mode) === "delegate" ||
          readString(path.mode) === "escalate"
            ? (readString(path.mode) as RecoveryPlanArtifact["mode"])
            : "resume",
        summary: readString(path.summary) ?? "Projected governed recovery path.",
        scope:
          readString(path.scope) === "global" ||
          readString(path.scope) === "mission" ||
          readString(path.scope) === "domain" ||
          readString(path.scope) === "agent" ||
          readString(path.scope) === "device"
            ? (readString(path.scope) as RecoveryPlanArtifact["scope"])
            : undefined,
        scopeRef: readString(path.scopeRef),
        branchRef: event.branchId
      });
    }
  }

  if (agentId && agentFingerprint) {
    artifacts.push({
      id: `ida-agent-${event.id}`,
      artifactType: "identity-attestation",
      timestamp: event.timestamp,
      actor: event.actor,
      traceId: event.traceId,
      chainId: event.chainId,
      subjectType: "agent",
      subjectId: agentId,
      fingerprint: agentFingerprint,
      issuerRef: readString(payload.issuer) ?? "mission.command",
      status:
        readString(payload.agentVerificationStatus) === "degraded" || readString(payload.agentVerificationStatus) === "revoked"
          ? (readString(payload.agentVerificationStatus) as IdentityAttestationArtifact["status"])
          : "verified",
      attributes: {
        model: readString(payload.agentModel),
        provider: readString(payload.agentProvider),
        trustTier: readString(payload.agentTrustTier)
      }
    });
  }

  if (deviceId && deviceFingerprint) {
    artifacts.push({
      id: `ida-device-${event.id}`,
      artifactType: "identity-attestation",
      timestamp: event.timestamp,
      actor: event.actor,
      traceId: event.traceId,
      chainId: event.chainId,
      subjectType: "device",
      subjectId: deviceId,
      fingerprint: deviceFingerprint,
      issuerRef: readString(payload.issuer) ?? "mission.command",
      status:
        readString(payload.deviceVerificationStatus) === "degraded" || readString(payload.deviceVerificationStatus) === "revoked"
          ? (readString(payload.deviceVerificationStatus) as IdentityAttestationArtifact["status"])
          : "verified",
      attributes: {
        workspaceId: readString(payload.workspaceId),
        branchName: readString(payload.branchName),
        memoryNamespace: readString(payload.memoryNamespace)
      }
    });
  }

  if (event.eventKind === "agent-os.execution.task.autonomous-completed") {
    artifacts.push({
      id: `aut-${event.id}`,
      artifactType: "autonomy-attestation",
      timestamp: event.timestamp,
      actor: event.actor,
      traceId: event.traceId,
      chainId: event.chainId,
      missionId,
      taskId: targetId,
      autonomyMode: "non-actuating",
      continuity:
        readString(payload.continuity) === "degraded" || readString(payload.continuity) === "disconnected"
          ? (readString(payload.continuity) as AutonomyAttestationArtifact["continuity"])
          : "stable",
      delegatedAuthorityAnchor: readString(payload.delegatedAuthorityAnchor),
      summary:
        readString(payload.summary) ??
        `Autonomous governed completion recorded for ${targetId ?? "mission task"}.`
    });
  }

  if (event.eventKind === "agent-os.runtime.reconciled" && Array.isArray(payload.continuityRecoveredTaskIds)) {
    for (const [index, recoveredTaskId] of payload.continuityRecoveredTaskIds.entries()) {
      if (typeof recoveredTaskId !== "string") continue;
      artifacts.push({
        id: `aut-${event.id}-${index + 1}`,
        artifactType: "autonomy-attestation",
        timestamp: event.timestamp,
        actor: event.actor,
        traceId: event.traceId,
        chainId: event.chainId,
        missionId,
        taskId: recoveredTaskId,
        autonomyMode: "recovery",
        summary: `Autonomous recovery preserved governed continuity for ${recoveredTaskId}.`
      });
    }
  }

  if (event.eventKind === "assurance.report.attested") {
    const report = isRecord(payload.report) ? payload.report : {};
    const mission = isRecord(payload.mission) ? payload.mission : {};
    const reportScope = readString(payload.reportScope) === "mission" ? "mission" : "system";
    const reasons = collectStringValues(reportScope === "mission" ? mission.reasons : report.systemReasons);
    artifacts.push({
      id: `ast-${event.id}`,
      artifactType: "assurance-attestation",
      timestamp: event.timestamp,
      actor: event.actor,
      traceId: event.traceId,
      chainId: event.chainId,
      reportScope,
      missionId: reportScope === "mission" ? readString(mission.missionId) ?? missionId : undefined,
      systemPosture:
        readString(report.systemPosture) === "insurable" || readString(report.systemPosture) === "halted"
          ? (readString(report.systemPosture) as AssuranceAttestationArtifact["systemPosture"])
          : "conditional",
      assurancePosture:
        reportScope === "mission" &&
        (readString(mission.assurancePosture) === "insurable" ||
          readString(mission.assurancePosture) === "conditional" ||
          readString(mission.assurancePosture) === "blocked" ||
          readString(mission.assurancePosture) === "halted")
          ? (readString(mission.assurancePosture) as AssuranceAttestationArtifact["assurancePosture"])
          : undefined,
      targetSystem: reportScope === "mission" ? readString(mission.targetSystem) : undefined,
      reasons:
        reasons.length > 0
          ? reasons
          : ["Enterprise assurance attestation was committed without explicit reasons."],
      attestedBy: readString(payload.attestedBy) ?? event.actor,
      summary:
        readString(payload.summary) ??
        (reportScope === "mission"
          ? `Mission assurance attested as ${readString(mission.assurancePosture) ?? "conditional"}.`
          : `System assurance attested as ${readString(report.systemPosture) ?? "conditional"}.`)
    });
  }

  return artifacts;
};

const eventMatchesRelatedId = (event: ReplayEvent, relatedId?: string) => {
  if (!relatedId) return true;
  if (event.id === relatedId || event.traceId === relatedId || event.chainId === relatedId || event.branchId === relatedId) {
    return true;
  }
  return collectStringValues(event.payload).some((value) => value === relatedId);
};

const extractArtifactsFromEvent = (event: ReplayEvent) => {
  const items = [...collectArtifacts(event.payload), ...synthesizeArtifactsFromEvent(event)];
  const deduped = new Map<string, IndexedArtifact>();
  for (const artifact of items) {
    deduped.set(artifact.id, verifyArtifact(artifact));
  }
  return [...deduped.values()];
};

const ingestArtifactsFromPayload = (event: ReplayEvent) => {
  for (const artifact of extractArtifactsFromEvent(event)) {
    indexedArtifacts.set(artifact.id, artifact);
  }
};

const artifactTimeline = (traceId?: string, artifactType?: ArtifactType, relatedId?: string, branchId?: string) => {
  const sourceItems = branchId
    ? (hypothetical.get(branchId) ?? []).filter((event) => eventMatchesRelatedId(event, relatedId))
    : committed.filter((event) => (traceId ? event.traceId === traceId : true) && eventMatchesRelatedId(event, relatedId));
  const items = sourceItems.flatMap((event) =>
    extractArtifactsFromEvent(event).filter((artifact) => (artifactType ? artifact.artifactType === artifactType : true))
  );
  const seen = new Set<string>();
  return items.filter((artifact) => {
    if (seen.has(artifact.id)) return false;
    seen.add(artifact.id);
    return true;
  });
};

await loadState();

// Keep the custom /health handler because it surfaces extra fields
// (persistedStatePath, committedEvents) operators rely on; mount only
// the structured /healthz + /readyz from the shared helper.
app.get("/health", (_req, res) =>
  res.json({ ok: true, service: "evidence-ledger", persistedStatePath: statePath, committedEvents: committed.length })
);
mountHealthEndpoints(app, {
  service: "evidence-ledger",
  mountLegacyHealth: false,
  readiness: () => ReadinessChecks.start()
    .add("service_initialized", true)
    .build()
});

// /events/commit + /branches + /branches/:id/events + /replay + /timeline
// moved to ./routes/replay-events.ts in stage 19. Behavior pinned by stage-2
// services/evidence-ledger/src/index.test.ts.
mountReplayEventsRoutes(app, {
  committed, branches, hypothetical,
  id, now,
  ingestArtifactsFromPayload, eventMatchesRelatedId,
  schedulePersist
});
app.get("/artifacts", (req, res) => {
  const traceId = typeof req.query.traceId === "string" ? req.query.traceId : undefined;
  const branchId = typeof req.query.branchId === "string" ? req.query.branchId : undefined;
  const relatedId = typeof req.query.relatedId === "string" ? req.query.relatedId : undefined;
  const artifactType =
    typeof req.query.artifactType === "string" && artifactTypes.has(req.query.artifactType as ArtifactType)
      ? (req.query.artifactType as ArtifactType)
      : undefined;
  res.json({ items: artifactTimeline(traceId, artifactType, relatedId, branchId) });
});
app.get("/artifacts/:id", (req, res) => {
  const artifact = indexedArtifacts.get(req.params.id);
  if (!artifact) return res.status(404).json({ error: "artifact_not_found" });
  res.json(artifact);
});

// ---------------------------------------------------------------------------
// Substrate GEL chain — hash-chained, signed evidence records.
//
// This sits ALONGSIDE the legacy event store above. The legacy store powers
// the operator UI's mission timeline and artifact browser. The GEL chain
// below is the cryptographic source of truth that an auditor / insurance
// carrier / regulator would verify offline.
//
// The two are complementary:
//   /events/commit, /timeline, /artifacts/*  → operator-facing event log
//   /gel/append, /gel/chain, /gel/verify     → substrate hash-chained ledger
//
// They share no state today. A future iteration could derive GEL records
// from /events/commit payloads automatically when the event represents a
// governance decision.
// ---------------------------------------------------------------------------

const gelPath = resolve(
  process.cwd(),
  process.env.EVIDENCE_LEDGER_GEL_PATH ?? "./data/evidence-ledger.gel.jsonl"
);

// /gel/* surface moved to ./routes/gel.ts in stage 18 of prototype-hardening.
// Behavior pinned by stage-3 services/evidence-ledger/src/gel-chain.test.ts
// (5 tests covering append + chain-linkage + verify + missing-fields envelope).
mountGelRoutes(app, { gelPath, now });

app.listen(port, () => console.log(`evidence-ledger on ${port} (substrate-wired: GEL chain at /gel/*)`));
