# AristotleOS Quickstart

AristotleOS is runtime governance for autonomous execution. It binds authority at the execution boundary before irreversible mutation or external action occurs.

## Try In Browser

```powershell
corepack pnpm install
npm run aristotle:demo
```

Open:

```text
http://127.0.0.1:4173/try
```

The playground starts with a payments agent attempting an $8,000 refund. The Commit Gate defers the action, withholds the warrant, commits GEL evidence, then lets you approve a one-time warrant.

## Use The CLI

```powershell
npm run aristotle -- init my-governed-agent
cd my-governed-agent
npm --prefix .. run aristotle -- check
npm --prefix .. run aristotle -- plan
npm --prefix .. run aristotle -- demo payments
npm --prefix .. run aristotle -- approvals
```

From the repository root you can also run:

```powershell
npm run aristotle -- check
npm run aristotle -- plan
npm run aristotle -- demo payments
```

## Local Services

For the full local control plane:

```powershell
npm run local:up
```

Open:

```text
http://127.0.0.1:4173
```

The public trial is at `/public`; the playground is at `/try`; the operator console remains at `/`.

## Docker Compose

```powershell
npm run stack:up
npm run stack:smoke
```

This starts the service-backed Governance Plane, gateway, evidence ledger, agent OS, and console.
