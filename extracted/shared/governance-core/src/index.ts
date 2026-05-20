/**
 * @aristotle/governance-core
 *
 * The runtime governance chain for AristotleOS:
 *
 *   Meta Authority Envelope -> Ward -> Authority Envelope -> Warrant
 *     -> Commit Gate -> Execution -> GEL Record
 *
 * No consequential action reaches execution unless that chain is complete and
 * valid at the moment of commit. See README.md for the architecture and
 * MIGRATION.md for grafting this onto the existing service mesh.
 */

export * from "./ontology.js";
export * from "./constraints.js";
export * from "./errors.js";
export * from "./hash.js";
export * from "./ids.js";
export * from "./types.js";
export * from "./store.js";
export * from "./validators.js";
export * from "./gel.js";
export * from "./metrics.js";
export * from "./commit-gate.js";
export * from "./revocation.js";
export * from "./federation.js";
export * from "./factory.js";
export * as fixtures from "./fixtures.js";
