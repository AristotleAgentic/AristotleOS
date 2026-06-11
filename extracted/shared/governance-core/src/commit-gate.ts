/**
 * The Commit Gate — the Warden at the execution boundary.
 *
 * The gate does not author policy. It evaluates whether a *proposed* act is
 * admissible under a *complete* authority chain, and it does so BEFORE the act
 * produces consequence. It implements the spec evaluator in fixed order:
 *
 *   MAE validity -> Ward validity -> Authority Envelope validity -> Warrant
 *   validity -> action classification -> context admissibility -> telemetry ->
 *   revocation state -> temporal -> replay protection -> GEL precommit record.
 *
 * It returns Allow | Deny | Escalate | FailClosed and NEVER allows execution if
 * the chain is incomplete. The two terminal guarantees:
 *   - On Allow the Warrant is consumed (single-use) BEFORE the receipt is written
 *     — authority precedes attribution.
 *   - Any missing primitive or non-consumable warrant fails CLOSED, with evidence.
 */

import { hashCanonical, type Keyring } from "./hash.js";
import { evaluateConstraints, isSubsetOf, satisfies } from "./constraints.js";
import { GovernanceError, violation, type Violation } from "./errors.js";
import { finalizeAndAppend, type GelDraft } from "./gel.js";
import { newId } from "./ids.js";
import { chainIsIntact, context } from "./validators.js";
import type { GovernanceStore } from "./store.js";
import type {
  AuthorityEnvelope,
  ChainRefs,
  CommitDecision,
  CommitDecisionKind,
  CommitRequest,
  ExecutionResult,
  GELRecord,
  MetaAuthorityEnvelope,
  RevocationSnapshot,
  Warrant,
  WarrantConsumptionProof,
  Ward,
} from "./types.js";

export interface CommitOptions {
  now?: Date;
  /** Maximum accepted age/future skew for CommitRequest.presented_at. */
  presentationSkewMs?: number;
  keyring: Keyring;
  /** Key the gate signs GEL records with. */
  signKeyId: string;
}

export function evaluateCommit(store: GovernanceStore, request: CommitRequest, opts: CommitOptions): CommitDecision {
  const ctx = context({ now: opts.now, keyring: opts.keyring, presentationSkewMs: opts.presentationSkewMs });
  const now = ctx.now;
  const chain: ChainRefs = { commit_gate_id: request.commit_gate_id };

  try {
    // -- load + structural existence (each miss is fail-closed) ---------------
    const gate = store.getCommitGate(request.commit_gate_id);
    if (!gate) return emit(store, opts, request, chain, "FailClosed", ["commit-gate-not-found"], undefined, undefined, now);
    if (!gate.fail_closed) {
      // A gate that does not fail closed is not a Warden. Refuse to operate it.
      return emit(store, opts, request, chain, "FailClosed", ["commit-gate-must-fail-closed"], undefined, undefined, now);
    }

    const mae = store.getMae(request.mae_id);
    if (!mae) return emit(store, opts, request, chain, "FailClosed", ["mae-not-found"], undefined, undefined, now);
    chain.mae_id = mae.mae_id;

    const ward = store.getWard(request.ward_id);
    if (!ward) return emit(store, opts, request, chain, "FailClosed", ["ward-not-found"], undefined, undefined, now);
    chain.ward_id = ward.ward_id;

    const env = store.getEnvelope(request.authority_envelope_id);
    if (!env) return emit(store, opts, request, chain, "FailClosed", ["authority-envelope-not-found"], ward, undefined, now);
    chain.authority_envelope_id = env.authority_envelope_id;

    const warrant = store.getWarrant(request.warrant_id);
    if (!warrant) return emit(store, opts, request, chain, "FailClosed", ["warrant-not-found"], ward, undefined, now);
    chain.warrant_id = warrant.warrant_id;

    // -- chain validity (MAE -> Ward -> Envelope -> Warrant) -----------------
    const violations: Violation[] = [...chainIsIntact(mae, ward, env, warrant, request, ctx).violations];
    latchExpiredWarrant(store, warrant, now);

    // -- action classification ----------------------------------------------
    if (request.action.action_type !== warrant.action_type)
      violations.push(violation("action-classification", "request action_type does not match the warrant"));
    if (!isSubsetOf([request.action.action_type], env.allowed_action_classes))
      violations.push(violation("action-classification", `action_type ${request.action.action_type} not permitted by envelope`));

    // -- context admissibility (Ward boundary, geo, operational limits) ------
    const facts = { ...request.telemetry, ...request.context, ...request.action.parameters } as Record<string, unknown>;
    const spendAmount = numberOrUndefined(request.action.parameters["amount"]);
    const spendCurrency = stringOrUndefined(request.action.parameters["currency"]) ?? env.cumulative_monetary_limit?.currency ?? "";
    violations.push(...evaluateConstraints(ward.boundary_definition?.predicates, facts, "ward-boundary"));
    violations.push(...evaluateConstraints(env.geographic_scope, facts, "envelope-geographic-scope"));
    violations.push(...evaluateConstraints(env.operational_limits, facts, "envelope-operational-limit"));

    // -- telemetry requirements ---------------------------------------------
    violations.push(...evaluateConstraints(env.telemetry_requirements, request.telemetry, "envelope-telemetry"));

    // -- cumulative spend budget (a running ceiling across all consumed acts) -
    if (env.cumulative_monetary_limit && spendAmount !== undefined) {
      const limit = env.cumulative_monetary_limit;
      if (spendCurrency !== limit.currency) {
        violations.push(violation("envelope-cumulative-budget", `currency ${spendCurrency} does not match budget currency ${limit.currency}`));
      } else if (store.spentFor(env.authority_envelope_id, limit.currency) + spendAmount > limit.max_amount) {
        violations.push(
          violation(
            "envelope-cumulative-budget-exceeded",
            `act (${spendAmount}) would exceed the ${limit.max_amount} ${limit.currency} cumulative budget (already spent ${store.spentFor(env.authority_envelope_id, limit.currency)})`,
          ),
        );
      }
    }

    // -- escalation ----------------------------------------------------------
    let escalate = false;
    for (const rule of env.escalation_requirements ?? []) {
      if (satisfies(rule.when, facts)) {
        if (rule.action === "deny") violations.push(violation("escalation-deny", `denied by escalation rule on ${rule.when.key}`));
        else escalate = true;
      }
    }

    // -- decide --------------------------------------------------------------
    if (violations.length > 0) {
      return emit(store, opts, request, chain, "Deny", violations.map((v) => v.invariant), ward, { mae, env, warrant }, now, violations);
    }
    if (escalate) {
      return emit(store, opts, request, chain, "Escalate", ["escalation-required"], ward, { mae, env, warrant }, now);
    }

    // -- allow: consume warrant FIRST, then write the receipt ----------------
    let proof: WarrantConsumptionProof;
    try {
      proof = store.consumeWarrant(warrant.warrant_id, request.commit_gate_id, now.toISOString());
    } catch (e) {
      if (e instanceof GovernanceError)
        return emit(store, opts, request, chain, "FailClosed", [e.code], ward, { mae, env, warrant }, now);
      throw e;
    }

    // Authority is spent: record the act's contribution to the envelope budget.
    if (env.cumulative_monetary_limit && spendAmount !== undefined && spendCurrency === env.cumulative_monetary_limit.currency) {
      store.recordSpend(env.authority_envelope_id, spendCurrency, spendAmount);
    }

    const record = writeRecord(store, opts, request, chain, "Allow", ["admissible"], { mae, ward, env, warrant }, now, proof);
    chain.gel_record_id = record.gel_record_id;
    return decision("Allow", request, chain, ["admissible"], [], true, record, now);
  } catch (e) {
    // Anything unanticipated is a refusal to answer: fail closed.
    return emit(store, opts, request, chain, "FailClosed", ["chain-incomplete"], undefined, undefined, now, [
      violation("chain-incomplete", e instanceof Error ? e.message : String(e)),
    ]);
  }
}

/**
 * Record the outcome of a permitted execution as a SEPARATE GEL record. Keeping
 * admissibility and execution as distinct records is the ledger expression of
 * the ontology: authority, execution and attribution are not the same event.
 */
export function recordExecutionOutcome(
  store: GovernanceStore,
  opts: CommitOptions,
  allowDecision: CommitDecision,
  result: ExecutionResult,
): GELRecord {
  const now = opts.now ?? new Date();
  const draft: GelDraft = {
    gel_record_id: newId("gel"),
    mae_id: allowDecision.chain.mae_id,
    ward_id: allowDecision.chain.ward_id,
    authority_envelope_id: allowDecision.chain.authority_envelope_id,
    warrant_id: allowDecision.chain.warrant_id,
    commit_gate_id: allowDecision.chain.commit_gate_id,
    actor: "execution",
    action: "execution.outcome",
    action_hash: result.output_hash ?? hashCanonical(result),
    context_hash: "",
    telemetry_hash: "",
    policy_hashes: [],
    revocation_snapshot: { mae: "active", ward: "active", authority_envelope: "active", warrant: "Consumed" },
    decision: "Allow",
    decision_reason: `execution ${result.status}`,
    execution_result: result,
    record_kind: "execution",
    timestamp: now.toISOString(),
  };
  return finalizeAndAppend(store, opts.keyring, opts.signKeyId, draft);
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

interface ChainObjects {
  mae?: MetaAuthorityEnvelope;
  ward?: Ward;
  env?: AuthorityEnvelope;
  warrant?: Warrant;
}

function emit(
  store: GovernanceStore,
  opts: CommitOptions,
  request: CommitRequest,
  chain: ChainRefs,
  kind: CommitDecisionKind,
  reasons: string[],
  ward: Ward | undefined,
  objects: ChainObjects | undefined,
  now: Date,
  violations: Violation[] = [],
): CommitDecision {
  // Denials, escalations and fail-closed all leave evidence by default. A Ward
  // may opt out of recording denials, but never escalations or fail-closed.
  const recordIt =
    kind === "Allow" ||
    kind === "Escalate" ||
    kind === "FailClosed" ||
    !ward ||
    ward.evidence_requirements?.record_denials !== false;

  let record: GELRecord | undefined;
  if (recordIt) {
    record = writeRecord(store, opts, request, chain, kind, reasons, { ...objects, ward }, now, undefined);
    chain.gel_record_id = record.gel_record_id;
  }
  return decision(kind, request, chain, reasons, violations.map((v) => v.invariant), false, record, now);
}

function writeRecord(
  store: GovernanceStore,
  opts: CommitOptions,
  request: CommitRequest,
  chain: ChainRefs,
  kind: CommitDecisionKind,
  reasons: string[],
  objects: ChainObjects,
  now: Date,
  proof: WarrantConsumptionProof | undefined,
): GELRecord {
  const draft: GelDraft = {
    gel_record_id: newId("gel"),
    mae_id: chain.mae_id,
    ward_id: chain.ward_id,
    authority_envelope_id: chain.authority_envelope_id,
    warrant_id: chain.warrant_id,
    commit_gate_id: chain.commit_gate_id,
    actor: request.action.actor,
    action: request.action.action_type,
    action_hash: hashCanonical(request.action.parameters),
    context_hash: hashCanonical(request.context),
    telemetry_hash: hashCanonical(request.telemetry),
    policy_hashes: policyHashes(objects),
    revocation_snapshot: snapshot(objects),
    decision: kind,
    decision_reason: reasons.join("; ") || kind,
    warrant_consumption_proof: proof,
    record_kind: "admissibility",
    timestamp: now.toISOString(),
  };
  return finalizeAndAppend(store, opts.keyring, opts.signKeyId, draft);
}

function decision(
  kind: CommitDecisionKind,
  request: CommitRequest,
  chain: ChainRefs,
  reasons: string[],
  violated: string[],
  consumed: boolean,
  record: GELRecord | undefined,
  now: Date,
): CommitDecision {
  return {
    decision: kind,
    request_id: request.request_id,
    reasons,
    violated_invariants: violated,
    warrant_consumed: consumed,
    gel_record_id: record?.gel_record_id,
    gel_record_hash: record?.gel_record_hash,
    evaluated_at: now.toISOString(),
    chain,
  };
}

function policyHashes(o: ChainObjects): string[] {
  return [o.mae?.policy_hash, o.ward?.policy_hash, o.env?.policy_hash].filter((h): h is string => typeof h === "string");
}

function snapshot(o: ChainObjects): RevocationSnapshot {
  return {
    mae: o.mae?.revoked_at ? "revoked" : "active",
    ward: o.ward?.revoked_at ? "revoked" : o.ward?.suspended_at ? "suspended" : "active",
    authority_envelope: o.env?.revocation_state ?? "active",
    warrant: o.warrant?.consumption_state ?? "Unused",
  };
}

function latchExpiredWarrant(store: GovernanceStore, warrant: Warrant, now: Date): void {
  const expiresAt = Date.parse(warrant.expires_at);
  if (warrant.consumption_state === "Unused" && !Number.isNaN(expiresAt) && now.getTime() > expiresAt) {
    store.expireWarrant(warrant.warrant_id, now.toISOString());
  }
}

function numberOrUndefined(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function stringOrUndefined(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
