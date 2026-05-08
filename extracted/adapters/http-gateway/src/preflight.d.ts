export interface GatewayPreflightResult {
    ok: boolean;
    mode: "development" | "production";
    checks: Array<{
        name: string;
        status: "pass" | "warn" | "fail";
        detail: string;
    }>;
}
export declare const runGatewayPreflight: () => GatewayPreflightResult;
