const gatewayBaseUrl = process.env.GATEWAY_BASE_URL ?? "http://localhost:8080";
const consoleBaseUrl = process.env.CONSOLE_BASE_URL ?? "http://localhost:4173";
const operatorApiKey = process.env.OPERATOR_API_KEY?.trim();
const operatorActor = process.env.OPERATOR_ACTOR?.trim();
const operatorRole = process.env.OPERATOR_ROLE?.trim();
let operatorSessionToken = "";
let operatorSessionExpiresAt = 0;

const toGatewayUrl = (path) => `${gatewayBaseUrl}${path}`;
const toConsoleUrl = (path = "/") => `${consoleBaseUrl}${path}`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function requestJson(url, init) {
  const headers = new Headers(init?.headers);
  const sessionToken = await ensureOperatorSession();
  if (sessionToken && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${sessionToken}`);
  }
  if (operatorActor && !headers.has("x-operator-actor")) {
    headers.set("x-operator-actor", operatorActor);
  }
  if (operatorRole && !headers.has("x-operator-role")) {
    headers.set("x-operator-role", operatorRole);
  }
  const response = await fetch(url, { ...init, headers });
  const text = await response.text().catch(() => "");
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: response.ok, status: response.status, json, text };
}

async function ensureOperatorSession() {
  if (!operatorApiKey || !operatorActor || !operatorRole) {
    return "";
  }
  if (operatorSessionToken && operatorSessionExpiresAt > Date.now() + 30_000) {
    return operatorSessionToken;
  }
  const headers = new Headers();
  headers.set("x-operator-key", operatorApiKey);
  headers.set("x-operator-actor", operatorActor);
  headers.set("x-operator-role", operatorRole);
  const response = await fetch(toGatewayUrl("/operator/auth/session"), {
    method: "POST",
    headers
  });
  if (!response.ok) {
    return "";
  }
  const session = await response.json();
  operatorSessionToken = session.token ?? "";
  operatorSessionExpiresAt = Date.parse(session.expiresAt ?? "") || 0;
  return operatorSessionToken;
}

async function requestText(url, init) {
  const response = await fetch(url, init);
  const text = await response.text().catch(() => "");
  return { ok: response.ok, status: response.status, text };
}

async function main() {
  console.log(`[stack] checking gateway ${gatewayBaseUrl}`);
  const gatewayHealth = await requestJson(toGatewayUrl("/health"));
  assert(gatewayHealth.ok, `gateway health failed with ${gatewayHealth.status}`);
  assert(gatewayHealth.json?.ok === true, "gateway health payload not ok");
  assert(gatewayHealth.json?.preflight?.ok === true, "gateway preflight not ok");
  console.log("[stack] gateway health and preflight ok");

  const deploymentPosture = await requestJson(toGatewayUrl("/operator/deployment/posture"));
  assert(deploymentPosture.ok, `/operator/deployment/posture failed with ${deploymentPosture.status}`);
  assert(deploymentPosture.json?.preflight?.ok === true, "deployment posture preflight not ok");
  assert(typeof deploymentPosture.json?.serviceDiscoveryMode === "string", "deployment posture missing service discovery mode");
  assert(typeof deploymentPosture.json?.operatorAuthEnabled === "boolean", "deployment posture missing operator auth state");
  assert(typeof deploymentPosture.json?.roleEnforcementEnabled === "boolean", "deployment posture missing role enforcement state");
  console.log(
    `[stack] deployment posture ok (${deploymentPosture.json.mode}, auth=${deploymentPosture.json.operatorAuthEnabled}, rbac=${deploymentPosture.json.roleEnforcementEnabled})`
  );
  if (Array.isArray(deploymentPosture.json?.readActors) && deploymentPosture.json.readActors.length > 0) {
    const deniedActor = await requestJson(toGatewayUrl("/operator/auth/session"), {
      method: "POST",
      headers: {
        authorization: "",
        "x-operator-key": operatorApiKey ?? "",
        "x-operator-actor": "unauthorized-smoke-actor",
        "x-operator-role": operatorRole ?? "operator"
      }
    });
    assert(deniedActor.status === 403, `expected actor allowlist rejection, got ${deniedActor.status}`);
    assert(deniedActor.json?.error === "operator_actor_forbidden", "unexpected actor allowlist error code");
    console.log("[stack] actor allowlist enforcement ok");
  }

  const deployables = await requestJson(toGatewayUrl("/operator/deployables"));
  assert(deployables.ok, `/operator/deployables failed with ${deployables.status}`);
  assert(Array.isArray(deployables.json?.items), "deployables catalog missing items");
  assert(deployables.json.items.length >= 5, "deployables catalog missing enterprise surfaces");
  console.log(`[stack] deployable catalog ok (${deployables.json.items.length} surfaces)`);

  const operatorState = await requestJson(toGatewayUrl("/operator/os/state"));
  assert(operatorState.ok, `/operator/os/state failed with ${operatorState.status}`);
  assert(Array.isArray(operatorState.json?.missions), "operator state missing missions");
  console.log("[stack] operator plane reachable");

  const assurance = await requestJson(toGatewayUrl("/operator/assurance/report"));
  assert(assurance.ok, `/operator/assurance/report failed with ${assurance.status}`);
  assert(typeof assurance.json?.systemPosture === "string", "assurance report missing system posture");
  console.log(`[stack] assurance report ok (${assurance.json.systemPosture})`);

  const chainGel = await requestJson(toGatewayUrl("/operator/governance-chain/gel"));
  if (chainGel.status === 501) {
    console.log("[stack] governance chain (v2) disabled — skipping chain reachability check");
  } else {
    assert(chainGel.ok, `/operator/governance-chain/gel failed with ${chainGel.status}`);
    assert(chainGel.json?.integrity?.ok === true, "governance chain integrity check failed");
    console.log(`[stack] governance chain reachable (${chainGel.json.count ?? 0} GEL records, integrity ok)`);
  }

  console.log(`[stack] checking console ${consoleBaseUrl}`);
  const consoleIndex = await requestText(toConsoleUrl("/"));
  assert(consoleIndex.ok, `console index failed with ${consoleIndex.status}`);
  assert(consoleIndex.text.includes("<!doctype html") || consoleIndex.text.includes("<!DOCTYPE html"), "console did not return html");
  console.log("[stack] console reachable");

  console.log("[stack] deployment smoke validation passed");
}

main().catch((error) => {
  console.error("[stack] deployment smoke validation failed");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
