import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Dual control / M-of-N approval.
 *
 * The doctrine is "authority before consequence." For the gravest actions, that
 * authority should be *plural*: a two-person rule (or M-of-N) so no single agent —
 * or single compromised operator — can authorize an irreversible action alone. This
 * is the nuclear two-man rule / SOX dual control / break-glass pattern, bound at the
 * execution boundary.
 *
 * An action whose type is under dual control does not get a Warrant on its own
 * ALLOW; the gate ESCALATEs and opens a pending approval request keyed by the exact
 * canonical action hash. Independent, attributed approvals accrue; once M distinct
 * approvers (none of them the requesting subject) have approved within the TTL, the
 * same canonical action is authorized and the Warrant issues. Any rejection settles
 * it. Every vote is recorded — plural authority, fully evidenced.
 *
 * The state machine is pure and testable; the store holds requests in-memory
 * (per-process) or file-backed (durable across restarts).
 */

export interface DualControlPolicy {
  /** action_types that require M-of-N approval before a Warrant issues. */
  actions: string[];
  /** Distinct approvers required (M). */
  required: number;
  /** Optional time-to-live for a pending request, in ms. */
  ttlMs?: number;
}

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";
export type ApprovalDecision = "approve" | "reject";

export interface ApprovalVote {
  by: string;
  decision: ApprovalDecision;
  reason?: string;
  at: string;
}

export interface ApprovalRequest {
  request_id: string;
  canonical_action_hash: string;
  ward_id: string;
  subject: string;
  action_type: string;
  required: number;
  votes: ApprovalVote[];
  created_at: string;
  expires_at?: string;
  status: ApprovalStatus;
}

type StoredRequest = Omit<ApprovalRequest, "status">;

/** Read + validate a DualControlPolicy from an envelope constraint blob. */
export function dualControlPolicyFrom(raw: unknown): DualControlPolicy | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const d = raw as Record<string, unknown>;
  const actions = Array.isArray(d.actions) ? d.actions.filter((a): a is string => typeof a === "string") : [];
  const required = typeof d.required === "number" ? d.required : undefined;
  if (actions.length === 0 || required === undefined || required < 1) return undefined;
  const ttlMs = typeof d.ttlMs === "number" ? d.ttlMs : typeof d.ttl_ms === "number" ? d.ttl_ms : undefined;
  return { actions, required, ...(ttlMs !== undefined ? { ttlMs } : {}) };
}

/** Pure: resolve a request's status from its votes and the current time. Reject wins;
 *  then M distinct approvers ⇒ approved; then TTL ⇒ expired; else pending. */
export function evaluateApproval(req: StoredRequest, now: string): ApprovalStatus {
  if (req.votes.some((v) => v.decision === "reject")) return "rejected";
  const approvers = new Set(req.votes.filter((v) => v.decision === "approve").map((v) => v.by));
  if (approvers.size >= req.required) return "approved";
  if (req.expires_at && Date.parse(now) > Date.parse(req.expires_at)) return "expired";
  return "pending";
}

function withStatus(req: StoredRequest, now: string): ApprovalRequest {
  return { ...req, status: evaluateApproval(req, now) };
}

function requestIdFor(canonicalHash: string): string {
  return `apr-${canonicalHash.slice(0, 16)}`;
}

interface StoreFile {
  version: "aristotle.dual-control.v1";
  requests: Record<string, StoredRequest>;
}

export interface OpenApprovalInput {
  canonicalHash: string;
  wardId: string;
  subject: string;
  actionType: string;
  required: number;
  ttlMs?: number;
  now: string;
}

export class ApprovalStore {
  private mem: Map<string, StoredRequest> | null;

  constructor(private readonly file: string | null) {
    this.mem = file ? null : new Map();
  }

  static memory(): ApprovalStore {
    return new ApprovalStore(null);
  }

  private read(): Map<string, StoredRequest> {
    if (this.mem) return this.mem;
    if (existsSync(this.file!)) {
      try {
        const parsed = JSON.parse(readFileSync(this.file!, "utf8")) as Partial<StoreFile>;
        return new Map(Object.entries(parsed.requests ?? {}));
      } catch {
        /* corrupt => start clean */
      }
    }
    return new Map();
  }

  private persist(map: Map<string, StoredRequest>): void {
    if (this.mem) { this.mem = map; return; }
    mkdirSync(path.dirname(path.resolve(this.file!)), { recursive: true });
    const payload: StoreFile = { version: "aristotle.dual-control.v1", requests: Object.fromEntries(map) };
    writeFileSync(this.file!, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  /** Idempotent: ensure a pending request exists for the action; return it. */
  request(input: OpenApprovalInput): ApprovalRequest {
    const map = this.read();
    const id = requestIdFor(input.canonicalHash);
    let req = map.get(id);
    if (!req) {
      req = {
        request_id: id,
        canonical_action_hash: input.canonicalHash,
        ward_id: input.wardId,
        subject: input.subject,
        action_type: input.actionType,
        required: input.required,
        votes: [],
        created_at: input.now,
        ...(input.ttlMs ? { expires_at: new Date(Date.parse(input.now) + input.ttlMs).toISOString() } : {})
      };
      map.set(id, req);
      this.persist(map);
    }
    return withStatus(req, input.now);
  }

  get(requestId: string, now: string = new Date().toISOString()): ApprovalRequest | undefined {
    const req = this.read().get(requestId);
    return req ? withStatus(req, now) : undefined;
  }

  getByHash(canonicalHash: string, now: string = new Date().toISOString()): ApprovalRequest | undefined {
    return this.get(requestIdFor(canonicalHash), now);
  }

  /**
   * Record an attributed vote. Enforces separation of duties: only a pending request
   * accepts votes, the requesting subject cannot approve its own action, and each
   * approver votes at most once.
   */
  vote(requestId: string, by: string, decision: ApprovalDecision, reason: string | undefined, now: string = new Date().toISOString()): ApprovalRequest {
    const map = this.read();
    const req = map.get(requestId);
    if (!req) throw new Error(`unknown approval request: ${requestId}`);
    const current = evaluateApproval(req, now);
    if (current !== "pending") throw new Error(`approval request ${requestId} is already ${current}`);
    if (by === req.subject) throw new Error("separation of duties: the requesting subject cannot approve its own action");
    if (req.votes.some((v) => v.by === by)) throw new Error(`${by} has already voted on ${requestId}`);
    req.votes.push({ by, decision, ...(reason ? { reason } : {}), at: now });
    map.set(requestId, req);
    this.persist(map);
    return withStatus(req, now);
  }

  list(now: string = new Date().toISOString()): ApprovalRequest[] {
    return [...this.read().values()]
      .map((r) => withStatus(r, now))
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.request_id.localeCompare(b.request_id));
  }

  listPending(now: string = new Date().toISOString()): ApprovalRequest[] {
    return this.list(now).filter((r) => r.status === "pending");
  }
}
