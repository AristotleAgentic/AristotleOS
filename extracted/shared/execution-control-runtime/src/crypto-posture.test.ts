import test from "node:test";
import assert from "node:assert/strict";
import { assertCryptoPosture, cryptoPostureFromEnv, isFipsActive } from "./index.js";

test("requireFips:false is a no-op regardless of provider", () => {
  assert.doesNotThrow(() => assertCryptoPosture({ requireFips: false }));
  assert.doesNotThrow(() => assertCryptoPosture({}));
});

test("requireFips:true fails closed when FIPS is not active", () => {
  if (isFipsActive()) {
    // On a genuinely FIPS-enabled build this must pass instead.
    assert.doesNotThrow(() => assertCryptoPosture({ requireFips: true }));
  } else {
    assert.throws(() => assertCryptoPosture({ requireFips: true }), /FIPS mode is required but not active/);
  }
});

test("cryptoPostureFromEnv reads ARISTOTLE_REQUIRE_FIPS", () => {
  assert.equal(cryptoPostureFromEnv({ ARISTOTLE_REQUIRE_FIPS: "1" } as NodeJS.ProcessEnv).requireFips, true);
  assert.equal(cryptoPostureFromEnv({} as NodeJS.ProcessEnv).requireFips, false);
});
