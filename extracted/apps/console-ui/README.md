# Console UI

This package preserves the current preferred visual operator surface for the Aristotle Autonomous Governance Console.

Design instruction carried into this export:
- keep this visual language
- do not redesign the operator surface into a generic dashboard
- wire live gateway and service data behind the existing panels

Current state:
- the console can now read live gateway data for health, mesh telemetry, ledger activity, authority envelopes, and Agent OS mission state
- the kill switch control is wired to the gateway and updates the runtime posture through the existing operator surface
- the package now includes a browser app shell so the dashboard can run directly in a canvas-style web surface through Vite

Run locally:
- `npm install`
- `npm run dev`
- open `http://localhost:4173`

Notes:
- the Vite dev server proxies `/health` and `/operator/*` to the gateway at `http://localhost:8080`
- override the proxy target with `VITE_GATEWAY_PROXY_TARGET` if your gateway is elsewhere

Primary component:
- `src/AristotleAutonomousGovernanceConsole.tsx`

Gateway contract:
- `src/gateway-contract.ts`
