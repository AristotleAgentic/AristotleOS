/**
 * /missions route handlers for agent-os.
 *
 * Carved out of index.ts in stage 10 of the prototype-hardening
 * pass. Two handlers move here:
 *
 *   GET  /missions                — list all missions
 *   POST /missions                — create mission + workspace +
 *                                   tool leases + initial memory
 *                                   records (201)
 *
 * /missions/:missionId/advance is intentionally NOT in this module
 * yet — it pulls in ~12 more dependencies (progressExecutionLoop,
 * missionTasks, syncMissionDerivedState, executionReceipts,
 * findMissionWorkspace, …) and belongs in a follow-on stage where
 * those helpers can be extracted alongside.
 *
 * Behavior is preserved EXACTLY. The stage-1 tests
 * (services/agent-os/src/index.test.ts, 2 tests) + stage-9 tests
 * (services/agent-os/src/tasks-lifecycle.test.ts, 3 tests) pin the
 * /missions response shapes — same id-prefix on the mission +
 * workspace + leases, same { mission, workspace, leases } envelope
 * on POST, same { items: [...] } envelope on GET, same default
 * values for unsupplied fields (priority='high', riskLevel='medium',
 * status='planned', etc.). A regression in any of those surfaces
 * as a test failure.
 *
 * Module contract:
 *   mountMissionsRoutes(app, deps) attaches the two handlers to
 *   the supplied Express app. The deps bag holds the in-memory
 *   state Maps and helper functions the handlers need; this keeps
 *   the module dependency-injectable rather than coupling it to
 *   index.ts's module-level singletons. Future stages can
 *   substitute fakes for unit tests of the handlers in isolation,
 *   though the existing subprocess-based integration tests are
 *   already the strongest contract this module can carry.
 */

import type { Express } from "express";
import type {
  MemoryRecord,
  OperatingMission,
  ToolLease,
  WorkspaceSession
} from "@aristotle/shared-types";
import {
  createMissionSteps as buildMissionSteps,
  fingerprint
} from "../lib/mission-helpers.js";

export type MissionsRouteDeps = {
  /** The in-memory mission registry the handlers read + mutate. */
  missions: Map<string, OperatingMission>;
  /** The in-memory workspace registry — POST /missions creates a
   *  paired workspace and writes it here. */
  workspaces: Map<string, WorkspaceSession>;
  /** The in-memory tool-lease registry — POST /missions issues
   *  per-mission tool leases for each requiredTool (plus policy +
   *  ledger leases by default). */
  toolLeases: Map<string, ToolLease>;
  /** id('mission'), id('ws'), id('lease'), id('mem') generators. */
  id: (prefix: string) => string;
  /** ISO timestamp generator. */
  now: () => string;
  /** Returns (and lazily creates) the per-mission memory array. */
  ensureMissionMemory: (missionId: string) => MemoryRecord[];
  /** Triggers the next persist tick (debounced fsync of state). */
  schedulePersist: () => Promise<void> | unknown;
};

export function mountMissionsRoutes(app: Express, deps: MissionsRouteDeps): void {
  const {
    missions,
    workspaces,
    toolLeases,
    id,
    now,
    ensureMissionMemory,
    schedulePersist
  } = deps;

  app.get("/missions", (_req, res) => res.json({ items: [...missions.values()] }));

  app.post("/missions", async (req, res) => {
    const timestamp = now();
    const missionId = req.body.id ?? id("mission");
    const assignedAgents: string[] =
      req.body.assignedAgents ?? ["agent-planner", "agent-executor", "agent-auditor"];
    const requiredTools: string[] = req.body.requiredTools ?? ["shell", "editor", "ledger"];
    const leasedToolIds = [...new Set([...requiredTools, "policy", "ledger"])];
    const workspaceId = req.body.workspaceId ?? id("ws");
    const mission: OperatingMission = {
      id: missionId,
      title: req.body.title ?? "Untitled Mission",
      objective: req.body.objective ?? "No objective supplied",
      status: req.body.status ?? "planned",
      priority: req.body.priority ?? "high",
      riskLevel: req.body.riskLevel ?? "medium",
      requestedBy: req.body.requestedBy ?? "operator",
      targetSystem: req.body.targetSystem ?? "workspace",
      governanceProfile: req.body.governanceProfile ?? "supervised-build",
      assignedAgents,
      workspaceId,
      requiredAuthorities: req.body.requiredAuthorities ?? ["mission.command"],
      requiredTools,
      successMetrics:
        req.body.successMetrics ?? ["mission completes without governance violations"],
      steps: buildMissionSteps(id, requiredTools),
      createdAt: timestamp,
      updatedAt: timestamp
    };

    const workspace: WorkspaceSession = {
      id: workspaceId,
      missionId,
      state: "active",
      cwd: req.body.cwd ?? "/workspace",
      branchName:
        req.body.branchName ??
        `codex/${
          mission.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") || missionId
        }`,
      memoryNamespace: `mission.${missionId}`,
      attachedAgents: assignedAgents,
      deviceFingerprint: req.body.deviceFingerprint ?? fingerprint("devicefp", workspaceId),
      verificationStatus: req.body.verificationStatus ?? "verified",
      createdAt: timestamp,
      lastActiveAt: timestamp
    };

    const leases = leasedToolIds.map((toolId, index) => {
      const lease: ToolLease = {
        id: id("lease"),
        toolId,
        missionId,
        agentId: assignedAgents[Math.min(index, assignedAgents.length - 1)] ?? "agent-executor",
        state: "leased",
        scope: req.body.targetSystem ?? "workspace",
        grantedAt: timestamp,
        expiresAt: req.body.expiresAt,
        constraints:
          req.body.toolConstraints?.[toolId] ??
          ["operator approval required for destructive actions"]
      };
      toolLeases.set(lease.id, lease);
      return lease;
    });

    const missionMemory = ensureMissionMemory(missionId);
    missionMemory.push(
      {
        id: id("mem"),
        missionId,
        kind: "objective",
        summary: mission.objective,
        tags: ["objective", mission.priority, mission.riskLevel],
        createdAt: timestamp,
        author: mission.requestedBy
      },
      {
        id: id("mem"),
        missionId,
        kind: "decision",
        summary: `Mission scheduled with governance profile ${mission.governanceProfile}.`,
        tags: ["governance", "mission"],
        createdAt: timestamp,
        author: "agent-os"
      }
    );

    missions.set(mission.id, mission);
    workspaces.set(workspace.id, workspace);
    await schedulePersist();

    res.status(201).json({ mission, workspace, leases });
  });
}
