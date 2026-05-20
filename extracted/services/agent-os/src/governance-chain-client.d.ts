/**
 * GOVERNANCE_CHAIN_V2 client (agent-os side).
 *
 * agent-os does not import the chain library directly — it speaks to the kernel's
 * /v2 surface over HTTP, which is the correct service boundary. This module maps
 * agent-os's domain (mission / agent / task) onto the chain primitives and drives
 * a consequential act through the kernel Commit Gate:
 *
 *   MAE (one constitution)        <- ensureConstitution
 *     Ward (per mission)          <- mission.requestedBy is the human origin act
 *       Authority Envelope        <- per mission, scopes task.dispatch/completion
 *         Warrant (per act)       <- single-use, bound to this task+phase
 *           /v2/commit            <- Warden: validate chain, consume, GEL
 *
 * Modes:
 *   - "shadow"  : run the chain and report the decision, but never gate execution.
 *   - "enforce" : a non-Allow decision (or an unreachable chain) blocks the act.
 *
 * The execution-gate's kill-switch is folded into the Authority Envelope as an
 * operational limit; witness state is folded into the commit context for the GEL
 * record. The mapping uses sensible defaults (one Ward per mission, requester as
 * origin/accountable party); refine as the data model matures (see MIGRATION.md).
 */
import type { ExecutionTask, OperatingMission } from "@aristotle/shared-types";
export type ChainMode = "off" | "shadow" | "enforce";
export type ChainDecision = "Allow" | "Deny" | "Escalate" | "FailClosed";
export interface ChainCommitResult {
    ran: boolean;
    mode: ChainMode;
    decision?: ChainDecision;
    reasons?: string[];
    violated_invariants?: string[];
    ward_id?: string;
    warrant_id?: string;
    gel_record_id?: string;
    error?: string;
}
export interface ChainClientConfig {
    kernelBase: string;
    mode: ChainMode;
    /** Recorded on the MAE's signing_keys metadata; defaults to the kernel default. */
    keyId?: string;
}
export interface CommitTaskInput {
    mission: OperatingMission;
    task: ExecutionTask;
    phase: "dispatch" | "completion";
    killSwitchActive: boolean;
    witnessRequired: boolean;
    witnessAccepted: boolean;
    missingLeaseTools: string[];
}
export interface ChainClient {
    readonly mode: ChainMode;
    commitTaskAct(input: CommitTaskInput): Promise<ChainCommitResult>;
}
export declare function createChainClient(config: ChainClientConfig): ChainClient;
