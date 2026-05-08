export const gatewayContract = {
    health: "/health",
    mesh: "/operator/mesh",
    ledger: "/operator/ledger",
    metaAuthority: "/operator/meta-authority",
    envelopes: "/operator/envelopes",
    compilePolicy: "/operator/policy/compile",
    govern: "/operator/govern",
    killSwitch: "/operator/kill-switch",
    replay: (traceId) => `/operator/replay/${traceId}`,
    counterfactual: "/operator/replay/counterfactual"
};
