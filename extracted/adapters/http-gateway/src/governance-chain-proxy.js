/**
 * GOVERNANCE_CHAIN_V2 gateway exposure.
 *
 * A thin, status-preserving reverse proxy from the operator front door to the
 * kernel's /v2 chain surface, so the new Ward/Warrant chain can be observed and
 * exercised alongside the ORIGINAL governance surface (/operator/ledger,
 * /operator/envelopes, /operator/govern, ...) for side-by-side comparison.
 *
 * Mounted under /operator/governance-chain, it inherits the gateway's operator
 * auth + method-based RBAC (GET = read role, POST = mutation role). Unlike the
 * gateway's `call()` helper, this forwards the upstream status code and body
 * verbatim — so a governed Deny (200), a FailClosed (200) or a not-found (404)
 * reaches the operator unchanged, which is exactly what you want when comparing
 * the new chain's verdicts against the original.
 */
import { Router } from "express";
/**
 * @param kernelBase host:port of the governance-kernel (e.g. "127.0.0.1:7001").
 * @param enabled    whether GOVERNANCE_CHAIN_V2 is on; when false every call
 *                   returns 501 so the console can detect the feature state.
 */
export function createGovernanceChainProxy(kernelBase, enabled) {
    const router = Router();
    router.all("/*", async (req, res) => {
        if (!enabled) {
            res.status(501).json({
                error: "governance_chain_v2_disabled",
                message: "Set GOVERNANCE_CHAIN_V2=true to enable the Ward/Warrant chain.",
            });
            return;
        }
        // req.url is relative to the mount point and preserves any query string.
        const sub = req.url.replace(/^\/+/, "");
        const isRead = req.method === "GET" || req.method === "HEAD";
        const init = { method: req.method, headers: { "content-type": "application/json" } };
        if (!isRead)
            init.body = JSON.stringify(req.body ?? {});
        try {
            const upstream = await fetch(`http://${kernelBase}/v2/${sub}`, init);
            const text = await upstream.text();
            res.status(upstream.status).type("application/json").send(text);
        }
        catch (e) {
            res.status(502).json({ error: "upstream_failure", message: e instanceof Error ? e.message : String(e) });
        }
    });
    return router;
}
