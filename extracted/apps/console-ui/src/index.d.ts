import type { ComponentType } from "react";

export declare const AristotleAutonomousGovernanceConsole: ComponentType<{
    gatewayBaseUrl?: string;
    autoRefreshMs?: number;
}>;
export declare const gatewayContract: {
    health: string;
    mesh: string;
    ledger: string;
    metaAuthority: string;
    envelopes: string;
    osState: string;
    osMissions: string;
    registerAgent: string;
    createWorkspace: string;
    advanceMission: (missionId: string) => string;
    compilePolicy: string;
    govern: string;
    killSwitch: string;
    replay: (traceId: string) => string;
    counterfactual: string;
};
