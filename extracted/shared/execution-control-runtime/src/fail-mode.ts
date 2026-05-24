/**
 * Per-Ward criticality fail-mode policy.
 *
 * Defense-review finding 2.6: "what does the boundary do when its own dependencies
 * degrade?" The doctrine answer is *fail closed* — governance binds before
 * consequence, and without evidence you do not act. But a single global fail-closed
 * is too blunt for a fleet: a routine telemetry Ward and a weapons-release Ward
 * should not have the same posture when the evidence ledger blips.
 *
 * This module makes that posture explicit and declarative. Each Ward carries a
 * `criticality`; when the boundary detects a degradation condition (ledger
 * unavailable, control-plane stale, write-quorum lost, attested-dependency
 * timeout), the prescribed fail action is a pure function of (criticality ×
 * condition). Safety-critical Wards fail closed on everything; lower criticalities
 * may escalate to a human or proceed in a marked "degraded" posture that the Edge
 * Conflict Inbox reconciles when the dependency returns.
 *
 * This decides nothing on the operator's behalf and never *weakens* a Ward: the
 * default for an unlabeled Ward is `mission_critical` (fails closed on infra loss).
 * It is a composable precondition the boundary checks; it does not replace the gate.
 */

export type WardCriticality = "safety_critical" | "mission_critical" | "routine" | "best_effort";

export type DegradationCondition =
  | "ledger_unavailable" // the Governance Evidence Ledger cannot be written (no evidence ⇒ no irreversible action)
  | "control_plane_stale" // revocation/time state could not be refreshed within budget
  | "quorum_lost" // HA: write quorum / leader lost (split-brain risk)
  | "dependency_timeout"; // an attested dependency (e.g. telemetry signer) timed out

/** "allow" = proceed normally; "allow_degraded" = proceed but mark for reconciliation. */
export type FailAction = "allow" | "allow_degraded" | "escalate" | "refuse";

const ACTION_RANK: Record<FailAction, number> = { allow: 0, allow_degraded: 1, escalate: 2, refuse: 3 };

export const DEFAULT_CRITICALITY: WardCriticality = "mission_critical";

/**
 * Default fail-mode matrix. Read as: under <condition>, a <criticality> Ward does
 * <action>. Tuned to the doctrine — the more consequential the Ward, the more it
 * fails closed; split-brain (quorum_lost) never resolves softer than escalate.
 */
export const DEFAULT_FAIL_MODE_POLICY: Record<WardCriticality, Record<DegradationCondition, FailAction>> = {
  safety_critical: {
    ledger_unavailable: "refuse",
    control_plane_stale: "refuse",
    quorum_lost: "refuse",
    dependency_timeout: "refuse"
  },
  mission_critical: {
    ledger_unavailable: "refuse",
    control_plane_stale: "refuse",
    quorum_lost: "refuse",
    dependency_timeout: "escalate"
  },
  routine: {
    ledger_unavailable: "escalate",
    control_plane_stale: "escalate",
    quorum_lost: "escalate",
    dependency_timeout: "allow_degraded"
  },
  best_effort: {
    ledger_unavailable: "allow_degraded",
    control_plane_stale: "allow_degraded",
    quorum_lost: "escalate",
    dependency_timeout: "allow_degraded"
  }
};

export interface FailModeResolution {
  action: FailAction;
  /** The condition that bound the decision (the most restrictive active one), if any. */
  condition?: DegradationCondition;
  criticality: WardCriticality;
}

/**
 * Resolve the fail action for a Ward under the active degradation conditions.
 * Returns the *most restrictive* action across all active conditions (refuse beats
 * escalate beats allow_degraded beats allow). No conditions ⇒ `allow`.
 */
export function resolveFailMode(
  criticality: WardCriticality | undefined,
  conditions: DegradationCondition[] | undefined,
  policy: Record<WardCriticality, Record<DegradationCondition, FailAction>> = DEFAULT_FAIL_MODE_POLICY
): FailModeResolution {
  const crit = criticality ?? DEFAULT_CRITICALITY;
  const table = policy[crit] ?? policy[DEFAULT_CRITICALITY];
  let chosen: FailAction = "allow";
  let bindingCondition: DegradationCondition | undefined;
  for (const condition of conditions ?? []) {
    const action = table[condition] ?? "refuse"; // unknown condition ⇒ fail closed
    if (ACTION_RANK[action] > ACTION_RANK[chosen]) {
      chosen = action;
      bindingCondition = condition;
    }
  }
  return { action: chosen, condition: bindingCondition, criticality: crit };
}

/** True when the resolution blocks the action at the gate (refuse or escalate). */
export function failModeBlocks(resolution: FailModeResolution): boolean {
  return resolution.action === "refuse" || resolution.action === "escalate";
}
