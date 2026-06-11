/**
 * Multi-level security (MLS) classification labels.
 *
 * Defense-review finding 2.7: actions and evidence were single-level — no data
 * classification, no cross-domain story. This adds a Bell-LaPadula-style label model:
 * a clearance **dominates** a label when its level is at least as high AND it holds
 * every caveat/compartment the label requires. The Commit Gate (via the composable
 * `enforceClassification` precondition) refuses an action whose data label is not
 * dominated by the granting authority's clearance — *no read up*. Cross-domain
 * transfer to a lower domain is a downgrade (*no write down*) and is refused unless
 * explicitly authorized.
 *
 * This is the label model + enforcement primitive. An **accredited cross-domain
 * solution (CDS)** is the operator's integration (Tier C); this gives it a typed,
 * deterministic boundary to enforce against, not a replacement for accreditation.
 */

export type ClassificationLevel = "UNCLASSIFIED" | "CUI" | "CONFIDENTIAL" | "SECRET" | "TOP_SECRET";

const LEVEL_RANK: Record<ClassificationLevel, number> = {
  UNCLASSIFIED: 0,
  CUI: 1,
  CONFIDENTIAL: 2,
  SECRET: 3,
  TOP_SECRET: 4
};

export interface Classification {
  level: ClassificationLevel;
  /** Handling caveats / compartments, e.g. ["NOFORN", "REL TO USA, FVEY"]. Case-insensitive. */
  caveats?: string[];
}

export type ClassificationCheck =
  | { ok: true }
  | { ok: false; reason: "CLASSIFICATION_VIOLATION"; detail: string };

export function classificationRank(level: ClassificationLevel): number {
  return LEVEL_RANK[level];
}

function normCaveat(caveat: string): string {
  return caveat.trim().toUpperCase();
}

/** True when `clearance` dominates `label`: at least as high a level AND holds every caveat. */
export function dominates(clearance: Classification, label: Classification): boolean {
  if (LEVEL_RANK[clearance.level] < LEVEL_RANK[label.level]) return false;
  const held = new Set((clearance.caveats ?? []).map(normCaveat));
  return (label.caveats ?? []).every((caveat) => held.has(normCaveat(caveat)));
}

/** Check a single clearance against a label (no read up). */
export function checkClassification(clearance: Classification, label: Classification): ClassificationCheck {
  if (dominates(clearance, label)) return { ok: true };
  const missing = (label.caveats ?? []).filter((caveat) => !new Set((clearance.caveats ?? []).map(normCaveat)).has(normCaveat(caveat)));
  const detail = LEVEL_RANK[clearance.level] < LEVEL_RANK[label.level]
    ? `clearance ${clearance.level} is below label ${label.level}`
    : `clearance is missing required caveats: ${missing.join(", ")}`;
  return { ok: false, reason: "CLASSIFICATION_VIOLATION", detail };
}

/**
 * Enforce that EVERY granting clearance (e.g. the Ward's and the Authority Envelope's)
 * dominates the action's data label. Run this as a precondition before the gate; on a
 * violation, refuse with CLASSIFICATION_VIOLATION. When the action carries no label,
 * it is treated as the lowest level and always passes (unclassified by default).
 */
export function enforceClassification(clearances: Array<Classification | undefined>, label: Classification | undefined): ClassificationCheck {
  if (!label) return { ok: true };
  for (const clearance of clearances) {
    if (!clearance) continue;
    const check = checkClassification(clearance, label);
    if (!check.ok) return check;
  }
  return { ok: true };
}

export type CrossDomainCheck =
  | { ok: true }
  | { ok: false; reason: "DOWNGRADE_BLOCKED" | "COMPARTMENT_LOSS"; detail: string };

/**
 * Whether data labeled `from` may flow into a domain cleared to `to`. Allowed only
 * when `to` dominates `from` (the destination can handle it). A move to a strictly
 * lower level is a downgrade (no write down); dropping a caveat is compartment loss.
 * Both require an accredited CDS with explicit authorization — this returns a typed
 * refusal so the boundary never silently downgrades.
 */
export function crossDomainTransferAllowed(from: Classification, to: Classification): CrossDomainCheck {
  if (LEVEL_RANK[to.level] < LEVEL_RANK[from.level]) {
    return { ok: false, reason: "DOWNGRADE_BLOCKED", detail: `transfer ${from.level} -> ${to.level} is a downgrade; requires CDS authorization` };
  }
  const dst = new Set((to.caveats ?? []).map(normCaveat));
  const lost = (from.caveats ?? []).filter((caveat) => !dst.has(normCaveat(caveat)));
  if (lost.length) {
    return { ok: false, reason: "COMPARTMENT_LOSS", detail: `destination lacks compartments: ${lost.join(", ")}` };
  }
  return { ok: true };
}
