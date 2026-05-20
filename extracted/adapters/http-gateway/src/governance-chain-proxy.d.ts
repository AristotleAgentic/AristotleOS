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
export declare function createGovernanceChainProxy(kernelBase: string, enabled: boolean): Router;
