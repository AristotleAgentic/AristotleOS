import { createApp } from "./lib.js";
import { StaticSovereignRouter, type NodeId, type TrustAnchor } from "@aristotle/mesh-runtime";

const port = Number(process.env.PORT_AUTHORITY_ROUTER ?? 7006);
const app = createApp();

type RouteRequest = {
  source: string;
  target: string;
  domain?: string;
  phase?: "dispatch" | "tool-action" | "completion";
  degradedNodes?: string[];
  riskLevel?: "low" | "medium" | "high";
  requiredAuthorities?: string[];
};

app.get("/health", (_req, res) => res.json({ ok: true, service: "authority-router" }));
app.post("/route", (req, res) => {
  const {
    source,
    target,
    domain = "mission",
    phase = "dispatch",
    degradedNodes = [],
    riskLevel = "medium",
    requiredAuthorities = []
  } = req.body as RouteRequest;

  const relayByDomain =
    domain === "safety" || riskLevel === "high"
      ? "mesh.delta"
      : phase === "completion"
        ? "mesh.gamma"
        : phase === "tool-action"
          ? "mesh.beta"
          : "mesh.alpha";
  const alternateRelay = relayByDomain === "mesh.delta" ? "mesh.alpha" : "mesh.delta";
  const alternateAuthority = requiredAuthorities.find((authority) => authority !== source);
  const delegationAvailable = Boolean(alternateAuthority);
  const routeAffected = degradedNodes.includes(relayByDomain);
  const alternateAffected = degradedNodes.includes(alternateRelay);
  const disconnected = routeAffected && alternateAffected;
  const delegatedAuthorityAnchor = routeAffected && delegationAvailable ? alternateAuthority : source;
  const primary = [source, relayByDomain, target];
  const alternate = [delegatedAuthorityAnchor, alternateRelay, target];
  const selected = disconnected ? [] : routeAffected ? alternate : primary;
  const rejected = disconnected ? alternate : routeAffected ? primary : alternate;
  const authorityHint = requiredAuthorities.length ? `Authority chain anchored by ${requiredAuthorities[0]}` : "Authority chain inferred from issuer";
  const delegationReasoning = disconnected
    ? delegationAvailable
      ? `Delegated continuity candidate ${alternateAuthority} is available, but no admissible relay survives to carry the handoff.`
      : "No delegated authority lane is available for continuity handoff."
    : routeAffected
      ? delegationAvailable
        ? `Primary authority ${source} hands continuity to ${alternateAuthority} while ${relayByDomain} is degraded.`
        : `Primary authority ${source} retains control while rerouting around degraded relay ${relayByDomain}.`
      : `Primary authority ${source} remains the active constitutional anchor.`;
  const continuity = disconnected ? "disconnected" : routeAffected ? "degraded" : "stable";
  const continuityReasoning = disconnected
    ? `${authorityHint}. Primary relay ${relayByDomain} and failover relay ${alternateRelay} are degraded: ${degradedNodes.join(", ")}.`
    : routeAffected
      ? `${authorityHint}. Primary relay ${relayByDomain} degraded; failover relay ${alternateRelay} remains admissible.${delegationAvailable ? ` Delegated authority ${alternateAuthority} preserves cross-domain continuity.` : ""}`
      : `${authorityHint}. Authority continuity stable for ${domain} ${phase}.`;
  res.json({
    source,
    target,
    domain,
    phase,
    authorityAnchor: source,
    alternateAuthorityAnchor: alternateAuthority,
    delegatedAuthorityAnchor: disconnected ? undefined : delegatedAuthorityAnchor,
    selectedPath: selected,
    rejectedPath: rejected,
    degradedNodes,
    failoverReasoning: degradedNodes.length
      ? disconnected
        ? `${authorityHint}. No admissible relay remains because ${relayByDomain} and ${alternateRelay} are both degraded.`
        : routeAffected
        ? `${authorityHint}. Primary relay ${relayByDomain} degraded: ${degradedNodes.join(", ")}`
        : `${authorityHint}. Degraded nodes observed (${degradedNodes.join(", ")}) but primary relay ${relayByDomain} remains healthy.`
      : `${authorityHint}. Primary route healthy for ${domain} ${phase}.`,
    delegationReasoning,
    continuity,
    continuityReasoning,
    recoverable: disconnected || routeAffected,
    mode: disconnected ? "disconnected" : routeAffected ? "degraded" : "nominal"
  });
});

// ---------------------------------------------------------------------------
// Substrate-backed SovereignRouter (mesh-runtime)
//
// /v1/mesh/route uses the real StaticSovereignRouter from mesh-runtime
// to decide whether a request references a local MAE (handle locally)
// or a foreign MAE (route to a configured trust anchor).
//
// Trust anchors come from MESH_TRUST_ANCHORS env (mae_id:host:port,
// comma-separated). Default: the local mesh's root.
// ---------------------------------------------------------------------------

const localMaeId = process.env.MESH_LOCAL_MAE_ID ?? "mae.local.coalition";
const anchorSpec =
  process.env.MESH_TRUST_ANCHORS ??
  `${localMaeId}:127.0.0.1:7004`;

const trustAnchors: TrustAnchor[] = anchorSpec
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((spec) => {
    // Format: mae_id:host:port
    const [mae_id, host, portStr] = spec.split(":");
    const target: NodeId = {
      id: `root-${mae_id}`,
      role: "root",
      host,
      port: Number(portStr)
    };
    return { mae_id, target };
  });

const sovereignRouter = new StaticSovereignRouter(localMaeId, trustAnchors);

app.post("/v1/mesh/route", (req, res) => {
  const { mae_id } = req.body as { mae_id: string };
  if (!mae_id) return res.status(400).json({ ok: false, error: "missing_mae_id" });
  const isLocal = sovereignRouter.isLocal(mae_id);
  const anchor = sovereignRouter.route(mae_id);
  res.json({
    ok: true,
    mae_id,
    is_local: isLocal,
    anchor: anchor ?? null,
    explanation: isLocal
      ? `MAE ${mae_id} is local; handle in process.`
      : anchor
        ? `MAE ${mae_id} routes to anchor ${anchor.target.id} @ ${anchor.target.host}:${anchor.target.port}.`
        : `MAE ${mae_id} has no configured trust anchor; refuse.`
  });
});

app.get("/v1/mesh/anchors", (_req, res) => {
  res.json({
    ok: true,
    local_mae_id: localMaeId,
    anchors: trustAnchors.map((a) => ({
      mae_id: a.mae_id,
      target: a.target
    })),
    anchor_ids: sovereignRouter.anchorIds()
  });
});

app.listen(port, () => console.log(`authority-router on ${port} (substrate-wired: StaticSovereignRouter at /v1/mesh/*)`));
