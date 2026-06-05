import { createApp, id, now } from "./lib.js";
import { compilePolicy, compileGovernanceManifest, diffGovernanceManifests } from "@aristotle/execution-control-runtime";
const port = Number(process.env.PORT_POLICY_COMPILER ?? 7002);
const app = createApp();
app.get("/health", (_req, res) => res.json({ ok: true, service: "policy-compiler", substrate_wired: true }));
/** Render the compiled GovernanceDraft(s) as the graph shape the UI
 *  expects. One Ward node per draft, one Envelope node per draft,
 *  edges that mirror the runtime authority chain. */
function draftsToGraph(drafts) {
    const nodes = ["meta-authority"];
    const edges = [];
    for (const draft of drafts) {
        const wardLabel = `ward:${draft.ward.ward_id}`;
        const envLabel = `envelope:${draft.authorityEnvelope.envelope_id}`;
        nodes.push(wardLabel, envLabel);
        edges.push({ from: "meta-authority", to: wardLabel, rule: "ward-creation-rules" });
        edges.push({ from: wardLabel, to: envLabel, rule: "envelope-binding" });
        if (draft.authorityEnvelope.allowed_actions.length > 0) {
            const actionNode = `actions:${envLabel}`;
            nodes.push(actionNode);
            edges.push({
                from: envLabel,
                to: actionNode,
                rule: `allow ${draft.authorityEnvelope.allowed_actions.slice(0, 4).join(", ")}${draft.authorityEnvelope.allowed_actions.length > 4 ? "…" : ""}`
            });
        }
    }
    return { nodes, edges };
}
/** Extract human-readable admissibility rules from the compiled
 *  envelope's allowed_actions + physical_bounds. The UI uses these as
 *  one-line summaries; keep them short but real. */
function admissibilityRulesFromDrafts(drafts) {
    const rules = [];
    for (const draft of drafts) {
        for (const action of draft.authorityEnvelope.allowed_actions) {
            rules.push(`allow ${action} on ${draft.ward.ward_id}`);
        }
        for (const action of draft.authorityEnvelope.denied_actions) {
            rules.push(`deny ${action} on ${draft.ward.ward_id}`);
        }
        const bounds = draft.ward.physical_bounds;
        if (bounds) {
            if (typeof bounds.max_altitude_m === "number")
                rules.push(`altitude_m <= ${bounds.max_altitude_m}`);
            if (typeof bounds.battery_minimum_pct === "number")
                rules.push(`battery_pct >= ${bounds.battery_minimum_pct}`);
            if (typeof bounds.max_speed_mps === "number")
                rules.push(`speed_mps <= ${bounds.max_speed_mps}`);
        }
    }
    return rules.slice(0, 16);
}
app.post("/compile", (req, res) => {
    const { policyName, policyText } = req.body;
    const source = policyText ?? "";
    // Run the real APL compiler.
    const result = compilePolicy(source);
    // If compilation produced drafts, also produce per-Ward manifest
    // hashes by passing each draft through compileGovernanceManifest —
    // identical to what the signed policy bundle would carry.
    const manifest_hashes = [];
    let manifestsValid = true;
    if (result.ok) {
        for (const draft of result.drafts) {
            try {
                const manifest = compileGovernanceManifest(draft);
                manifest_hashes.push(manifest.hashes.manifest_hash);
                if (!manifest.validation.ok)
                    manifestsValid = false;
            }
            catch {
                manifestsValid = false;
            }
        }
    }
    const errors = result.diagnostics.map((d) => `[${d.line}:${d.column}] ${d.message}`);
    if (!manifestsValid && result.ok) {
        errors.push("one or more compiled Ward+Envelope manifests failed validation");
    }
    const out = {
        compileId: id("compile"),
        timestamp: now(),
        policyName: policyName ?? "(unnamed)",
        valid: result.ok && manifestsValid,
        graph: result.ok
            ? draftsToGraph(result.drafts)
            : {
                nodes: ["meta-authority"],
                edges: []
            },
        admissibilityRules: result.ok ? admissibilityRulesFromDrafts(result.drafts) : [],
        errors,
        substrate: result.ok
            ? {
                manifest_version: "aristotle.governance-manifest.v1",
                ward_count: result.drafts.length,
                diagnostics: result.diagnostics,
                manifest_hashes
            }
            : undefined
    };
    res.json(out);
});
// Bonus: a /diff endpoint that takes two compiled bundles and reports
// material changes (added / removed allowed_actions, tightened bounds,
// etc.) via diffGovernanceManifests. Operator UIs can use this for
// pre-deployment policy review.
app.post("/diff", (req, res) => {
    const { before, after } = req.body;
    const compiledBefore = compilePolicy(before ?? "");
    const compiledAfter = compilePolicy(after ?? "");
    if (!compiledBefore.ok || !compiledAfter.ok) {
        return res.status(400).json({
            ok: false,
            errors: [
                ...compiledBefore.diagnostics.map((d) => `before: [${d.line}:${d.column}] ${d.message}`),
                ...compiledAfter.diagnostics.map((d) => `after: [${d.line}:${d.column}] ${d.message}`)
            ]
        });
    }
    // Pair drafts by ward_id; report adds, removes, and per-ward diffs.
    const beforeByWard = new Map(compiledBefore.drafts.map((d) => [d.ward.ward_id, d]));
    const afterByWard = new Map(compiledAfter.drafts.map((d) => [d.ward.ward_id, d]));
    const wards = new Set([...beforeByWard.keys(), ...afterByWard.keys()]);
    const per_ward = [];
    let total_changes = 0;
    let weakening_changes = 0;
    for (const ward_id of wards) {
        const b = beforeByWard.get(ward_id);
        const a = afterByWard.get(ward_id);
        if (b && !a) {
            per_ward.push({ ward_id, state: "removed", entries: [] });
            total_changes++;
        }
        else if (a && !b) {
            per_ward.push({ ward_id, state: "added", entries: [] });
            total_changes++;
            weakening_changes++;
        }
        else if (a && b) {
            const entries = diffGovernanceManifests(b, a);
            per_ward.push({ ward_id, state: entries.length ? "changed" : "unchanged", entries });
            total_changes += entries.length;
            weakening_changes += entries.filter((e) => e.weakening).length;
        }
    }
    res.json({ ok: true, total_changes, weakening_changes, per_ward });
});
app.listen(port, () => console.log(`policy-compiler on ${port} (substrate-wired: APL compiler + manifest hashing + diff)`));
