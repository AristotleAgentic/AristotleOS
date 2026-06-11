# Governing Robotics And Drone Actions

Goal: govern physical or field actions before a robot, drone, or fleet system
executes them.

## Boundary

Consequential actions include takeoff, route change, payload release, geofence
override, actuator command, swarm task assignment, and emergency mode changes.

## Adapter Pattern

- Bind the action to a Ward representing mission, range, asset, operator, and
  jurisdiction.
- Evaluate physical invariant gates such as geofence, battery, link quality,
  weather, airspace, standoff distance, and operator authority.
- Issue Warrants only for specific actions and short windows.
- Preserve evidence that can be verified after disconnected operation.

## Review Questions

- What happens during network partition?
- Can field autonomy expand beyond delegated authority?
- Are physical invariants hard stops rather than advisory warnings?
