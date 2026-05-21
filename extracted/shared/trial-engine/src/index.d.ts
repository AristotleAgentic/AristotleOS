export type TrialDecisionState = "PERMIT" | "DENY" | "DEFER" | "REVOKED" | "FAIL_CLOSED";
export interface TrialWard {
    id: string;
    sovereign: string;
    scope: string[];
    defaultPosture: "deny" | "permit";
}
export interface TrialAuthorityEnvelope {
    id: string;
    ward: string;
    actor: string;
    permittedActions: string[];
    maxAmount?: number;
    currency?: string;
    expiresIn: string;
    revocable: boolean;
    revoked?: boolean;
}
export interface TrialCommitGate {
    id: string;
    action: string;
    requireAuthority: string;
    requireWarrant: boolean;
    autonomousLimit?: number;
    deferAboveOrEqual?: number;
    denyAbove?: number;
    denyActions: string[];
    evidence: string[];
}
export interface TrialWarrantPolicy {
    id: string;
    standingPower: boolean;
    issueOn: string;
    expiresIn: string;
    singleUse: boolean;
}
export interface TrialGelPolicy {
    hashChain: boolean;
    signRecords: boolean;
    includeReplayMaterial: boolean;
}
export interface TrialGovernancePolicy {
    source: string;
    policyHash: string;
    ward: TrialWard;
    authority: TrialAuthorityEnvelope;
    commitGate: TrialCommitGate;
    warrantPolicy: TrialWarrantPolicy;
    gel: TrialGelPolicy;
}
export interface TrialActionIntent {
    scenarioId: string;
    agentId: string;
    missionId: string;
    requestedAction: string;
    target: string;
    parameters: Record<string, string | number | boolean>;
    consequenceClass: string;
    riskLevel: "low" | "medium" | "high" | "critical";
    occurredAt?: string;
}
export interface TrialPipelineStep {
    id: string;
    label: string;
    status: "pending" | "running" | "passed" | "blocked" | "deferred";
    detail: string;
}
export interface TrialWarrant {
    id: string;
    wardId: string;
    actionHash: string;
    authorityHash: string;
    policyHash: string;
    issuedAt: string;
    expiresAt: string;
    singleUse: boolean;
    signature: string;
}
export interface TrialGelRecord {
    recordId: string;
    previousHash: string;
    currentHash: string;
    actionHash: string;
    policyHash: string;
    authorityHash: string;
    decision: TrialDecisionState;
    timestamp: string;
    witnessSet: string[];
    replayable: boolean;
}
export interface TrialEvaluation {
    decision: TrialDecisionState;
    decisionCode: string;
    explanation: string;
    controllingRule: string;
    pipeline: TrialPipelineStep[];
    warrant?: TrialWarrant;
    gelRecord: TrialGelRecord;
    deferToken?: string;
    replay: {
        stable: boolean;
        policyHash: string;
        actionHash: string;
        materialHash: string;
    };
}
export interface TrialScenario {
    id: string;
    title: string;
    summary: string;
    intent: TrialActionIntent;
}
export declare const PAYMENTS_GOVERNANCE_SOURCE = "ward \"enterprise-payments\" {\n  sovereign = \"Acme Finance\"\n  scope = [\"payments\", \"refunds\", \"customer-remediation\"]\n  default_posture = \"deny\"\n}\n\nauthority_envelope \"refund-authority\" {\n  ward = \"enterprise-payments\"\n  actor = \"agent:payments-remediation\"\n  permitted_actions = [\"stripe.refund\"]\n  max_amount = 10000\n  currency = \"USD\"\n  expires_in = \"15m\"\n  revocable = true\n  revoked = false\n}\n\ncommit_gate \"payments-gate\" {\n  action = \"stripe.refund\"\n  require_authority = \"refund-authority\"\n  require_warrant = true\n  autonomous_limit = 500\n  defer_if amount >= 500\n  deny_if amount > 10000\n  deny_action \"stripe.payout\"\n  evidence = [\"policy_hash\", \"authority_hash\", \"ward_context\", \"telemetry\", \"operator_decision\"]\n}\n\nwarrant_policy \"refund-warrant\" {\n  standing_power = false\n  issue_on = \"admissible_commit\"\n  expires_in = \"60s\"\n  single_use = true\n}\n\ngel {\n  hash_chain = true\n  sign_records = true\n  include_replay_material = true\n}";
export declare const TRIAL_SCENARIOS: TrialScenario[];
export declare function stableStringify(value: unknown): string;
export declare function stableHash(value: unknown): string;
export declare function parseGovernanceSource(source: string): TrialGovernancePolicy;
export declare function validateGovernanceSource(source: string): {
    ok: boolean;
    errors: {
        path: string;
        message: string;
    }[];
    policy: TrialGovernancePolicy | undefined;
};
export declare function evaluateTrialAction(input: {
    source?: string;
    policy?: TrialGovernancePolicy;
    intent: TrialActionIntent;
    approval?: "approve" | "deny" | "more_info" | "reduced_authority";
    previousHash?: string;
    now?: string;
}): TrialEvaluation;
export declare function planGovernanceChange(source: string, currentSource?: string): {
    ok: boolean;
    errors: {
        path: string;
        message: string;
    }[];
    changes: string[];
    nextPolicyHash: undefined;
} | {
    ok: boolean;
    errors: {
        path: string;
        message: string;
    }[];
    changes: string[];
    nextPolicyHash: string;
};
