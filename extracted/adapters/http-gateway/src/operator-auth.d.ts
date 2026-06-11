/**
 * Operator-authentication + RBAC surface for the http-gateway.
 *
 * Carved out of index.ts in stage 6 of the prototype-hardening pass
 * — the inline implementation grew to ~225 lines and was tangled
 * with the rest of the gateway's route table. Behavior is preserved
 * exactly; the stage-2 RBAC tests
 * (adapters/http-gateway/src/index.test.ts) pin every fail-closed
 * path that this module is responsible for.
 *
 * Module contract:
 *
 *   loadOperatorAuthConfigFromEnv() — reads OPERATOR_* env vars
 *     once at startup and returns a frozen config snapshot.
 *
 *   createOperatorAuth(config) — returns a closure object holding:
 *     * pure helpers (readOperator*, isReadMethod) used by handlers
 *       elsewhere in the gateway for event attribution and method-
 *       based RBAC discrimination;
 *     * session-token codec (create/parse + validate) so the
 *       middleware and the session endpoint share one implementation;
 *     * sessionEndpoint — the POST /operator/auth/session handler;
 *     * middleware — the /operator path-prefixed gate.
 *
 *   The config object is exposed verbatim so the gateway's
 *   /preflight + /healthz handlers can surface its current state
 *   to operators without re-reading process.env.
 *
 * The wire contract that the stage-2 RBAC tests pin:
 *   - 401 operator_auth_required  when no credential is present
 *   - 401 operator_session_invalid when bearer token is malformed
 *   - 401 wrong x-operator-key on /auth/session
 *   - 200 + ost.<payload>.<sig> bearer token on a valid key
 *   - 503 operator_session_disabled when API key is set but the
 *     session-signing secret is empty (misconfig fail-closed)
 */
import type { Express, Request, RequestHandler } from "express";
export type OperatorSessionClaims = {
    actor: string;
    role: string;
    issuedAt: string;
    expiresAt: string;
    sessionId: string;
};
export type OperatorAuthConfig = {
    /** OPERATOR_API_KEY — when undefined, operator auth is "disabled"
     *  and /operator/* is open (suitable for local dev only). */
    apiKey: string | undefined;
    /** OPERATOR_SESSION_SECRET — HMAC key for signed bearer tokens.
     *  When unset while apiKey is set, /auth/session returns 503. */
    sessionSecret: string | undefined;
    /** OPERATOR_SESSION_ENFORCEMENT — when true, /operator/* requires
     *  a signed bearer session (raw API key is not accepted). */
    sessionEnforcement: boolean;
    sessionTtlMs: number;
    sessionSkewMs: number;
    roleEnforcement: boolean;
    defaultRole: string;
    readRoles: Set<string>;
    mutationRoles: Set<string>;
    readActors: Set<string>;
    mutationActors: Set<string>;
};
/**
 * Reads OPERATOR_* env vars and returns a config snapshot. Call once
 * at module init; the config is meant to be frozen across the
 * lifetime of the gateway process (matches the prior behavior where
 * these were module-level const bindings).
 */
export declare function loadOperatorAuthConfigFromEnv(): OperatorAuthConfig;
export type OperatorAuth = {
    /** The config snapshot the auth surface was constructed with.
     *  Exposed so /preflight + /healthz can surface it to operators. */
    config: OperatorAuthConfig;
    readOperatorCredential: (req: Request) => string | undefined;
    readOperatorSession: (req: Request) => string | undefined;
    readOperatorActor: (req: Request, fallback?: string) => string;
    readOperatorRole: (req: Request) => string;
    isReadMethod: (method: string) => boolean;
    createOperatorSessionToken: (claims: OperatorSessionClaims) => string;
    parseOperatorSessionToken: (token: string) => OperatorSessionClaims | null;
    validateSessionClaims: (claims: OperatorSessionClaims, req: Request) => {
        ok: true;
    } | {
        ok: false;
        error: string;
        message: string;
    };
    /** Handler for POST /operator/auth/session. Mount via
     *  `app.post("/operator/auth/session", auth.sessionEndpoint)`. */
    sessionEndpoint: RequestHandler;
    /** Path-prefixed middleware that gates /operator/* requests.
     *  Mount via `app.use("/operator", auth.middleware)` AFTER the
     *  sessionEndpoint is registered, so /auth/session can be reached
     *  without already having a session. */
    middleware: RequestHandler;
};
export declare function createOperatorAuth(config: OperatorAuthConfig): OperatorAuth;
/**
 * Convenience: load config from env + construct the auth surface in
 * one call. Most gateway code paths don't need to override the env-
 * derived config, so this keeps the import site terse.
 */
export declare function createOperatorAuthFromEnv(): OperatorAuth;
export type { Express };
