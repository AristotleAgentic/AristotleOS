/**
 * /gel/* route handlers for evidence-ledger.
 *
 * Carved out of index.ts in stage 18 of the prototype-hardening
 * pass. Behavior preserved EXACTLY. Stage 3
 * (services/evidence-ledger/src/gel-chain.test.ts, 5 tests) pins
 * the chain-linkage + verifier + missing-fields behavior — every
 * envelope a future refactor MUST preserve.
 *
 * Routes mounted:
 *   POST /gel/append          — append a new GEL record (201 + record)
 *   GET  /gel/chain           — load the full chain
 *   GET  /gel/tail            — last N records (default 25, max 500)
 *   GET  /gel/verify          — verify chain integrity
 *   POST /gel/export          — produce an evidence bundle for offline review
 *   GET  /gel/health          — chain-specific health + integrity probe
 *
 * Module contract follows the standard stage-6+ pattern: a deps bag
 * holds the only piece of mutable per-process state (the ledger
 * file path) and the local `now()` helper. Substrate primitives
 * (appendGelRecord, loadGelChain, verifyGelChain,
 * exportEvidenceBundle) come in directly from
 * @aristotle/execution-control-runtime — they're pure and don't
 * need injection. Types use the same alias for
 * SubstrateAuthorityEnvelope as index.ts to avoid collision with
 * shared-types::AuthorityEnvelope.
 */

import type { Express } from "express";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  appendGelRecord,
  loadGelChain,
  verifyGelChain,
  exportEvidenceBundle,
  type WardManifest,
  type CanonicalActionInput,
  type CommitGateDecision,
  type Warrant,
  type AuthorityEnvelope as SubstrateAuthorityEnvelope
} from "@aristotle/execution-control-runtime";

export type GelRouteDeps = {
  /** Absolute path to the JSONL ledger file. Resolved at startup
   *  from EVIDENCE_LEDGER_GEL_PATH (defaults to ./data/evidence-
   *  ledger.gel.jsonl). Tests inject a per-test tmpdir path
   *  through this dep. */
  gelPath: string;
  /** ISO timestamp generator — only /gel/export uses it
   *  (exportedAt field). Index.ts owns the canonical `now`. */
  now: () => string;
};

export function mountGelRoutes(app: Express, deps: GelRouteDeps): void {
  const { gelPath, now } = deps;

  app.post("/gel/append", async (req, res) => {
    const {
      ward,
      action,
      decision,
      warrant,
      actor
    } = req.body as {
      ward: WardManifest;
      action: CanonicalActionInput;
      decision: CommitGateDecision;
      warrant?: Warrant;
      /** Operator/principal attributed to the record. See GelActor in
       *  shared/execution-control-runtime. Subject + role are required;
       *  auth method is optional and defaults to "api-key". Valid values
       *  follow the substrate's AuthMethod taxonomy: api-key | token | oidc | mtls. */
      actor?: { subject: string; role?: "operator" | "viewer" | "admin"; auth?: "api-key" | "token" | "oidc" | "mtls"; issuer?: string; key_id?: string };
    };
    if (!ward || !action || !decision) {
      return res.status(400).json({
        error: "missing_required_fields",
        detail: "ward, action, and decision are required"
      });
    }
    try {
      await mkdir(dirname(gelPath), { recursive: true });
      const record = appendGelRecord({
        ledgerPath: gelPath,
        ward,
        action,
        decision,
        warrant,
        actor: actor
          ? {
              subject: actor.subject,
              role: actor.role ?? "operator",
              auth: actor.auth ?? "api-key",
              issuer: actor.issuer,
              key_id: actor.key_id
            }
          : undefined
      });
      res.status(201).json({ ok: true, record, ledgerPath: gelPath });
    } catch (err) {
      res.status(500).json({
        error: "gel_append_failed",
        detail: err instanceof Error ? err.message : String(err)
      });
    }
  });

  app.get("/gel/chain", (_req, res) => {
    try {
      const records = loadGelChain(gelPath);
      res.json({
        ok: true,
        count: records.length,
        tip_hash: records.at(-1)?.record_hash ?? "GENESIS",
        records
      });
    } catch (err) {
      res.status(500).json({
        error: "gel_chain_load_failed",
        detail: err instanceof Error ? err.message : String(err)
      });
    }
  });

  app.get("/gel/tail", (req, res) => {
    const limit = Math.max(1, Math.min(500, Number(req.query.limit ?? 25)));
    try {
      const records = loadGelChain(gelPath);
      res.json({
        ok: true,
        count: records.length,
        limit,
        records: records.slice(-limit)
      });
    } catch (err) {
      res.status(500).json({
        error: "gel_tail_failed",
        detail: err instanceof Error ? err.message : String(err)
      });
    }
  });

  app.get("/gel/verify", (_req, res) => {
    try {
      const verification = verifyGelChain(gelPath);
      res.json(verification);
    } catch (err) {
      res.status(500).json({
        error: "gel_verify_failed",
        detail: err instanceof Error ? err.message : String(err)
      });
    }
  });

  app.post("/gel/export", (req, res) => {
    const { ward, recordId, authorityEnvelope, warrant } = req.body as {
      ward: WardManifest;
      recordId?: string;
      authorityEnvelope?: SubstrateAuthorityEnvelope;
      warrant?: Warrant;
    };
    if (!ward) {
      return res.status(400).json({
        error: "missing_required_field",
        detail: "ward is required (the WardManifest the bundle is anchored to)"
      });
    }
    try {
      const records = loadGelChain(gelPath);
      if (records.length === 0) {
        return res.status(404).json({ error: "empty_chain", detail: "GEL chain has no records to export" });
      }
      const bundle = exportEvidenceBundle({
        ledgerPath: gelPath,
        ward,
        authorityEnvelope,
        recordId,
        warrant,
        exportedAt: now()
      });
      res.json({ ok: true, bundle });
    } catch (err) {
      res.status(500).json({
        error: "gel_export_failed",
        detail: err instanceof Error ? err.message : String(err)
      });
    }
  });

  app.get("/gel/health", (_req, res) => {
    let count = 0;
    let tip_hash = "GENESIS";
    let integrity_ok = true;
    let failure: string | undefined;
    try {
      const records = loadGelChain(gelPath);
      count = records.length;
      tip_hash = records.at(-1)?.record_hash ?? "GENESIS";
      const verification = verifyGelChain(gelPath);
      integrity_ok = verification.ok;
      failure = verification.failure;
    } catch (err) {
      integrity_ok = false;
      failure = err instanceof Error ? err.message : String(err);
    }
    res.json({
      ok: integrity_ok,
      service: "evidence-ledger.gel",
      ledgerPath: gelPath,
      count,
      tip_hash,
      integrity_ok,
      failure,
      substrate_wired: true
    });
  });
}
