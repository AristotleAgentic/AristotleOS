import { readFile } from "node:fs/promises";

const checks = [];

function requireText(name, text, needle, detail = needle) {
  const ok = text.includes(needle);
  checks.push({ name, ok, detail });
  if (!ok) {
    throw new Error(`${name} missing required deployment contract: ${detail}`);
  }
}

function requireRegex(name, text, pattern, detail = pattern.source) {
  const ok = pattern.test(text);
  checks.push({ name, ok, detail });
  if (!ok) {
    throw new Error(`${name} missing required deployment contract: ${detail}`);
  }
}

function forbidText(name, text, needle, detail = needle) {
  const ok = !text.includes(needle);
  checks.push({ name, ok, detail });
  if (!ok) {
    throw new Error(`${name} contains forbidden deployment contract: ${detail}`);
  }
}

async function main() {
  const gateway = await readFile("adapters/http-gateway/src/index.ts", "utf8");
  const compose = await readFile("docker-compose.yml", "utf8");
  const productionEnvExample = await readFile(".env.production.example", "utf8");
  const k8sNamespace = await readFile("manifests/k8s/namespace.yaml", "utf8");
  const k8sGateway = await readFile("manifests/k8s/gateway-deployment.yaml", "utf8");
  const k8sControlPlane = await readFile("manifests/k8s/control-plane.yaml", "utf8");
  const k8sNetworkPolicy = await readFile("manifests/k8s/network-policy.yaml", "utf8");
  const k8sObservability = await readFile("manifests/k8s/observability.yaml", "utf8");
  const k8sSecretsExample = await readFile("manifests/k8s/production-secrets.example.yaml", "utf8");
  const helmChart = await readFile("charts/aristotle-governance-os/Chart.yaml", "utf8");
  const helmValues = await readFile("charts/aristotle-governance-os/values.yaml", "utf8");
  const helmConsole = await readFile("charts/aristotle-governance-os/templates/console.yaml", "utf8");
  const helmDeployments = await readFile("charts/aristotle-governance-os/templates/deployments.yaml", "utf8");
  const helmIngress = await readFile("charts/aristotle-governance-os/templates/ingress.yaml", "utf8");
  const helmObservability = await readFile("charts/aristotle-governance-os/templates/observability.yaml", "utf8");
  const helmNetworkPolicy = await readFile("charts/aristotle-governance-os/templates/networkpolicy.yaml", "utf8");
  const spiffeValues = await readFile("charts/aristotle-governance-os/values-spiffe.example.yaml", "utf8");
  const consoleServer = await readFile("apps/console-ui/server.mjs", "utf8");
  const consoleDockerfile = await readFile("manifests/docker/console-ui.Dockerfile", "utf8");
  const serviceDockerfile = await readFile("manifests/docker/service.Dockerfile", "utf8");
  const pilotImages = await readFile("scripts/build-pilot-images.mjs", "utf8");
  const pilotInstall = await readFile("scripts/pilot-install.mjs", "utf8");
  const k8sSmokeInstall = await readFile("scripts/k8s-smoke-install.mjs", "utf8");
  const pilotDocs = await readFile("docs/pilot-install.md", "utf8");
  const runbook = await readFile("docs/deployment-runbook.md", "utf8");
  const packageJson = await readFile("package.json", "utf8");

  requireText("gateway", gateway, '"/ready"', "strict readiness endpoint");
  requireText("gateway", gateway, '"/metrics"', "Prometheus metrics endpoint");
  requireText("gateway", gateway, "res.status(readiness.ok ? 200 : 503)", "readiness must fail closed with 503");
  requireText("gateway", gateway, "aristotle_gateway_fail_closed", "fail-closed metric");
  requireText("gateway", gateway, "aristotle_upstream_ready", "upstream readiness metric");
  requireText("gateway", gateway, "OTEL_EXPORTER_OTLP_ENDPOINT", "OpenTelemetry OTLP endpoint");
  requireText("gateway", gateway, "emitOtelSpan", "OpenTelemetry span emission");
  requireText("gateway", gateway, "aristotle.execution_boundary", "execution-boundary trace attribute");

  requireText("console-server", consoleServer, '"/console-health"', "console health probe");
  requireText("console-server", consoleServer, '"/operator"', "console operator proxy");
  requireText("console-server", consoleServer, '"/v1"', "console public trial API proxy");
  requireText("console-server", consoleServer, "CONSOLE_GATEWAY_BASE_URL", "console gateway proxy target");
  requireText("console-dockerfile", consoleDockerfile, "CMD [\"node\", \"server.mjs\"]", "console production server command");
  requireText("service-dockerfile", serviceDockerfile, "@aristotle/trial-engine", "service images build trial engine runtime dependency");

  requireText("compose", compose, "http://127.0.0.1:8080/ready", "http-gateway healthcheck must use /ready");
  requireText("compose", compose, "http-gateway: { condition: service_healthy }", "console must wait on gateway readiness");

  requireText("production-env", productionEnvExample, "GOVERNANCE_CHAIN_V2=true", "chain runtime enabled in production env contract");
  requireText("production-env", productionEnvExample, "GOVERNANCE_CHAIN_MODE=enforce", "production env chain mode is enforce");
  requireText("production-env", productionEnvExample, "GOVERNANCE_CHAIN_STATE_PATH=./data/governance-chain.json", "production env durable chain state path");
  requireText("production-env", productionEnvExample, "GOVERNANCE_CHAIN_SIGNING_SECRET=replace-with-strong-chain-signing-secret", "production env chain signing secret contract");
  requireText("production-env", productionEnvExample, "EVIDENCE_LEDGER_SIGNING_SECRET=replace-with-strong-ledger-signing-secret", "production env ledger signing secret contract");
  requireText("production-env", productionEnvExample, "OTEL_TRACES_EXPORTER=otlp", "production OpenTelemetry trace exporter contract");
  requireText("production-env", productionEnvExample, "SPIFFE_SOCKET_PATH=/run/spire/sockets/spire-agent.sock", "production SPIFFE socket contract");

  requireText("k8s-namespace", k8sNamespace, "pod-security.kubernetes.io/enforce: restricted", "restricted pod security enforcement");
  requireText("k8s-namespace", k8sNamespace, "pod-security.kubernetes.io/audit: restricted", "restricted pod security audit");
  requireText("k8s-namespace", k8sNamespace, "pod-security.kubernetes.io/warn: restricted", "restricted pod security warnings");

  requireText("k8s-gateway", k8sGateway, "replicas: 2", "gateway must run with multiple replicas by default");
  requireText("k8s-gateway", k8sGateway, "readinessProbe:", "Kubernetes readiness probe");
  requireText("k8s-gateway", k8sGateway, "path: /ready", "Kubernetes readiness must use /ready");
  requireText("k8s-gateway", k8sGateway, "livenessProbe:", "Kubernetes liveness probe");
  requireText("k8s-gateway", k8sGateway, "path: /health", "Kubernetes liveness must use /health");
  requireText("k8s-gateway", k8sGateway, "resources:", "Kubernetes resource requests/limits");
  requireText("k8s-gateway", k8sGateway, "allowPrivilegeEscalation: false", "container privilege escalation disabled");
  requireText("k8s-gateway", k8sGateway, "runAsNonRoot: true", "pod must run as non-root");
  requireText("k8s-gateway", k8sGateway, "envFrom:", "gateway consumes ConfigMap/Secret deployment contract");
  requireText("k8s-gateway", k8sGateway, "PodDisruptionBudget", "gateway disruption budget");
  requireText("k8s-gateway", k8sGateway, "labels:\n    app: http-gateway", "gateway service is label-selectable for monitoring");

  for (const service of [
    "meta-authority-registry",
    "policy-compiler",
    "evidence-ledger",
    "authority-router",
    "witness-service",
    "execution-gate",
    "governance-kernel",
    "simulation-engine",
    "agent-os",
  ]) {
    requireText("k8s-control-plane", k8sControlPlane, `name: ${service}`, `${service} deployment/service present`);
  }
  requireText("k8s-control-plane", k8sControlPlane, "GOVERNANCE_CHAIN_MODE: \"enforce\"", "production chain mode is enforce");
  requireRegex("k8s-control-plane", k8sControlPlane, /GATEWAY_CRITICAL_SERVICES[\s\S]+governance-kernel/, "critical governance services configured");
  requireText("k8s-control-plane", k8sControlPlane, "EVIDENCE_LEDGER_STATE_PATH: \"/var/lib/aristotle/evidence-ledger.json\"", "durable ledger state path");
  requireText("k8s-control-plane", k8sControlPlane, "GOVERNANCE_CHAIN_STATE_PATH: \"/var/lib/aristotle/governance-chain.json\"", "durable chain state path");
  requireText("k8s-control-plane", k8sControlPlane, "AGENT_OS_STATE_PATH: \"/var/lib/aristotle/agent-os.json\"", "durable agent-os state path");
  requireText("k8s-control-plane", k8sControlPlane, "PersistentVolumeClaim", "durable PVCs");
  requireText("k8s-control-plane", k8sControlPlane, "envFrom:", "service ConfigMap/Secret injection");
  requireText("k8s-control-plane", k8sControlPlane, "runAsNonRoot: true", "non-root control-plane pods");
  requireText("k8s-control-plane", k8sControlPlane, "allowPrivilegeEscalation: false", "control-plane privilege escalation disabled");

  requireText("k8s-network-policy", k8sNetworkPolicy, "name: default-deny-ingress", "default deny ingress baseline");
  requireText("k8s-network-policy", k8sNetworkPolicy, "name: allow-gateway-ingress", "gateway is the explicit ingress boundary");
  requireText("k8s-network-policy", k8sNetworkPolicy, "name: allow-governance-control-plane", "control-plane east-west traffic is explicit");
  requireText("k8s-network-policy", k8sNetworkPolicy, "name: allow-monitoring-scrape", "monitoring scrape ingress is explicit");
  requireText("k8s-network-policy", k8sNetworkPolicy, "port: 7001", "governance-kernel network allowance");
  requireText("k8s-network-policy", k8sNetworkPolicy, "port: 7008", "execution-gate network allowance");

  requireText("k8s-observability", k8sObservability, "kind: ServiceMonitor", "Prometheus scrape contract");
  requireText("k8s-observability", k8sObservability, "path: /metrics", "gateway metrics scrape path");
  requireText("k8s-observability", k8sObservability, "kind: PrometheusRule", "Prometheus alert contract");
  requireText("k8s-observability", k8sObservability, "AristotleGatewayFailClosed", "fail-closed alert");
  requireText("k8s-observability", k8sObservability, "AristotleCriticalGovernanceUpstreamDown", "critical upstream alert");
  requireText("k8s-observability", k8sObservability, "AristotleGovernanceHaltActive", "sovereign halt alert");
  requireText("k8s-observability", k8sObservability, "aristotle_upstream_latency_ms > 1500", "latency degradation alert");

  requireText("helm-chart", helmChart, "name: aristotle-governance-os", "Helm chart identity");
  requireText("helm-chart", helmChart, "version: 0.1.0", "Helm chart version");
  requireText("helm-values", helmValues, "tag: \"0.1.0\"", "Helm chart uses real default image tag, not latest");
  requireText("helm-values", helmValues, "GOVERNANCE_CHAIN_MODE: \"enforce\"", "Helm production chain mode is enforce");
  requireText("helm-values", helmValues, "PORT_GATEWAY: \"8080\"", "Helm canonical gateway port env");
  requireText("helm-values", helmValues, "PORT_EXECUTION_GATE: \"7008\"", "Helm canonical execution gate port env");
  requireText("helm-values", helmValues, "gatewayBaseUrl: \"http://http-gateway:8080\"", "Helm console gateway proxy config");
  requireText("helm-values", helmValues, "playground: /try", "Helm public playground route");
  requireText("helm-values", helmValues, "ingress:", "Helm optional ingress config");
  requireText("helm-values", helmValues, "exporterEndpoint:", "Helm OpenTelemetry endpoint config");
  requireText("helm-values", helmValues, "socketPath:", "Helm SPIFFE socket config");
  requireText("helm-values", helmValues, "csiDriver: \"csi.spiffe.io\"", "Helm SPIFFE CSI driver config");
  requireText("helm-deployments", helmDeployments, "image: {{ include \"aristotle.image\"", "Helm image tag helper");
  requireText("helm-deployments", helmDeployments, "OTEL_SERVICE_NAME", "Helm service-level OTel naming");
  requireText("helm-deployments", helmDeployments, "spiffe-workload-api", "Helm SPIFFE Workload API mount");
  requireText("helm-deployments", helmDeployments, "driver: {{ $.Values.identity.spiffe.csiDriver | quote }}", "Helm SPIFFE CSI volume");
  forbidText("helm-deployments", helmDeployments, "hostPath:", "Helm SPIFFE integration must not require hostPath under restricted Pod Security");
  requireText("helm-console", helmConsole, "CONSOLE_GATEWAY_BASE_URL", "Helm console proxies to gateway");
  requireText("helm-console", helmConsole, "/console-health", "Helm console readiness probe");
  requireText("helm-ingress", helmIngress, "kind: Ingress", "Helm optional ingress");
  requireText("helm-network-policy", helmNetworkPolicy, "default-deny-ingress", "Helm default deny ingress");
  requireText("helm-network-policy", helmNetworkPolicy, "allow-console-ingress", "Helm console ingress network allowance");
  requireText("helm-observability", helmObservability, "kind: ServiceMonitor", "Helm ServiceMonitor");
  requireText("helm-observability", helmObservability, "kind: PrometheusRule", "Helm PrometheusRule");
  requireText("helm-spiffe-values", spiffeValues, "identity:", "SPIFFE values overlay");
  requireText("helm-spiffe-values", spiffeValues, "sidecar.istio.io/inject", "mTLS mesh injection example");
  requireText("pilot-install", pilotInstall, "helm", "one-command Helm installer");
  requireText("pilot-install", pilotInstall, "OPERATOR_API_KEY", "installer requires operator secret");
  requireText("pilot-install", pilotInstall, "GOVERNANCE_CHAIN_SIGNING_SECRET", "installer requires chain signing secret");
  requireText("pilot-install", pilotInstall, "http://127.0.0.1:4173/try", "installer prints playground URL");
  requireText("pilot-install", pilotInstall, "\"app.kubernetes.io/managed-by\": \"Helm\"", "installer namespace can be adopted by Helm");
  requireText("pilot-install", pilotInstall, "\"meta.helm.sh/release-name\": args.release", "installer namespace release ownership annotation");
  requireText("k8s-smoke-install", k8sSmokeInstall, "kind", "kind smoke runtime support");
  requireText("k8s-smoke-install", k8sSmokeInstall, "minikube", "minikube smoke runtime support");
  requireText("k8s-smoke-install", k8sSmokeInstall, "payments-refund-8000", "payments Ward/Warrant smoke scenario");
  requireText("k8s-smoke-install", k8sSmokeInstall, "DEFER", "smoke verifies defer before execution");
  requireText("k8s-smoke-install", k8sSmokeInstall, "single-use warrant", "smoke verifies one-time warrant issuance");
  requireText("k8s-smoke-install", k8sSmokeInstall, "MISSING_AUTHORITY_BINDING", "smoke verifies fail-closed missing authority");
  requireText("k8s-smoke-install", k8sSmokeInstall, "cluster:api", "smoke verifies Kubernetes API reachability before port-forwarding");
  requireText("k8s-smoke-install", k8sSmokeInstall, "reports/k8s-smoke-report.json", "smoke writes machine-readable report");
  requireText("pilot-images", pilotImages, "pilot images must use an immutable tag, not latest", "immutable pilot image tag guard");
  requireText("pilot-images", pilotImages, "manifests/docker/service.Dockerfile", "service image build contract");
  requireText("pilot-images", pilotImages, "manifests/docker/console-ui.Dockerfile", "console image build contract");
  requireText("pilot-docs", pilotDocs, "One-Command Install", "pilot one-command install documentation");
  requireText("pilot-docs", pilotDocs, "Local Kubernetes Smoke Install", "pilot kind/minikube smoke documentation");
  requireText("pilot-docs", pilotDocs, "SPIFFE / mTLS Story", "pilot SPIFFE/mTLS documentation");
  requireText("pilot-docs", pilotDocs, "OpenTelemetry Traces", "pilot OpenTelemetry documentation");
  requireText("pilot-docs", pilotDocs, "Operator Workflow", "pilot operator workflow documentation");
  requireText("pilot-docs", pilotDocs, "Optional Ingress", "pilot ingress documentation");
  requireText("pilot-docs", pilotDocs, "CONSOLE_GATEWAY_BASE_URL", "pilot console gateway proxy documentation");
  requireText("package-json", packageJson, "\"pilot:smoke\"", "package exposes Kubernetes smoke install command");
  requireText("package-json", packageJson, "\"pilot:smoke:kind\"", "package exposes kind smoke command");
  requireText("package-json", packageJson, "\"pilot:smoke:minikube\"", "package exposes minikube smoke command");

  for (const secretName of ["OPERATOR_API_KEY", "OPERATOR_SESSION_SECRET", "EVIDENCE_LEDGER_SIGNING_SECRET", "GOVERNANCE_CHAIN_SIGNING_SECRET"]) {
    requireText("k8s-secrets-example", k8sSecretsExample, secretName, `${secretName} secret contract`);
  }

  requireText("runbook", runbook, "Gateway readiness: `GET /ready`", "runbook readiness documentation");
  requireText("runbook", runbook, "Gateway metrics: `GET /metrics`", "runbook metrics documentation");
  requireText("runbook", runbook, "aristotle_gateway_ready", "runbook Prometheus readiness gauge");
  requireText("runbook", runbook, "AristotleGatewayFailClosed", "runbook fail-closed alert documentation");
  requireText("runbook", runbook, "pilot:install", "runbook pilot install path");

  console.log(`[contracts] deployment contracts passed (${checks.length} checks)`);
}

main().catch((error) => {
  console.error("[contracts] deployment contracts failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
