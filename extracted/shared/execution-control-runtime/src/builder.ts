import {
  type AuthorityEnvelope,
  type CanonicalActionInput,
  type ExecutionControlDecision,
  type ExecutionControlReasonCode,
  type JsonValue,
  type RuntimeRegister,
  type WardManifest,
  evaluateCommitGate,
  sha256,
  stableStringify,
  validateAuthorityEnvelope,
  validateWardManifest
} from "./index.js";

/**
 * Visual Governance Builder — backend.
 *
 * Composes, validates, hashes, diffs, and explains real AristotleOS governance
 * artifacts (Ward Manifest + Authority Envelope). There is no invented "policy
 * bytecode": the compiled artifact is the manifest itself plus content hashes, and
 * "what it permits/refuses/escalates" is computed by running sample actions through
 * the real Commit Gate. The diff explicitly flags any change that *weakens*
 * authority, so a builder UI can never loosen governance silently.
 */

export interface GovernanceManifest {
  manifest_version: "aristotle.governance-manifest.v1";
  compiled_at: string;
  ward: WardManifest;
  authority_envelope: AuthorityEnvelope;
  hashes: { ward_hash: string; authority_envelope_hash: string; manifest_hash: string };
  validation: { ok: boolean; errors: string[] };
}

export interface GovernanceDraft {
  ward: WardManifest;
  authorityEnvelope: AuthorityEnvelope;
  now?: string;
}

/** Validate + hash a draft into a compiled, content-addressed governance manifest. */
export function compileGovernanceManifest(draft: GovernanceDraft): GovernanceManifest {
  const wardResult = validateWardManifest(draft.ward);
  const envelopeResult = validateAuthorityEnvelope(draft.authorityEnvelope);
  const errors = [
    ...wardResult.issues.map((i) => `ward.${i.path}: ${i.message}`),
    ...envelopeResult.issues.map((i) => `authority_envelope.${i.path}: ${i.message}`)
  ];
  // Cross-artifact coherence (the gate enforces these at runtime; surface them here).
  if (draft.authorityEnvelope.ward_id !== draft.ward.ward_id) {
    errors.push("authority_envelope.ward_id: does not match ward.ward_id");
  }
  if (draft.ward.permitted_subjects && !draft.ward.permitted_subjects.includes(draft.authorityEnvelope.subject)) {
    errors.push("authority_envelope.subject: not listed in ward.permitted_subjects (actions would be refused)");
  }

  const ward = stableNormalizeArtifact(draft.ward) as WardManifest;
  const authority_envelope = stableNormalizeArtifact(draft.authorityEnvelope) as AuthorityEnvelope;
  const ward_hash = sha256(stableStringify(ward));
  const authority_envelope_hash = sha256(stableStringify(authority_envelope));
  const manifest_hash = sha256(stableStringify({ ward_hash, authority_envelope_hash }));

  return {
    manifest_version: "aristotle.governance-manifest.v1",
    compiled_at: draft.now ?? new Date().toISOString(),
    ward,
    authority_envelope,
    hashes: { ward_hash, authority_envelope_hash, manifest_hash },
    validation: { ok: errors.length === 0, errors }
  };
}

function stableNormalizeArtifact(value: unknown): unknown {
  return JSON.parse(stableStringify(value));
}

// ---------------------------------------------------------------------------
// Diff — with explicit "weakening" classification
// ---------------------------------------------------------------------------

export interface GovernanceDiffEntry {
  path: string;
  kind: "added" | "removed" | "changed";
  before?: JsonValue;
  after?: JsonValue;
  /** True when the change broadens authority (e.g., adds an allowed action). */
  weakening: boolean;
  note: string;
}

function diffArray(path: string, before: string[] = [], after: string[] = [], addBroadens: boolean, label: string): GovernanceDiffEntry[] {
  const entries: GovernanceDiffEntry[] = [];
  for (const item of after.filter((x) => !before.includes(x))) {
    entries.push({ path: `${path}[+${item}]`, kind: "added", after: item, weakening: addBroadens, note: addBroadens ? `broadens ${label}` : `tightens ${label}` });
  }
  for (const item of before.filter((x) => !after.includes(x))) {
    entries.push({ path: `${path}[-${item}]`, kind: "removed", before: item, weakening: !addBroadens, note: addBroadens ? `tightens ${label}` : `broadens ${label}` });
  }
  return entries;
}

function diffScalar(path: string, before: JsonValue | undefined, after: JsonValue | undefined, weakening: boolean, note: string): GovernanceDiffEntry[] {
  if (stableStringify(before) === stableStringify(after)) return [];
  return [{ path, kind: before === undefined ? "added" : after === undefined ? "removed" : "changed", before, after, weakening, note }];
}

/**
 * Governance-aware diff of two drafts. Flags authority-relevant changes and marks
 * which ones weaken governance, so a builder can require explicit operator review.
 */
export function diffGovernanceManifests(before: GovernanceDraft, after: GovernanceDraft): GovernanceDiffEntry[] {
  const entries: GovernanceDiffEntry[] = [];
  const bw = before.ward;
  const aw = after.ward;
  const be = before.authorityEnvelope;
  const ae = after.authorityEnvelope;

  // Ward
  entries.push(...diffArray("ward.permitted_subjects", bw.permitted_subjects, aw.permitted_subjects, true, "permitted subjects"));
  entries.push(...diffScalar("ward.policy_version", bw.policy_version, aw.policy_version, false, "policy version changed"));
  const bb = bw.physical_bounds ?? {};
  const ab = aw.physical_bounds ?? {};
  entries.push(...diffScalar("ward.physical_bounds.max_altitude_m", bb.max_altitude_m, ab.max_altitude_m, (ab.max_altitude_m ?? 0) > (bb.max_altitude_m ?? 0), "altitude ceiling"));
  entries.push(...diffScalar("ward.physical_bounds.battery_minimum_pct", bb.battery_minimum_pct, ab.battery_minimum_pct, (ab.battery_minimum_pct ?? 0) < (bb.battery_minimum_pct ?? 0), "battery floor"));
  entries.push(...diffScalar("ward.physical_bounds.permitted_boundary_id", bb.permitted_boundary_id, ab.permitted_boundary_id, false, "permitted boundary changed"));

  // Authority Envelope
  entries.push(...diffScalar("authority_envelope.subject", be.subject, ae.subject, false, "subject changed"));
  entries.push(...diffScalar("authority_envelope.ward_id", be.ward_id, ae.ward_id, false, "ward binding changed"));
  entries.push(...diffArray("authority_envelope.allowed_actions", be.allowed_actions, ae.allowed_actions, true, "allowed actions"));
  entries.push(...diffArray("authority_envelope.denied_actions", be.denied_actions, ae.denied_actions, false, "denied actions"));
  entries.push(...diffScalar("authority_envelope.expires_at", be.expires_at, ae.expires_at, Date.parse(ae.expires_at) > Date.parse(be.expires_at), "expiry extended"));

  // Constraints
  const bc = (be.constraints ?? {}) as Record<string, JsonValue>;
  const ac = (ae.constraints ?? {}) as Record<string, JsonValue>;
  for (const key of new Set([...Object.keys(bc), ...Object.keys(ac)])) {
    if (key === "required_runtime_registers") {
      entries.push(...diffArray("authority_envelope.constraints.required_runtime_registers", bc[key] as string[] | undefined, ac[key] as string[] | undefined, false, "required runtime registers"));
      continue;
    }
    const bv = bc[key];
    const av = ac[key];
    const weakening = typeof bv === "number" && typeof av === "number" ? av > bv : bv !== undefined && av === undefined; // raising a numeric cap, or removing a constraint, weakens
    entries.push(...diffScalar(`authority_envelope.constraints.${key}`, bv, av, weakening, "constraint changed"));
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Explain — what the policy permits / refuses / escalates
// ---------------------------------------------------------------------------

export interface PolicySampleResult {
  action_id: string;
  action_type: string;
  decision: ExecutionControlDecision;
  reason_codes: ExecutionControlReasonCode[];
}

export interface PolicyExplanation {
  ward_id: string;
  authority_envelope_id: string;
  allowed_actions: string[];
  denied_actions: string[];
  constraints: Record<string, JsonValue>;
  samples: PolicySampleResult[];
}

/**
 * Explain a draft policy in plain terms: its allow/deny surface, its constraints,
 * and the actual gate decision for each provided sample action.
 */
export function explainPolicy(input: {
  ward: WardManifest;
  authorityEnvelope: AuthorityEnvelope;
  sampleActions?: CanonicalActionInput[];
  runtimeRegister?: RuntimeRegister;
  now?: string;
}): PolicyExplanation {
  const samples: PolicySampleResult[] = (input.sampleActions ?? []).map((action) => {
    const decision = evaluateCommitGate({ ward: input.ward, authorityEnvelope: input.authorityEnvelope, action, runtimeRegister: input.runtimeRegister, now: input.now });
    return { action_id: action.action_id, action_type: action.action_type, decision: decision.decision, reason_codes: decision.reason_codes };
  });
  return {
    ward_id: input.ward.ward_id,
    authority_envelope_id: input.authorityEnvelope.envelope_id,
    allowed_actions: input.authorityEnvelope.allowed_actions ?? [],
    denied_actions: input.authorityEnvelope.denied_actions ?? [],
    constraints: (input.authorityEnvelope.constraints ?? {}) as Record<string, JsonValue>,
    samples
  };
}
