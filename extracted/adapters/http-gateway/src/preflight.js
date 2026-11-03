const isTruthy = (value) => value === "1" || value === "true" || value === "TRUE";
export const runGatewayPreflight = () => {
    const mode = process.env.NODE_ENV === "production" ? "production" : "development";
    const checks = [];
    const operatorApiKey = process.env.OPERATOR_API_KEY?.trim();
    const operatorSessionEnforcement = isTruthy(process.env.OPERATOR_SESSION_ENFORCEMENT);
    const operatorSessionSecret = process.env.OPERATOR_SESSION_SECRET?.trim();
    const serviceDiscoveryMode = process.env.SERVICE_DISCOVERY_MODE ?? "container";
    const evidenceLedgerStatePath = process.env.EVIDENCE_LEDGER_STATE_PATH?.trim();
    const agentOsStatePath = process.env.AGENT_OS_STATE_PATH?.trim();
    const allowInsecureProduction = isTruthy(process.env.ALLOW_INSECURE_PRODUCTION_BOOT);
    checks.push({
        name: "operator-api-key",
        status: operatorApiKey ? "pass" : mode === "production" ? "fail" : "warn",
        detail: operatorApiKey
            ? "Operator API key configured."
            : mode === "production"
                ? "Production boot requires OPERATOR_API_KEY."
                : "Operator API key is optional in development."
    });
    checks.push({
        name: "operator-session-secret",
        status: operatorSessionEnforcement && !operatorSessionSecret
            ? mode === "production"
                ? "fail"
                : "warn"
            : operatorSessionEnforcement
                ? "pass"
                : "pass",
        detail: operatorSessionEnforcement
            ? operatorSessionSecret
                ? "Signed operator session secret configured."
                : mode === "production"
                    ? "Production session enforcement requires OPERATOR_SESSION_SECRET."
                    : "Session enforcement enabled without OPERATOR_SESSION_SECRET."
            : "Signed operator sessions are optional and currently disabled."
    });
    checks.push({
        name: "service-discovery-mode",
        status: mode === "production" && serviceDiscoveryMode === "local" ? "fail" : "pass",
        detail: mode === "production" && serviceDiscoveryMode === "local"
            ? "Production boot cannot use local service discovery."
            : `Service discovery mode is ${serviceDiscoveryMode}.`
    });
    checks.push({
        name: "durable-state-paths",
        status: evidenceLedgerStatePath && agentOsStatePath ? "pass" : mode === "production" ? "fail" : "warn",
        detail: evidenceLedgerStatePath && agentOsStatePath
            ? "Durable state paths configured."
            : mode === "production"
                ? "Production boot requires EVIDENCE_LEDGER_STATE_PATH and AGENT_OS_STATE_PATH."
                : "State paths default to local development locations."
    });
    if (mode === "production") {
        const required = [
            ["governance-enforcement", isTruthy(process.env.GOVERNANCE_CHAIN_V2) && process.env.GOVERNANCE_CHAIN_MODE === "enforce", "Production requires GOVERNANCE_CHAIN_V2=true and GOVERNANCE_CHAIN_MODE=enforce."],
            ["chain-durability-signing", Boolean(process.env.GOVERNANCE_CHAIN_STATE_PATH?.trim()) && Boolean(process.env.GOVERNANCE_CHAIN_SIGNING_SECRET?.trim() || (process.env.GOVERNANCE_CHAIN_SIGNING_PRIVATE_KEY_PATH?.trim() && process.env.GOVERNANCE_CHAIN_SIGNING_PUBLIC_KEY_PATH?.trim())), "Production requires durable chain state and signing material."],
            ["ledger-signing", Boolean(process.env.EVIDENCE_LEDGER_SIGNING_SECRET?.trim() || (process.env.EVIDENCE_LEDGER_SIGNING_PRIVATE_KEY_PATH?.trim() && process.env.EVIDENCE_LEDGER_SIGNING_PUBLIC_KEY_PATH?.trim())), "Production requires evidence signing material."],
            ["operator-role-enforcement", isTruthy(process.env.OPERATOR_ROLE_ENFORCEMENT), "Production requires operator role enforcement."],
            ["operator-session-enforcement", operatorSessionEnforcement && Boolean(operatorSessionSecret), "Production requires signed operator sessions."],
            ["insecure-override", !allowInsecureProduction, "ALLOW_INSECURE_PRODUCTION_BOOT cannot bypass production readiness."]
        ];
        for (const [name, ok, detail] of required)
            checks.push({ name, status: ok ? "pass" : "fail", detail });
    }
    const failedChecks = checks.filter((check) => check.status === "fail");
    return {
        ok: failedChecks.length === 0,
        mode,
        checks
    };
};
