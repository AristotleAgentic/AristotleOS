/**
 * Read-side /tasks/* route handlers for agent-os.
 *
 * Carved out of index.ts in stage 20 of the prototype-hardening
 * pass. ONLY the read-side handlers are extracted here — the
 * mutating ones (claim/heartbeat/complete/retry/actions POST) pull
 * in 10+ dependencies each and belong in their own focused stages
 * as those deps get factored out.
 *
 * Routes mounted:
 *   GET /tasks/next                — surface the next eligible task
 *                                    (404 task_not_found on empty)
 *   GET /tasks/:taskId/actions     — list tool actions for a task
 *                                    (404 task_not_found on unknown)
 *
 * Both routes' 404 envelopes are pinned by stage 7
 * (services/agent-os/src/tasks.test.ts), so any drift surfaces
 * immediately.
 *
 * Module contract follows the standard deps-bag pattern
 * established in stage 6 / 10 / 15 / 17 / 18 / 19.
 */

import type { Express } from "express";
import type { ExecutionTask, ToolAction } from "@aristotle/shared-types";

export type TasksReadRouteDeps = {
  /** The in-memory execution-task registry the handlers read. */
  executionTasks: Map<string, ExecutionTask>;
  /** Index-side selection helper that walks the queue and returns
   *  the highest-priority eligible task (or undefined). Owned by
   *  index.ts because it depends on missions + workspaces + the
   *  selection-context cache; we pass it in rather than reimplement. */
  selectNextQueuedTask: (
    requestedAgentId?: string
  ) => { task: ExecutionTask } | undefined;
  /** Index-side list helper: tool actions for a given taskId.
   *  Owned by index.ts because it filters the toolActions Map
   *  that other handlers also touch. */
  taskToolActions: (taskId: string) => ToolAction[];
};

export function mountTasksReadRoutes(app: Express, deps: TasksReadRouteDeps): void {
  const { executionTasks, selectNextQueuedTask, taskToolActions } = deps;

  app.get("/tasks/next", (req, res) => {
    const agentId = typeof req.query.agentId === "string" ? req.query.agentId : undefined;
    const task = selectNextQueuedTask(agentId)?.task;
    if (!task) return res.status(404).json({ error: "task_not_found" });
    res.json(task);
  });

  app.get("/tasks/:taskId/actions", (req, res) => {
    const task = executionTasks.get(req.params.taskId);
    if (!task) return res.status(404).json({ error: "task_not_found" });
    res.json({ items: taskToolActions(task.id) });
  });
}
