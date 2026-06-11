/**
 * /agents route handlers for agent-os.
 *
 * Carved out of index.ts in stage 15 of the prototype-hardening
 * pass. Currently mounts:
 *
 *   POST /agents/register  — register or update an agent capability
 *                            (201 + agent)
 *
 * Behavior preserved EXACTLY. Stage 14
 * (services/agent-os/src/agents-workspaces.test.ts) pins:
 *   - 201 + documented defaults on a minimal body
 *   - all explicit fields round-trip verbatim
 *   - agent appears in /state.agents after insert
 *
 * Module contract mirrors mountMissionsRoutes from stage 10:
 * dep-injection via a typed bag, no import of index.ts, so the
 * module is unit-testable in isolation and free of circular deps.
 * Pure helpers (fingerprint) come in via direct lib import rather
 * than the deps bag — same division-of-labor as stage 13.
 */

import type { Express } from "express";
import type { AgentCapability } from "@aristotle/shared-types";
import { fingerprint } from "../lib/mission-helpers.js";

export type AgentsRouteDeps = {
  /** The in-memory agent registry the handler reads + mutates. */
  agents: Map<string, AgentCapability>;
  /** id('agent') generator for the default-id case. */
  id: (prefix: string) => string;
  /** ISO timestamp generator for lastHeartbeat. */
  now: () => string;
  /** Triggers the next persist tick (debounced fsync of state). */
  schedulePersist: () => Promise<void> | unknown;
};

export function mountAgentsRoutes(app: Express, deps: AgentsRouteDeps): void {
  const { agents, id, now, schedulePersist } = deps;

  app.post("/agents/register", async (req, res) => {
    const timestamp = now();
    const agent: AgentCapability = {
      id: req.body.id ?? id("agent"),
      name: req.body.name ?? "Unnamed Agent",
      role: req.body.role ?? "executor",
      status: req.body.status ?? "ready",
      model: req.body.model ?? "unknown",
      provider: req.body.provider ?? "unknown",
      specializations: req.body.specializations ?? [],
      toolchains: req.body.toolchains ?? [],
      trustTier: req.body.trustTier ?? "sandboxed",
      maxConcurrency: req.body.maxConcurrency ?? 1,
      workspaceAffinity: req.body.workspaceAffinity,
      deviceId: req.body.deviceId,
      identityFingerprint:
        req.body.identityFingerprint ?? fingerprint("agentfp", req.body.id ?? "agent"),
      verificationStatus: req.body.verificationStatus ?? "verified",
      lastHeartbeat: timestamp
    };
    agents.set(agent.id, agent);
    await schedulePersist();
    res.status(201).json(agent);
  });
}
