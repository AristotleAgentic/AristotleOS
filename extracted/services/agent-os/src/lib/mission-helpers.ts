/**
 * Pure helpers shared between agent-os's index.ts and its
 * extracted route modules. Carved out in stage 12 of the
 * prototype-hardening pass.
 *
 * Why a separate file:
 *   - fingerprint() and createMissionSteps() are both pure
 *     (no module-level state dependency) and were duplicated
 *     across two import sites (index.ts + routes/missions.ts via
 *     the deps bag). Living them here means stage-10's deps-bag
 *     ergonomics shrink (createMissionSteps + fingerprint drop
 *     out) and future extracted route modules can import them
 *     directly without adding more bag entries.
 *   - Pure functions are the safest extraction target. Behavior
 *     is byte-identical to the prior inline definitions; the
 *     stage-1 + stage-9 + stage-11 tests pin every observable
 *     consequence of these helpers (mission.steps shape,
 *     workspace.deviceFingerprint default, agent.identityFingerprint
 *     default), so any regression surfaces.
 */

import type { MissionStep } from "@aristotle/shared-types";

/**
 * Deterministic short identifier derived from a namespace + seed.
 * Used to default agent identityFingerprint and workspace
 * deviceFingerprint when the caller doesn't supply one.
 *
 * Output: '<namespace>-<seed-slugified>' (lowercased, non-alnum
 * collapsed to single dashes, leading/trailing dashes trimmed,
 * 'unknown' when the slug is empty).
 *
 * Examples:
 *   fingerprint('agentfp',  'agent-Planner')   -> 'agentfp-agent-planner'
 *   fingerprint('devicefp', 'WS  Alpha!')      -> 'devicefp-ws-alpha'
 *   fingerprint('devicefp', '!!!')             -> 'devicefp-unknown'
 */
export const fingerprint = (namespace: string, seed: string): string =>
  `${namespace}-${seed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown"}`;

/**
 * Build the default MissionStep[] auto-attached to every newly-
 * created mission. Steps capture the supervised-build governance
 * profile lifecycle:
 *   1. frame + governance posture (planner)
 *   2. workspace + agent attach (executor)
 *   3. tool leasing + boundary verification (auditor)
 *   4. execution loop + evidence recording (executor)
 *
 * The first step is pre-marked 'completed' and the second
 * 'in_progress' so freshly-created missions surface a non-empty
 * progress bar in the operator UI. The audit + execute steps stay
 * 'pending' until the autonomy/dispatch loop advances them.
 *
 * Takes `id` as the first parameter (rather than reaching into a
 * module-level binding) so the helper is pure and testable in
 * isolation. Callers in agent-os pass the `id` exported from lib.js.
 */
export const createMissionSteps = (
  id: (prefix: string) => string,
  requiredTools: string[]
): MissionStep[] => [
  {
    id: id("step"),
    title: "Frame mission and allocate governance posture",
    status: "completed",
    ownerRole: "planner",
    requiredTools: [],
    completionSignal: "mission brief accepted"
  },
  {
    id: id("step"),
    title: "Prepare workspace and attach execution agents",
    status: "in_progress",
    ownerRole: "executor",
    requiredTools: ["shell", "editor"],
    completionSignal: "workspace sealed with initial context"
  },
  {
    id: id("step"),
    title: "Lease tools and verify runtime boundaries",
    status: "pending",
    ownerRole: "auditor",
    requiredTools,
    completionSignal: "tool leases satisfy governance profile"
  },
  {
    id: id("step"),
    title: "Execute mission loop and record evidence",
    status: "pending",
    ownerRole: "executor",
    requiredTools,
    completionSignal: "success metrics reached"
  }
];
