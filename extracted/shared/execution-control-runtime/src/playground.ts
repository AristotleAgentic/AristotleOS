/**
 * Self-contained, no-install playground for the AristotleOS execution-control
 * boundary. Served by the live runtime, so every decision shown is produced by
 * the same code path as production — no browser reimplementation.
 */
export const PLAYGROUND_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>AristotleOS Playground</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: #0b0f17; color: #e6edf3; }
  header { padding: 20px 24px; border-bottom: 1px solid #1f2733; }
  header h1 { margin: 0; font-size: 18px; letter-spacing: .2px; }
  header p { margin: 4px 0 0; color: #8b98a9; font-size: 13px; }
  main { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 16px 24px; max-width: 1100px; }
  @media (max-width: 820px) { main { grid-template-columns: 1fr; } }
  .card { background: #111824; border: 1px solid #1f2733; border-radius: 10px; padding: 16px; }
  .card h2 { margin: 0 0 10px; font-size: 13px; text-transform: uppercase; letter-spacing: .8px; color: #8b98a9; }
  textarea { width: 100%; height: 230px; background: #0b0f17; color: #d7e2ee; border: 1px solid #243040; border-radius: 8px; padding: 10px; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; resize: vertical; }
  button { background: #2563eb; color: white; border: 0; border-radius: 8px; padding: 9px 14px; font-weight: 600; cursor: pointer; }
  button.secondary { background: #1f2733; color: #d7e2ee; }
  .presets { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
  .presets button { background: #1a2230; color: #c7d3e0; font-weight: 500; font-size: 13px; padding: 6px 10px; }
  .row { display: flex; gap: 10px; align-items: center; margin-top: 12px; }
  .decision { font-size: 22px; font-weight: 700; }
  .ALLOW { color: #34d399; } .REFUSE { color: #f87171; } .ESCALATE { color: #fbbf24; }
  pre { white-space: pre-wrap; word-break: break-word; background: #0b0f17; border: 1px solid #243040; border-radius: 8px; padding: 10px; font: 12px/1.5 ui-monospace, monospace; color: #aebacb; max-height: 320px; overflow: auto; }
  .ctx span { display: inline-block; background: #1a2230; border: 1px solid #243040; border-radius: 999px; padding: 2px 10px; margin: 2px 4px 2px 0; font-size: 12px; }
  .muted { color: #8b98a9; font-size: 12px; }
  code { color: #93c5fd; }
</style>
</head>
<body>
<header>
  <h1>AristotleOS &mdash; Execution-Control Playground</h1>
  <p>Edit a Canonical Governed Action and see the live Commit Gate decision, signed Warrant, and Governance Evidence Ledger record.</p>
</header>
<main>
  <section class="card">
    <h2>Governance context (live boundary)</h2>
    <div id="ctx" class="ctx muted">loading&hellip;</div>
    <h2 style="margin-top:16px">Proposed action</h2>
    <div class="presets">
      <button data-preset="allow" class="secondary">ALLOW: takeoff</button>
      <button data-preset="refuse" class="secondary">REFUSE: disable geofence</button>
      <button data-preset="escalate" class="secondary">ESCALATE: missing telemetry</button>
    </div>
    <textarea id="action" spellcheck="false"></textarea>
    <div class="row">
      <button id="evaluate">Evaluate at Commit Gate</button>
      <button id="verify" class="secondary">Verify ledger</button>
    </div>
  </section>
  <section class="card">
    <h2>Decision</h2>
    <div id="decision" class="decision muted">&mdash;</div>
    <div id="reasons" class="muted"></div>
    <h2 style="margin-top:16px">Result</h2>
    <pre id="result">Run an evaluation to see the Warrant and GEL record.</pre>
  </section>
</main>
<script>
const presets = {
  allow: { action_type: "drone.takeoff", params: { altitude_m: 60, boundary_id: "CTX_BOUNDARY", battery_pct: 88 }, telemetry: { gps_lock: true } },
  refuse: { action_type: "drone.disable_geofence", params: { altitude_m: 60, boundary_id: "CTX_BOUNDARY", battery_pct: 88 }, telemetry: { gps_lock: true } },
  escalate: { action_type: "drone.takeoff", params: { altitude_m: 60, boundary_id: "CTX_BOUNDARY", battery_pct: 88 } }
};
let ctx = { ward_id: "ward", subject: "agent", allowed_actions: [], denied_actions: [], boundary_id: "" };

function buildAction(preset) {
  const p = presets[preset] || presets.allow;
  const boundary = ctx.boundary_id || "zone";
  const params = JSON.parse(JSON.stringify(p.params));
  if (params.boundary_id === "CTX_BOUNDARY") params.boundary_id = boundary;
  return {
    action_id: "act-" + Date.now(),
    ward_id: ctx.ward_id,
    subject: ctx.subject,
    action_type: p.action_type,
    target: "playground/unit-1",
    params,
    requested_at: new Date().toISOString(),
    ...(p.telemetry ? { telemetry: p.telemetry } : {})
  };
}

async function loadContext() {
  try {
    const res = await fetch("/v1/execution-control/context");
    ctx = await res.json();
    document.getElementById("ctx").innerHTML =
      "<span>Ward: " + ctx.ward_id + "</span>" +
      "<span>Subject: " + ctx.subject + "</span>" +
      ctx.allowed_actions.map(a => "<span>allow: " + a + "</span>").join("") +
      ctx.denied_actions.map(a => "<span>deny: " + a + "</span>").join("") +
      "<span>key: " + (ctx.signing_key_id || "") + "</span>";
    document.getElementById("action").value = JSON.stringify(buildAction("allow"), null, 2);
  } catch (e) {
    document.getElementById("ctx").textContent = "could not load context: " + e;
  }
}

async function evaluate() {
  const decisionEl = document.getElementById("decision");
  const reasonsEl = document.getElementById("reasons");
  const resultEl = document.getElementById("result");
  let action;
  try { action = JSON.parse(document.getElementById("action").value); }
  catch (e) { resultEl.textContent = "Invalid action JSON: " + e; return; }
  const res = await fetch("/v1/execution-control/evaluate", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action })
  });
  const data = await res.json();
  decisionEl.className = "decision " + (data.decision || "");
  decisionEl.textContent = data.decision || "ERROR";
  reasonsEl.textContent = (data.reason_codes || []).join(", ");
  resultEl.textContent = JSON.stringify({
    canonical_action_hash: data.canonical_action_hash,
    warrant: data.warrant ? {
      warrant_id: data.warrant.warrant_id,
      signing_key_id: data.warrant.signing_key_id,
      signature: (data.warrant.signature || "").slice(0, 32) + "…",
      expires_at: data.warrant.expires_at
    } : null,
    gel_record_hash: data.gel_record && data.gel_record.record_hash,
    ledger_verification: data.ledger_verification
  }, null, 2);
}

async function verify() {
  const res = await fetch("/v1/execution-control/audit/verify");
  document.getElementById("result").textContent = JSON.stringify(await res.json(), null, 2);
}

document.querySelectorAll("[data-preset]").forEach(b =>
  b.addEventListener("click", () => { document.getElementById("action").value = JSON.stringify(buildAction(b.dataset.preset), null, 2); }));
document.getElementById("evaluate").addEventListener("click", evaluate);
document.getElementById("verify").addEventListener("click", verify);
loadContext();
</script>
</body>
</html>
`;
