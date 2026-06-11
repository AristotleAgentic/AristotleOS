/**
 * /workspaces route handlers for agent-os.
 *
 * Carved out of index.ts in stage 15 of the prototype-hardening
 * pass. Currently mounts:
 *
 *   POST /workspaces  — create a workspace session (201 + workspace)
 *
 * Behavior preserved EXACTLY. Stage 14
 * (services/agent-os/src/agents-workspaces.test.ts) pins:
 *   - 201 + documented defaults on a minimal body
 *     (state='prepared', missionId='unassigned',
 *      branchName='codex/<missionId>' with missionId fallback)
 *   - all explicit fields round-trip verbatim
 *   - workspace appears in /state.workspaces after insert
 *
 * Mounting + deps follow the same pattern as routes/missions.ts
 * (stage 10) and routes/agents.ts (this stage). Pure helpers
 * (fingerprint) come in via direct lib import.
 */

import type { Express } from "express";
import type { WorkspaceSession } from "@aristotle/shared-types";
import { fingerprint } from "../lib/mission-helpers.js";

export type WorkspacesRouteDeps = {
  /** The in-memory workspace registry the handler reads + mutates. */
  workspaces: Map<string, WorkspaceSession>;
  /** id('ws') generator for the default-id case. */
  id: (prefix: string) => string;
  /** ISO timestamp generator for createdAt / lastActiveAt. */
  now: () => string;
  /** Triggers the next persist tick (debounced fsync of state). */
  schedulePersist: () => Promise<void> | unknown;
};

export function mountWorkspacesRoutes(app: Express, deps: WorkspacesRouteDeps): void {
  const { workspaces, id, now, schedulePersist } = deps;

  app.post("/workspaces", async (req, res) => {
    const timestamp = now();
    const workspace: WorkspaceSession = {
      id: req.body.id ?? id("ws"),
      missionId: req.body.missionId ?? "unassigned",
      state: req.body.state ?? "prepared",
      cwd: req.body.cwd ?? "/workspace",
      branchName: req.body.branchName ?? `codex/${req.body.missionId ?? "mission"}`,
      memoryNamespace:
        req.body.memoryNamespace ?? `mission.${req.body.missionId ?? "shared"}`,
      attachedAgents: req.body.attachedAgents ?? [],
      deviceFingerprint:
        req.body.deviceFingerprint ?? fingerprint("devicefp", req.body.id ?? "workspace"),
      verificationStatus: req.body.verificationStatus ?? "verified",
      createdAt: timestamp,
      lastActiveAt: timestamp
    };
    workspaces.set(workspace.id, workspace);
    await schedulePersist();
    res.status(201).json(workspace);
  });
}
