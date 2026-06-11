# Deployment

For local development, use:

```powershell
npm run aristotle:demo
```

For the full service-backed stack, use:

```powershell
npm run stack:up
```

For a pilot Kubernetes install, use:

```powershell
npm run pilot:images -- --tag 0.1.0-pilot.1 --push
npm run pilot:install -- --tag 0.1.0-pilot.1
```

The pilot chart includes immutable image tags, restricted pod security, NetworkPolicy, Prometheus monitoring, OpenTelemetry config, SPIFFE CSI support, the public trial at `/public`, the playground at `/try`, and the operator console at `/`.
