import { SqliteEffectStore } from './effects.js';
import type { CanonicalActionInput, GelRecord, WardManifest, Warrant, WarrantVerifyOptions } from './index.js';

/** Structural implementation of adapter-sdk's boundary; keeps the browser SDK
 * independent of Node/SQLite. All dispatchers must share the same durable DB.
 * The operation ID is caller-stable across retries, never a generated attempt ID.
 */
export function createDurableAdapterBoundary(options: {
  store: SqliteEffectStore;
  ward: WardManifest;
  clock?: () => string;
  verify?: () => WarrantVerifyOptions;
  beforeDispatch?: (action: CanonicalActionInput) => void;
}) {
  return {
    begin(action: { [key: string]: unknown }, decision: { [key: string]: unknown }) {
      const snapshot = structuredClone(action) as unknown as CanonicalActionInput;
      if (snapshot.ward_id !== options.ward.ward_id || !snapshot.target || !snapshot.requested_at ||
          typeof snapshot.params?.operation_id !== 'string' || !snapshot.params.operation_id.trim()) {
        throw new Error('DURABLE_ADAPTER_BINDING_REQUIRED');
      }
      options.beforeDispatch?.(snapshot);
      const now = options.clock?.() ?? new Date().toISOString();
      const attempt = options.store.begin({
        ward: options.ward, action: snapshot, warrant: decision.warrant as Warrant,
        admission: decision.gel_record as GelRecord, now, verify: options.verify?.()
      });
      return {
        attemptId: attempt.attempt_id,
        authorization: {
          warrant_id: attempt.warrant_id,
          warrant_signature: (decision.warrant as Warrant).signature,
          consumed: true as const,
          consumed_at: now,
          action_hash: attempt.canonical_action_hash
        },
        finishUnknown() { options.store.markUnknown(attempt.attempt_id, options.clock?.()); }
      };
    }
  };
}
