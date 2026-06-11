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
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
const readBooleanEnv = (raw) => raw === "1" || raw === "true" || raw === "TRUE";
const readSetEnv = (raw, fallback) => new Set((raw ?? fallback)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean));
/**
 * Reads OPERATOR_* env vars and returns a config snapshot. Call once
 * at module init; the config is meant to be frozen across the
 * lifetime of the gateway process (matches the prior behavior where
 * these were module-level const bindings).
 */
export function loadOperatorAuthConfigFromEnv() {
    return {
        apiKey: process.env.OPERATOR_API_KEY?.trim(),
        sessionSecret: process.env.OPERATOR_SESSION_SECRET?.trim(),
        sessionEnforcement: readBooleanEnv(process.env.OPERATOR_SESSION_ENFORCEMENT),
        sessionTtlMs: Number(process.env.OPERATOR_SESSION_TTL_MS ?? 15 * 60 * 1000),
        sessionSkewMs: Number(process.env.OPERATOR_SESSION_SKEW_MS ?? 60 * 1000),
        roleEnforcement: readBooleanEnv(process.env.OPERATOR_ROLE_ENFORCEMENT),
        defaultRole: process.env.OPERATOR_DEFAULT_ROLE?.trim() || "operator",
        readRoles: readSetEnv(process.env.OPERATOR_READ_ROLES, "viewer,operator,admin"),
        mutationRoles: readSetEnv(process.env.OPERATOR_MUTATION_ROLES, "operator,admin"),
        readActors: readSetEnv(process.env.OPERATOR_READ_ACTORS, ""),
        mutationActors: readSetEnv(process.env.OPERATOR_MUTATION_ACTORS, "")
    };
}
export function createOperatorAuth(config) {
    const { apiKey, sessionSecret, sessionEnforcement, sessionTtlMs, sessionSkewMs, roleEnforcement, defaultRole, readRoles, mutationRoles, readActors, mutationActors } = config;
    const encodeSessionPayload = (claims) => Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
    const signSessionPayload = (payload) => {
        if (!sessionSecret) {
            throw new Error("Operator session secret is not configured.");
        }
        return createHmac("sha256", sessionSecret).update(payload).digest("base64url");
    };
    const createOperatorSessionToken = (claims) => {
        const payload = encodeSessionPayload(claims);
        const signature = signSessionPayload(payload);
        return `ost.${payload}.${signature}`;
    };
    const parseOperatorSessionToken = (token) => {
        if (!sessionSecret || !token.startsWith("ost.")) {
            return null;
        }
        const [, payload, signature] = token.split(".");
        if (!payload || !signature) {
            return null;
        }
        const expected = Buffer.from(signSessionPayload(payload), "utf8");
        const actual = Buffer.from(signature, "utf8");
        if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
            return null;
        }
        try {
            const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
            return claims;
        }
        catch {
            return null;
        }
    };
    const readOperatorCredential = (req) => {
        const keyHeader = req.header("x-operator-key")?.trim();
        if (keyHeader)
            return keyHeader;
        const authorization = req.header("authorization")?.trim();
        if (authorization?.toLowerCase().startsWith("bearer ")) {
            return authorization.slice(7).trim();
        }
        return undefined;
    };
    const readOperatorSession = (req) => {
        const authorization = req.header("authorization")?.trim();
        if (!authorization?.toLowerCase().startsWith("bearer ")) {
            return undefined;
        }
        const token = authorization.slice(7).trim();
        return token.startsWith("ost.") ? token : undefined;
    };
    const readOperatorActor = (req, fallback = "http-gateway") => {
        const actorHeader = req.header("x-operator-actor")?.trim();
        if (actorHeader)
            return actorHeader;
        const bodyActor = typeof req.body?.actor === "string" ? req.body.actor.trim() : "";
        return bodyActor || fallback;
    };
    const readOperatorRole = (req) => req.header("x-operator-role")?.trim() || defaultRole;
    const isReadMethod = (method) => method === "GET" || method === "HEAD";
    const validateSessionClaims = (claims, req) => {
        const issuedAt = Date.parse(claims.issuedAt);
        const expiresAt = Date.parse(claims.expiresAt);
        const now = Date.now();
        if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) {
            return { ok: false, error: "operator_session_invalid", message: "Operator session timestamps are invalid." };
        }
        if (issuedAt - sessionSkewMs > now) {
            return { ok: false, error: "operator_session_not_yet_valid", message: "Operator session is not yet valid." };
        }
        if (expiresAt + sessionSkewMs < now) {
            return { ok: false, error: "operator_session_expired", message: "Operator session has expired." };
        }
        const actor = readOperatorActor(req).trim();
        if (actor && actor !== claims.actor) {
            return { ok: false, error: "operator_session_actor_mismatch", message: "Operator actor does not match session claims." };
        }
        const role = readOperatorRole(req);
        if (role && role !== claims.role) {
            return { ok: false, error: "operator_session_role_mismatch", message: "Operator role does not match session claims." };
        }
        return { ok: true };
    };
    const sessionEndpoint = (req, res) => {
        if (!apiKey) {
            res.status(503).json({ error: "operator_auth_disabled", message: "Operator authentication is not configured." });
            return;
        }
        if (!sessionSecret) {
            res.status(503).json({ error: "operator_session_disabled", message: "Operator session signing is not configured." });
            return;
        }
        const credential = readOperatorCredential(req);
        if (credential !== apiKey) {
            res.status(401).json({ error: "operator_auth_required", message: "Valid operator credential required." });
            return;
        }
        const actor = readOperatorActor(req).trim();
        const role = readOperatorRole(req);
        const allowedActors = isReadMethod(req.method) ? readActors : mutationActors;
        if (allowedActors.size > 0 && !allowedActors.has(actor)) {
            res.status(403).json({
                error: "operator_actor_forbidden",
                message: `Operator actor '${actor}' is not permitted for ${req.method} ${req.path}.`
            });
            return;
        }
        const allowedRoles = isReadMethod(req.method) ? readRoles : mutationRoles;
        if (roleEnforcement && !allowedRoles.has(role)) {
            res.status(403).json({
                error: "operator_role_forbidden",
                message: `Operator role '${role}' is not permitted for ${req.method} ${req.path}.`
            });
            return;
        }
        const issuedAt = new Date();
        const expiresAt = new Date(issuedAt.getTime() + sessionTtlMs);
        const claims = {
            actor,
            role,
            issuedAt: issuedAt.toISOString(),
            expiresAt: expiresAt.toISOString(),
            sessionId: randomUUID()
        };
        res.json({
            token: createOperatorSessionToken(claims),
            tokenType: "Bearer",
            actor,
            role,
            issuedAt: claims.issuedAt,
            expiresAt: claims.expiresAt,
            sessionId: claims.sessionId
        });
    };
    const middleware = (req, res, next) => {
        if (!apiKey) {
            next();
            return;
        }
        const sessionToken = readOperatorSession(req);
        if (sessionToken) {
            const claims = parseOperatorSessionToken(sessionToken);
            if (!claims) {
                res.status(401).json({ error: "operator_session_invalid", message: "Valid operator session required." });
                return;
            }
            const validity = validateSessionClaims(claims, req);
            if (!validity.ok) {
                res.status(401).json({ error: validity.error, message: validity.message });
                return;
            }
            const allowedActors = isReadMethod(req.method) ? readActors : mutationActors;
            if (allowedActors.size > 0 && !allowedActors.has(claims.actor)) {
                res.status(403).json({
                    error: "operator_actor_forbidden",
                    message: `Operator actor '${claims.actor}' is not permitted for ${req.method} ${req.path}.`
                });
                return;
            }
            if (roleEnforcement) {
                const allowedRoles = isReadMethod(req.method) ? readRoles : mutationRoles;
                if (!allowedRoles.has(claims.role)) {
                    res.status(403).json({
                        error: "operator_role_forbidden",
                        message: `Operator role '${claims.role}' is not permitted for ${req.method} ${req.path}.`
                    });
                    return;
                }
            }
            next();
            return;
        }
        if (sessionEnforcement && req.path !== "/auth/session") {
            res.status(401).json({ error: "operator_session_required", message: "Signed operator session required." });
            return;
        }
        const credential = readOperatorCredential(req);
        if (credential === apiKey) {
            const actor = readOperatorActor(req).trim();
            const allowedActors = isReadMethod(req.method) ? readActors : mutationActors;
            if (allowedActors.size > 0 && !allowedActors.has(actor)) {
                res.status(403).json({
                    error: "operator_actor_forbidden",
                    message: `Operator actor '${actor}' is not permitted for ${req.method} ${req.path}.`
                });
                return;
            }
            if (!roleEnforcement) {
                next();
                return;
            }
            const role = readOperatorRole(req);
            const allowedRoles = isReadMethod(req.method) ? readRoles : mutationRoles;
            if (allowedRoles.has(role)) {
                next();
                return;
            }
            res.status(403).json({
                error: "operator_role_forbidden",
                message: `Operator role '${role}' is not permitted for ${req.method} ${req.path}.`
            });
            return;
        }
        res.status(401).json({ error: "operator_auth_required", message: "Valid operator credential required." });
    };
    return {
        config,
        readOperatorCredential,
        readOperatorSession,
        readOperatorActor,
        readOperatorRole,
        isReadMethod,
        createOperatorSessionToken,
        parseOperatorSessionToken,
        validateSessionClaims,
        sessionEndpoint,
        middleware
    };
}
/**
 * Convenience: load config from env + construct the auth surface in
 * one call. Most gateway code paths don't need to override the env-
 * derived config, so this keeps the import site terse.
 */
export function createOperatorAuthFromEnv() {
    return createOperatorAuth(loadOperatorAuthConfigFromEnv());
}
