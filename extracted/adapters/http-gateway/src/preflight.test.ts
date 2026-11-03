import test from 'node:test';
import assert from 'node:assert/strict';
import { runGatewayPreflight } from './preflight.js';

test('production cannot boot with shadow/off governance or an insecure override', () => {
  const original = process.env;
  try {
    process.env = {
      NODE_ENV: 'production', OPERATOR_API_KEY: 'fixture', SERVICE_DISCOVERY_MODE: 'container',
      EVIDENCE_LEDGER_STATE_PATH: '/state/ledger', AGENT_OS_STATE_PATH: '/state/os',
      GOVERNANCE_CHAIN_V2: 'true', GOVERNANCE_CHAIN_MODE: 'enforce',
      GOVERNANCE_CHAIN_STATE_PATH: '/state/chain', GOVERNANCE_CHAIN_SIGNING_SECRET: 'fixture',
      EVIDENCE_LEDGER_SIGNING_SECRET: 'fixture', OPERATOR_ROLE_ENFORCEMENT: 'true',
      OPERATOR_SESSION_ENFORCEMENT: 'true', OPERATOR_SESSION_SECRET: 'fixture'
    };
    assert.equal(runGatewayPreflight().ok, true);
    for (const [key, value] of [
      ['GOVERNANCE_CHAIN_V2', 'false'], ['GOVERNANCE_CHAIN_MODE', 'shadow'],
      ['GOVERNANCE_CHAIN_STATE_PATH', ''], ['GOVERNANCE_CHAIN_SIGNING_SECRET', ''],
      ['EVIDENCE_LEDGER_SIGNING_SECRET', ''], ['OPERATOR_ROLE_ENFORCEMENT', 'false'],
      ['OPERATOR_SESSION_ENFORCEMENT', 'false'], ['ALLOW_INSECURE_PRODUCTION_BOOT', 'true']
    ]) {
      const before = process.env[key];
      process.env[key] = value;
      assert.equal(runGatewayPreflight().ok, false, key);
      process.env.ALLOW_INSECURE_PRODUCTION_BOOT = 'true';
      assert.equal(runGatewayPreflight().ok, false, 'override must not downgrade failure');
      delete process.env.ALLOW_INSECURE_PRODUCTION_BOOT;
      if (before === undefined) delete process.env[key]; else process.env[key] = before;
    }
  } finally { process.env = original; }
});
