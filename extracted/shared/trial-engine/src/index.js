export const PAYMENTS_GOVERNANCE_SOURCE = `ward "enterprise-payments" {
  sovereign = "Acme Finance"
  scope = ["payments", "refunds", "customer-remediation"]
  default_posture = "deny"
}

authority_envelope "refund-authority" {
  ward = "enterprise-payments"
  actor = "agent:payments-remediation"
  permitted_actions = ["stripe.refund"]
  max_amount = 10000
  currency = "USD"
  expires_in = "15m"
  revocable = true
  revoked = false
}

commit_gate "payments-gate" {
  action = "stripe.refund"
  require_authority = "refund-authority"
  require_warrant = true
  autonomous_limit = 500
  defer_if amount >= 500
  deny_if amount > 10000
  deny_action "stripe.payout"
  evidence = ["policy_hash", "authority_hash", "ward_context", "telemetry", "operator_decision"]
}

warrant_policy "refund-warrant" {
  standing_power = false
  issue_on = "admissible_commit"
  expires_in = "60s"
  single_use = true
}

gel {
  hash_chain = true
  sign_records = true
  include_replay_material = true
}`;
export const TRIAL_SCENARIOS = [
    {
        id: "payments-refund-8000",
        title: "Payments agent attempts $8,000 refund",
        summary: "A remediation agent requests a high-value Stripe refund that must defer to an operator before warrant issuance.",
        intent: {
            scenarioId: "payments-refund-8000",
            agentId: "agent:payments-remediation",
            missionId: "mission:customer-remediation-042",
            requestedAction: "stripe.refund",
            target: "stripe.refunds.create",
            parameters: { amount: 8000, currency: "USD", customerId: "cus_enterprise_17" },
            consequenceClass: "money-movement",
            riskLevel: "high"
        }
    },
    {
        id: "payments-payout-deny",
        title: "Payments agent attempts payout",
        summary: "A payout action sits outside the authority envelope and is denied before warrant issuance.",
        intent: {
            scenarioId: "payments-payout-deny",
            agentId: "agent:payments-remediation",
            missionId: "mission:customer-remediation-043",
            requestedAction: "stripe.payout",
            target: "stripe.payouts.create",
            parameters: { amount: 1200, currency: "USD", destination: "acct_external" },
            consequenceClass: "money-movement",
            riskLevel: "critical"
        }
    },
    {
        id: "kubernetes-production-deploy",
        title: "Kubernetes agent attempts production deployment",
        summary: "A platform agent requests a production rollout that requires authority binding before cluster mutation.",
        intent: {
            scenarioId: "kubernetes-production-deploy",
            agentId: "agent:platform-deployer",
            missionId: "mission:prod-rollout-018",
            requestedAction: "kubernetes.deploy",
            target: "cluster/prod/apps/payments-api",
            parameters: { namespace: "payments", image: "ghcr.io/acme/payments:2026.05.20", replicas: 8 },
            consequenceClass: "infrastructure-change",
            riskLevel: "high"
        }
    },
    {
        id: "drone-restricted-airspace",
        title: "Drone swarm requests restricted airspace",
        summary: "A drone mission requests entry into a protected airspace ward.",
        intent: {
            scenarioId: "drone-restricted-airspace",
            agentId: "agent:drone-swarm",
            missionId: "mission:inspection-corridor-009",
            requestedAction: "drone.enter_airspace",
            target: "airspace/restricted/sector-7",
            parameters: { ceilingFeet: 400, corridor: "sector-7", vehicles: 6 },
            consequenceClass: "physical-actuation",
            riskLevel: "critical"
        }
    },
    {
        id: "healthcare-record-modification",
        title: "Healthcare agent attempts record modification",
        summary: "A healthcare agent asks to alter a patient record and must preserve institutional accountability.",
        intent: {
            scenarioId: "healthcare-record-modification",
            agentId: "agent:care-ops",
            missionId: "mission:chart-correction-221",
            requestedAction: "ehr.record.update",
            target: "ehr/patient-records",
            parameters: { patientRef: "pat_redacted_44", field: "medication", changeType: "update" },
            consequenceClass: "regulated-record",
            riskLevel: "critical"
        }
    },
    {
        id: "firewall-rule-change",
        title: "Infrastructure agent attempts firewall rule change",
        summary: "An infrastructure agent requests a network boundary change with security consequence.",
        intent: {
            scenarioId: "firewall-rule-change",
            agentId: "agent:network-ops",
            missionId: "mission:incident-containment-077",
            requestedAction: "firewall.rule.create",
            target: "edge-firewall/prod",
            parameters: { cidr: "10.44.0.0/16", port: 443, direction: "ingress" },
            consequenceClass: "security-boundary",
            riskLevel: "high"
        }
    },
    {
        id: "procurement-contract-approval",
        title: "Procurement agent attempts contract approval",
        summary: "A procurement agent requests approval authority for a vendor contract.",
        intent: {
            scenarioId: "procurement-contract-approval",
            agentId: "agent:procurement",
            missionId: "mission:vendor-renewal-106",
            requestedAction: "procurement.contract.approve",
            target: "erp/contracts",
            parameters: { amount: 42000, currency: "USD", vendor: "supplier-redacted" },
            consequenceClass: "financial-commitment",
            riskLevel: "high"
        }
    }
];
const block = (source, name) => source.match(new RegExp(`${name}\\s+"?([^"{\\s]+)?"?\\s*\\{([\\s\\S]*?)\\}`, "m"));
const stringField = (body, key, fallback = "") => body.match(new RegExp(`${key}\\s*=\\s*"([^"]+)"`))?.[1] ?? fallback;
const boolField = (body, key, fallback = false) => {
    const value = body.match(new RegExp(`${key}\\s*=\\s*(true|false)`))?.[1];
    return value ? value === "true" : fallback;
};
const numberField = (body, key) => {
    const value = body.match(new RegExp(`${key}\\s*=\\s*([0-9]+(?:\\.[0-9]+)?)`))?.[1];
    return value ? Number(value) : undefined;
};
const stringArrayField = (body, key) => {
    const value = body.match(new RegExp(`${key}\\s*=\\s*\\[([^\\]]*)\\]`))?.[1] ?? "";
    return value.split(",").map((part) => part.trim().replace(/^"|"$/g, "")).filter(Boolean);
};
export function stableStringify(value) {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(stableStringify).join(",")}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}
export function stableHash(value) {
    const input = typeof value === "string" ? value : stableStringify(value);
    let hash = 2166136261;
    for (let index = 0; index < input.length; index++) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `aos-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
export function parseGovernanceSource(source) {
    const wardMatch = block(source, "ward");
    const authorityMatch = block(source, "authority_envelope");
    const gateMatch = block(source, "commit_gate");
    const warrantMatch = block(source, "warrant_policy");
    const gelMatch = block(source, "gel");
    if (!wardMatch || !authorityMatch || !gateMatch || !warrantMatch || !gelMatch) {
        throw new Error("governance file must define ward, authority_envelope, commit_gate, warrant_policy, and gel blocks");
    }
    const wardBody = wardMatch[2] ?? "";
    const authorityBody = authorityMatch[2] ?? "";
    const gateBody = gateMatch[2] ?? "";
    const warrantBody = warrantMatch[2] ?? "";
    const gelBody = gelMatch[2] ?? "";
    const denyActions = Array.from(gateBody.matchAll(/deny_action\s+"([^"]+)"/g)).map((match) => match[1] ?? "").filter(Boolean);
    const deferAboveOrEqual = gateBody.match(/defer_if\s+amount\s+>=\s+([0-9]+(?:\.[0-9]+)?)/)?.[1];
    const denyAbove = gateBody.match(/deny_if\s+amount\s+>\s+([0-9]+(?:\.[0-9]+)?)/)?.[1];
    const policy = {
        source,
        policyHash: stableHash(source),
        ward: {
            id: wardMatch[1] ?? "unnamed-ward",
            sovereign: stringField(wardBody, "sovereign"),
            scope: stringArrayField(wardBody, "scope"),
            defaultPosture: stringField(wardBody, "default_posture", "deny") === "permit" ? "permit" : "deny"
        },
        authority: {
            id: authorityMatch[1] ?? "unnamed-authority",
            ward: stringField(authorityBody, "ward"),
            actor: stringField(authorityBody, "actor"),
            permittedActions: stringArrayField(authorityBody, "permitted_actions"),
            maxAmount: numberField(authorityBody, "max_amount"),
            currency: stringField(authorityBody, "currency"),
            expiresIn: stringField(authorityBody, "expires_in", "15m"),
            revocable: boolField(authorityBody, "revocable", true),
            revoked: boolField(authorityBody, "revoked", false)
        },
        commitGate: {
            id: gateMatch[1] ?? "unnamed-gate",
            action: stringField(gateBody, "action"),
            requireAuthority: stringField(gateBody, "require_authority"),
            requireWarrant: boolField(gateBody, "require_warrant", true),
            autonomousLimit: numberField(gateBody, "autonomous_limit"),
            deferAboveOrEqual: deferAboveOrEqual ? Number(deferAboveOrEqual) : undefined,
            denyAbove: denyAbove ? Number(denyAbove) : undefined,
            denyActions,
            evidence: stringArrayField(gateBody, "evidence")
        },
        warrantPolicy: {
            id: warrantMatch[1] ?? "unnamed-warrant-policy",
            standingPower: boolField(warrantBody, "standing_power", false),
            issueOn: stringField(warrantBody, "issue_on", "admissible_commit"),
            expiresIn: stringField(warrantBody, "expires_in", "60s"),
            singleUse: boolField(warrantBody, "single_use", true)
        },
        gel: {
            hashChain: boolField(gelBody, "hash_chain", true),
            signRecords: boolField(gelBody, "sign_records", true),
            includeReplayMaterial: boolField(gelBody, "include_replay_material", true)
        }
    };
    return policy;
}
export function validateGovernanceSource(source) {
    const errors = [];
    let policy;
    try {
        policy = parseGovernanceSource(source);
    }
    catch (error) {
        errors.push({ path: "governance.aristotle", message: error instanceof Error ? error.message : String(error) });
    }
    if (policy) {
        if (!policy.ward.sovereign)
            errors.push({ path: `ward.${policy.ward.id}.sovereign`, message: "ward sovereign is required" });
        if (policy.authority.ward !== policy.ward.id)
            errors.push({ path: `authority_envelope.${policy.authority.id}.ward`, message: "authority envelope must bind to an existing ward" });
        if (policy.commitGate.requireAuthority !== policy.authority.id)
            errors.push({ path: `commit_gate.${policy.commitGate.id}.require_authority`, message: "commit gate must reference an existing authority envelope" });
        if (policy.commitGate.requireWarrant && policy.warrantPolicy.standingPower)
            errors.push({ path: `warrant_policy.${policy.warrantPolicy.id}.standing_power`, message: "warrant policy must not grant standing machine power" });
        if (!policy.gel.hashChain)
            errors.push({ path: "gel.hash_chain", message: "GEL hash_chain must remain enabled for replayable evidence" });
    }
    return { ok: errors.length === 0, errors, policy };
}
const addStep = (steps, id, label, status, detail) => {
    steps.push({ id, label, status, detail });
};
const plusSeconds = (iso, seconds) => new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
const secondsFromDuration = (duration) => Number(duration.match(/([0-9]+)\s*s/)?.[1] ?? 60);
export function evaluateTrialAction(input) {
    const policy = input.policy ?? parseGovernanceSource(input.source ?? PAYMENTS_GOVERNANCE_SOURCE);
    const intent = { ...input.intent, occurredAt: input.intent.occurredAt ?? input.now ?? new Date().toISOString() };
    const now = input.now ?? intent.occurredAt ?? new Date().toISOString();
    const actionHash = stableHash(intent);
    const authorityHash = stableHash(policy.authority);
    const steps = [];
    let decision = "PERMIT";
    let decisionCode = "PERMIT_AUTONOMOUS";
    let controllingRule = "commit_gate.require_warrant";
    let explanation = "The action is within the authority envelope and a single-use warrant can be issued before execution.";
    addStep(steps, "intent", "Intent received", "passed", `${intent.agentId} requested ${intent.requestedAction}`);
    addStep(steps, "ward", "Ward context resolved", "passed", `${policy.ward.id} under ${policy.ward.sovereign}`);
    if (policy.authority.revoked) {
        decision = "FAIL_CLOSED";
        decisionCode = "AUTHORITY_REVOKED";
        controllingRule = `authority_envelope.${policy.authority.id}.revoked`;
        explanation = "The authority envelope is revoked, so AristotleOS fails closed before warrant issuance.";
        addStep(steps, "authority", "Authority Envelope resolved", "blocked", "Authority is revoked");
    }
    else if (policy.commitGate.requireAuthority !== policy.authority.id || policy.authority.ward !== policy.ward.id) {
        decision = "FAIL_CLOSED";
        decisionCode = "MISSING_AUTHORITY_BINDING";
        controllingRule = `commit_gate.${policy.commitGate.id}.require_authority`;
        explanation = "The Commit Gate cannot prove the required authority binding, so execution fails closed.";
        addStep(steps, "authority", "Authority Envelope resolved", "blocked", "Required authority binding is missing");
    }
    else {
        addStep(steps, "authority", "Authority Envelope resolved", "passed", `${policy.authority.id} binds ${policy.authority.actor}`);
    }
    addStep(steps, "compile", "Policy compiled", decision === "FAIL_CLOSED" ? "blocked" : "passed", `policy_hash=${policy.policyHash}`);
    const amount = typeof intent.parameters.amount === "number" ? intent.parameters.amount : undefined;
    if (decision !== "FAIL_CLOSED") {
        if (policy.commitGate.denyActions.includes(intent.requestedAction)) {
            decision = "DENY";
            decisionCode = "ACTION_DENIED_BY_GATE";
            controllingRule = `commit_gate.${policy.commitGate.id}.deny_action`;
            explanation = `${intent.requestedAction} is explicitly denied by the Commit Gate. No warrant is issued.`;
        }
        else if (!policy.authority.permittedActions.includes(intent.requestedAction)) {
            decision = "DENY";
            decisionCode = "ACTION_OUTSIDE_AUTHORITY";
            controllingRule = `authority_envelope.${policy.authority.id}.permitted_actions`;
            explanation = `${intent.requestedAction} is outside the authority envelope. AristotleOS denies before execution.`;
        }
        else if (amount !== undefined && policy.authority.maxAmount !== undefined && amount > policy.authority.maxAmount) {
            decision = "DENY";
            decisionCode = "AMOUNT_EXCEEDS_AUTHORITY";
            controllingRule = `authority_envelope.${policy.authority.id}.max_amount`;
            explanation = `The requested amount ${amount} exceeds the authority envelope maximum ${policy.authority.maxAmount}.`;
        }
        else if (amount !== undefined && policy.commitGate.denyAbove !== undefined && amount > policy.commitGate.denyAbove) {
            decision = "DENY";
            decisionCode = "AMOUNT_DENIED_BY_GATE";
            controllingRule = `commit_gate.${policy.commitGate.id}.deny_if`;
            explanation = `The requested amount ${amount} crosses the Commit Gate deny threshold ${policy.commitGate.denyAbove}.`;
        }
        else if (input.approval === "deny") {
            decision = "DENY";
            decisionCode = "OPERATOR_DENIED";
            controllingRule = "operator_decision.deny";
            explanation = "The action was deferred and the operator denied it. No warrant is issued.";
        }
        else if (amount !== undefined && policy.commitGate.deferAboveOrEqual !== undefined && amount >= policy.commitGate.deferAboveOrEqual && input.approval !== "approve" && input.approval !== "reduced_authority") {
            decision = "DEFER";
            decisionCode = "OPERATOR_APPROVAL_REQUIRED";
            controllingRule = `commit_gate.${policy.commitGate.id}.defer_if`;
            explanation = `The amount ${amount} is above the autonomous limit. AristotleOS defers before execution and preserves evidence.`;
        }
        else if (input.approval === "reduced_authority") {
            decision = "PERMIT";
            decisionCode = "PERMIT_REDUCED_ONE_TIME_AUTHORITY";
            controllingRule = "operator_decision.reduced_authority";
            explanation = "The operator approved a reduced one-time authority path, so a single-use warrant is issued for this action only.";
        }
        else if (input.approval === "approve") {
            decision = "PERMIT";
            decisionCode = "PERMIT_OPERATOR_APPROVED";
            controllingRule = "operator_decision.approve";
            explanation = "The deferred action was approved by an operator, so AristotleOS issues a single-use warrant before execution.";
        }
    }
    addStep(steps, "commit-gate", "Commit Gate evaluated", decision === "PERMIT" ? "passed" : decision === "DEFER" ? "deferred" : "blocked", decisionCode);
    const warrant = decision === "PERMIT"
        ? {
            id: `wrn-${stableHash({ actionHash, policy: policy.policyHash, now }).slice(4)}`,
            wardId: policy.ward.id,
            actionHash,
            authorityHash,
            policyHash: policy.policyHash,
            issuedAt: now,
            expiresAt: plusSeconds(now, secondsFromDuration(policy.warrantPolicy.expiresIn)),
            singleUse: policy.warrantPolicy.singleUse,
            signature: `trial-signature-${stableHash({ actionHash, authorityHash, policyHash: policy.policyHash })}`
        }
        : undefined;
    addStep(steps, "warrant", "Warrant requested", warrant ? "passed" : decision === "DEFER" ? "deferred" : "blocked", warrant ? warrant.id : "No execution warrant issued");
    addStep(steps, "witness", "Witness checked", decision === "FAIL_CLOSED" ? "blocked" : "passed", "trial-witness-1, trial-witness-2");
    addStep(steps, "decision", "Decision issued", decision === "PERMIT" ? "passed" : decision === "DEFER" ? "deferred" : "blocked", decision);
    const recordMaterial = { actionHash, authorityHash, decision, policyHash: policy.policyHash, warrantId: warrant?.id, previousHash: input.previousHash ?? "GENESIS" };
    const gelRecord = {
        recordId: `gel-${stableHash(recordMaterial).slice(4)}`,
        previousHash: input.previousHash ?? "GENESIS",
        currentHash: stableHash(recordMaterial),
        actionHash,
        policyHash: policy.policyHash,
        authorityHash,
        decision,
        timestamp: now,
        witnessSet: ["trial-witness-1", "trial-witness-2"],
        replayable: policy.gel.includeReplayMaterial
    };
    addStep(steps, "gel", "GEL record committed", "passed", `${gelRecord.recordId} ${gelRecord.currentHash}`);
    return {
        decision,
        decisionCode,
        explanation,
        controllingRule,
        pipeline: steps,
        warrant,
        gelRecord,
        deferToken: decision === "DEFER" ? `def-${stableHash({ actionHash, policyHash: policy.policyHash }).slice(4)}` : undefined,
        replay: {
            stable: true,
            policyHash: policy.policyHash,
            actionHash,
            materialHash: stableHash({ policy, intent, decisionCode })
        }
    };
}
export function planGovernanceChange(source, currentSource = PAYMENTS_GOVERNANCE_SOURCE) {
    const next = validateGovernanceSource(source);
    const current = validateGovernanceSource(currentSource);
    if (!next.policy)
        return { ok: false, errors: next.errors, changes: [], nextPolicyHash: undefined };
    const changes = [];
    if (current.policy?.policyHash !== next.policy.policyHash)
        changes.push(`policy hash changes ${current.policy?.policyHash ?? "none"} -> ${next.policy.policyHash}`);
    if (current.policy?.authority.maxAmount !== next.policy.authority.maxAmount)
        changes.push(`authority max_amount changes ${current.policy?.authority.maxAmount ?? "none"} -> ${next.policy.authority.maxAmount ?? "none"}`);
    if (current.policy?.commitGate.deferAboveOrEqual !== next.policy.commitGate.deferAboveOrEqual)
        changes.push(`defer threshold changes ${current.policy?.commitGate.deferAboveOrEqual ?? "none"} -> ${next.policy.commitGate.deferAboveOrEqual ?? "none"}`);
    if (current.policy?.authority.revoked !== next.policy.authority.revoked)
        changes.push(`revocation changes ${current.policy?.authority.revoked ?? false} -> ${next.policy.authority.revoked ?? false}`);
    return { ok: next.ok, errors: next.errors, changes, nextPolicyHash: next.policy.policyHash };
}
