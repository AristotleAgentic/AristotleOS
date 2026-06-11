import { test } from "node:test";
import assert from "node:assert/strict";
import { satisfies, evaluateConstraints } from "./constraints.js";

// The fact record is built from attacker-controlled telemetry/context/action params.
// getPath must read OWN properties only and refuse prototype-chain segments, so a
// request cannot satisfy/evade an authority-defined predicate via inherited keys.

test("inherited Object.prototype members do not 'exist' as facts", () => {
  // "constructor"/"toString" live on the prototype; they must not count as present.
  assert.equal(satisfies({ key: "constructor", op: "exists" }, {}), false);
  assert.equal(satisfies({ key: "toString", op: "exists" }, {}), false);
});

test("an 'absent' safety predicate is satisfied for inherited keys (not falsely present)", () => {
  // e.g. a Ward predicate {key:"toString", op:"absent"} must hold for a clean record.
  assert.equal(satisfies({ key: "toString", op: "absent" }, {}), true);
});

test("forbidden prototype-chain segments resolve to undefined", () => {
  const facts = JSON.parse('{"__proto__":{"polluted":true},"a":{"b":1}}') as Record<string, unknown>;
  assert.equal(satisfies({ key: "__proto__.polluted", op: "exists" }, facts), false);
  assert.equal(satisfies({ key: "constructor.name", op: "exists" }, facts), false);
  // a legitimate nested own-path still resolves
  assert.equal(satisfies({ key: "a.b", op: "eq", value: 1 }, facts), true);
});

test("legitimate own-property predicates are unaffected", () => {
  const facts = { altitude_ft: 380, region: "us-mt" };
  assert.deepEqual(evaluateConstraints([{ key: "altitude_ft", op: "lte", value: 400 }], facts, "ward-boundary"), []);
  assert.equal(
    evaluateConstraints([{ key: "altitude_ft", op: "lte", value: 300 }], facts, "ward-boundary").length,
    1,
  );
});
