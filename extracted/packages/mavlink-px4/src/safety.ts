import type { FlightCommand, FlightCommandKind } from './index.js';

export interface SingleDroneSafetyPolicy {
  aircraftId: string;
  targetSystem: number;
  targetComponent: number;
  telemetryMaxAgeMs: number;
  commandMaxAgeMs: number;
  minimumBatteryPct: number;
  maximumRelativeAltitudeM: number;
  /** Must match the commissioned autopilot's COMMAND_LONG interpretation. */
  takeoffAltitudeReference: "relative-home" | "amsl";
  allowedCommands: FlightCommandKind[];
}

/** Supplied by a trusted autopilot telemetry collector, never by the agent
 * proposing the command. Configuration flags are not commissioning evidence. */
export interface SingleDroneTelemetry {
  aircraftId: string;
  targetSystem: number;
  targetComponent: number;
  receivedAtMs: number;
  batteryPct: number;
  relativeAltitudeM: number;
  homeAltitudeAmslM?: number;
  positionValid: boolean;
  geofenceHealthy: boolean;
  autopilotFailsafesHealthy: boolean;
  operatorEnabled: boolean;
  landed: boolean;
}

/** A software interlock, not a replacement for independent RC override,
 * onboard geofence/link-loss failsafes, or aircraft-specific commissioning. */
export class SingleDroneSafetyInterlock {
  private readonly policy: SingleDroneSafetyPolicy;
  constructor(policy: SingleDroneSafetyPolicy, private readonly readTelemetry: () => SingleDroneTelemetry,
    private readonly clock: () => number = Date.now) {
    this.policy = structuredClone(policy);
    if (!policy.aircraftId || !policy.allowedCommands.length || !['relative-home', 'amsl'].includes(policy.takeoffAltitudeReference) ||
        ![policy.targetSystem, policy.targetComponent].every(n => Number.isInteger(n) && n >= 1 && n <= 255) ||
        ![policy.telemetryMaxAgeMs, policy.commandMaxAgeMs, policy.maximumRelativeAltitudeM].every(n => Number.isFinite(n) && n > 0) ||
        !Number.isFinite(policy.minimumBatteryPct) || policy.minimumBatteryPct < 0 || policy.minimumBatteryPct > 100) {
      throw new Error('INVALID_SINGLE_DRONE_SAFETY_POLICY');
    }
  }

  assert(command: FlightCommand, aircraftId: string): void {
    const p = this.policy, t = this.readTelemetry(), now = this.clock();
    if (!t || !Number.isFinite(now)) throw new Error('FLIGHT_TELEMETRY_MISSING');
    if (aircraftId !== p.aircraftId || t.aircraftId !== p.aircraftId ||
        command.target_system !== p.targetSystem || command.target_component !== p.targetComponent ||
        t.targetSystem !== p.targetSystem || t.targetComponent !== p.targetComponent) throw new Error('FLIGHT_AIRCRAFT_MISMATCH');
    for (const [timestamp, maxAge] of [[t.receivedAtMs, p.telemetryMaxAgeMs], [Date.parse(command.requested_at), p.commandMaxAgeMs]]) {
      if (!Number.isFinite(timestamp) || timestamp > now || now - timestamp > maxAge) throw new Error('FLIGHT_STATE_STALE');
    }
    if (!p.allowedCommands.includes(command.command)) throw new Error('FLIGHT_COMMAND_OUTSIDE_PROFILE');
    if (t.operatorEnabled !== true) throw new Error('FLIGHT_OPERATOR_DISABLED');
    if (t.positionValid !== true || t.geofenceHealthy !== true || t.autopilotFailsafesHealthy !== true) throw new Error('FLIGHT_SAFETY_STATE_INVALID');
    if (!Number.isFinite(t.batteryPct) || t.batteryPct < 0 || t.batteryPct > 100 ||
        !Number.isFinite(t.relativeAltitudeM) || t.relativeAltitudeM < 0) throw new Error('FLIGHT_TELEMETRY_INVALID');
    // Low battery/altitude excursions must not prevent governed recovery commands.
    if (!['LAND', 'RTL'].includes(command.command) &&
        (t.batteryPct < p.minimumBatteryPct || t.relativeAltitudeM > p.maximumRelativeAltitudeM)) throw new Error('FLIGHT_ENVELOPE_EXCEEDED');
    if (command.command === 'TAKEOFF') {
      const altitude = typeof command.params.param7 === 'number' ? command.params.param7 : NaN;
      const relative = p.takeoffAltitudeReference === 'amsl' ? altitude - (t.homeAltitudeAmslM ?? NaN) : altitude;
      if (t.landed !== true || !Number.isFinite(relative) || relative <= 0 || relative > p.maximumRelativeAltitudeM) throw new Error('FLIGHT_TAKEOFF_OUTSIDE_PROFILE');
    }
    if ((command.command === 'ARM' || command.command === 'DISARM') && t.landed !== true) throw new Error('FLIGHT_ARM_DISARM_REQUIRES_LANDED');
  }
}
