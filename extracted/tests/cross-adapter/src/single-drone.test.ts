import test from 'node:test';
import assert from 'node:assert/strict';
import { createSocket } from 'node:dgram';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { evaluateExecutionControl, createEphemeralDevSigner, SqliteEffectStore, createDurableAdapterBoundary,
  type CanonicalActionInput, type WardManifest, type AuthorityEnvelope } from '../../../shared/execution-control-runtime/src/index.js';
import { MavlinkUdpTransport, governFlightCommand, SingleDroneSafetyInterlock,
  type FlightCommand, type AristotleClient } from '../../../packages/mavlink-px4/src/index.js';

test('single-drone loopback: signed boundary, concurrent retry and restart emit only one datagram', async () => {
  const now = '2026-10-06T12:00:00.000Z', ms = Date.parse(now);
  const dir = mkdtempSync(path.join(tmpdir(), 'aos-single-drone-'));
  const signer = createEphemeralDevSigner();
  const ward: WardManifest = { ward_id: 'flight', name: 'Single drone', authority_domain: 'flight',
    sovereignty_context: 'test', policy_version: '1', permitted_subjects: ['pilot'] };
  const envelope: AuthorityEnvelope = { envelope_id: 'flight-envelope', ward_id: 'flight', subject: 'pilot',
    allowed_actions: ['aviation.flight.takeoff'], denied_actions: [], constraints: {}, expires_at: '2027-01-01T00:00:00Z', issuer: 'test' };
  let state = { aircraftId: 'drone-1', targetSystem: 1, targetComponent: 1, receivedAtMs: ms, batteryPct: 90,
    relativeAltitudeM: 0, positionValid: true, geofenceHealthy: true, autopilotFailsafesHealthy: true, operatorEnabled: true, landed: true };
  const safetyInterlock = new SingleDroneSafetyInterlock({ aircraftId: 'drone-1', targetSystem: 1, targetComponent: 1,
    telemetryMaxAgeMs: 500, commandMaxAgeMs: 1000, minimumBatteryPct: 30, maximumRelativeAltitudeM: 10,
    takeoffAltitudeReference: 'relative-home',
    allowedCommands: ['TAKEOFF'] }, () => state, () => ms);
  const command: FlightCommand = { command: 'TAKEOFF', target_system: 1, target_component: 1,
    params: { param7: 3 }, requested_at: now };
  const client = { async evaluate(action: CanonicalActionInput) {
    return evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, signer, now, ledgerPath: path.join(dir, 'admission.jsonl') });
  } } as unknown as AristotleClient;
  const listener = createSocket('udp4');
  await new Promise<void>(r => listener.bind(0, '127.0.0.1', r));
  const received: Buffer[] = [];
  listener.on('message', data => received.push(data));
  const transport = new MavlinkUdpTransport({ remote: { host: '127.0.0.1', port: listener.address().port },
    systemId: 7, componentId: 1, productionValidated: true });
  const db = path.join(dir, 'effects.sqlite');
  let store = new SqliteEffectStore(db, signer);
  const run = (operationId: string) => governFlightCommand(command, transport, {
    client, wardId: ward.ward_id, subject: 'pilot', aircraftId: 'drone-1', operationId, safetyInterlock,
    effectBoundary: createDurableAdapterBoundary({ store, ward, clock: () => now })
  });
  try {
    const delivered = once(listener, 'message', { signal: AbortSignal.timeout(5000) });
    const outcomes = await Promise.all([run('flight-1-takeoff'), run('flight-1-takeoff')]);
    await delivered;
    assert.equal(outcomes.filter(o => o.ok).length, 1);
    assert.equal(store.records().at(-1)?.effect_event?.attempt.state, 'EFFECT_UNKNOWN');
    store.close(); store = new SqliteEffectStore(db, signer);
    assert.equal((await run('flight-1-takeoff')).ok, false);
    state = { ...state, receivedAtMs: ms - 501 };
    assert.equal((await run('flight-2-takeoff')).ok, false);
    await new Promise(r => setTimeout(r, 30));
    assert.equal(received.length, 1);
  } finally { store.close(); await transport.close(); await new Promise<void>(r => listener.close(r)); }
});
