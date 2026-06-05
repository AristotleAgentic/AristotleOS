import { createApp, id, now } from "./lib.js";
import type { MetaAuthorityArtifact } from "@aristotle/shared-types";
import { RootNode, type NodeId, type MeshMessage } from "@aristotle/mesh-runtime";
import { ReadinessChecks, mountHealthEndpoints } from "@aristotle/service-runtime";

const port = Number(process.env.PORT_META_AUTHORITY_REGISTRY ?? 7004);
const app = createApp();
const artifacts = new Map<string, MetaAuthorityArtifact>();

const seed: MetaAuthorityArtifact = {
  id: "maa-root-001",
  artifactType: "meta-authority-artifact",
  timestamp: now(),
  actor: "system.bootstrap",
  issuer: "system.bootstrap",
  subject: "coalition.core",
  domains: ["mission", "safety", "workspace", "repo", "ledger", "logistics"],
  delegationClass: "root",
  constraints: { mayMintAuthority: true },
  verification: { status: "verified", verifier: "bootstrap" }
};
artifacts.set(seed.id, seed);

const missionCommandSeed: MetaAuthorityArtifact = {
  id: "maa-mission-command-001",
  artifactType: "meta-authority-artifact",
  timestamp: now(),
  actor: "system.bootstrap",
  issuer: "coalition.core",
  subject: "mission.command",
  domains: ["mission", "workspace", "repo", "logistics"],
  delegationClass: "delegated",
  parentAuthorityId: seed.id,
  constraints: { mayMintAuthority: false, commitPointRequired: true },
  verification: { status: "verified", verifier: "bootstrap" }
};
artifacts.set(missionCommandSeed.id, missionCommandSeed);

const safetyCouncilSeed: MetaAuthorityArtifact = {
  id: "maa-safety-council-001",
  artifactType: "meta-authority-artifact",
  timestamp: now(),
  actor: "system.bootstrap",
  issuer: "coalition.core",
  subject: "safety.council",
  domains: ["safety"],
  delegationClass: "delegated",
  parentAuthorityId: seed.id,
  constraints: { mayMintAuthority: false, commitPointRequired: true, witnessRequired: true },
  verification: { status: "verified", verifier: "bootstrap" }
};
artifacts.set(safetyCouncilSeed.id, safetyCouncilSeed);

const evidenceStewardSeed: MetaAuthorityArtifact = {
  id: "maa-evidence-steward-001",
  artifactType: "meta-authority-artifact",
  timestamp: now(),
  actor: "system.bootstrap",
  issuer: "coalition.core",
  subject: "evidence.steward",
  domains: ["ledger"],
  delegationClass: "delegated",
  parentAuthorityId: seed.id,
  constraints: { mayMintAuthority: false, commitPointRequired: true },
  verification: { status: "verified", verifier: "bootstrap" }
};
artifacts.set(evidenceStewardSeed.id, evidenceStewardSeed);

// Health / readiness endpoints are mounted after the mesh root + peers
// are constructed (see below) so the readiness closure can reference
// them. We capture the service name here for use both in the legacy
// /health route and in the structured probe responses.
const SERVICE_NAME = "meta-authority-registry";
app.get("/artifacts", (_req, res) => res.json({ items: [...artifacts.values()] }));
app.get("/artifacts/:id", (req, res) => {
  const artifact = artifacts.get(req.params.id);
  if (!artifact) return res.status(404).json({ error: "not_found" });
  res.json(artifact);
});
app.post("/artifacts", (req, res) => {
  const body = req.body as Partial<MetaAuthorityArtifact>;
  const artifact: MetaAuthorityArtifact = {
    id: body.id ?? id("maa"),
    artifactType: "meta-authority-artifact",
    timestamp: now(),
    actor: body.actor ?? "unknown",
    issuer: body.issuer ?? body.actor ?? "unknown",
    subject: body.subject ?? "unknown",
    domains: body.domains ?? [],
    delegationClass: body.delegationClass ?? "delegated",
    parentAuthorityId: body.parentAuthorityId,
    constraints: body.constraints ?? {},
    verification: { status: "verified", verifier: "registry" }
  };
  artifacts.set(artifact.id, artifact);
  res.status(201).json(artifact);
});
app.post("/resolve", (req, res) => {
  const { issuer, domain } = req.body as { issuer: string; domain: string };
  const chain = [...artifacts.values()].filter(a => a.subject === issuer || a.actor === issuer);
  const allowed = chain.some(a => a.domains.includes(domain));
  res.json({
    issuer,
    domain,
    allowed,
    chain: chain.map(a => a.id),
    explanation: allowed ? `${issuer} is delegated for ${domain}` : `${issuer} lacks delegated authority for ${domain}`
  });
});

// ---------------------------------------------------------------------------
// Substrate-backed RootNode (mesh-runtime)
//
// This service also acts as the mesh ROOT: it issues AuthorityEnvelopes,
// Revocations, and Fluidity Tokens. Witnesses and edges talk to it
// via a `/mesh` POST route on this same port (no extra port allocation).
//
// Cross-service mesh wiring: each peer's NodeId carries host:port; we
// override `urlFor` so requests target `/mesh` on the peer's port.
// ---------------------------------------------------------------------------

const meshSecret = process.env.MESH_SECRET ?? "aos-demo-mesh-secret";
const meshHost = process.env.HOST_META_AUTHORITY_REGISTRY ?? "127.0.0.1";
const root = new RootNode({
  id: process.env.MESH_ROOT_ID ?? "root-mae",
  host: meshHost,
  port, // same port as the express server; routes share via /mesh
  secret: meshSecret,
  urlFor: (t: NodeId) => `http://${t.host}:${t.port}/mesh`
});

// Configure peers from env (comma-separated id:host:port triples).
// Default: just the standard witness on port 7007.
const peerSpec = process.env.MESH_PEERS ?? "witness-mae:127.0.0.1:7007,edge-aos:127.0.0.1:7009";
const peers: NodeId[] = peerSpec
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((spec) => {
    const [id, host, portStr] = spec.split(":");
    return {
      id,
      // Roles are inferred from id prefix; mesh-runtime accepts any role.
      role: id.startsWith("witness")
        ? ("witness" as const)
        : id.startsWith("edge")
          ? ("edge" as const)
          : ("root" as const),
      host,
      port: Number(portStr)
    };
  });
root.setPeers(peers);

// /healthz + /readyz mounted via the shared service-runtime helper.
// Readiness checks: mesh signer constructed + at least one peer
// configured + MESH_SECRET is not a known demo string.
mountHealthEndpoints(app, {
  service: SERVICE_NAME,
  readiness: () => ReadinessChecks.start()
    .addTry("mesh_signer", () => typeof root.getId() === "string")
    .addPeersConfiguredCheck(peers.length)
    .addDemoSecretCheck(meshSecret)
    .build()
});

// Mesh inter-node POST route.
app.post("/mesh", async (req, res) => {
  try {
    const msg = req.body as MeshMessage;
    if (msg.from && root.partitions.has(msg.from)) {
      return res.status(504).json({ ok: false, reason: "partitioned" });
    }
    const out = await root.direct(msg);
    res.json(out);
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// Operator-facing mesh control plane.
app.post("/v1/mesh/envelope", async (req, res) => {
  try {
    const { envelope_id, mae_id, ward_id, subject, allowed_action_types, expires_at, version } = req.body as {
      envelope_id: string;
      mae_id: string;
      ward_id: string;
      subject: string;
      allowed_action_types: string[];
      expires_at?: string;
      version?: number;
    };
    if (!envelope_id || !mae_id || !ward_id || !subject || !Array.isArray(allowed_action_types)) {
      return res.status(400).json({ ok: false, error: "missing_required_fields" });
    }
    const envelope = root.issueEnvelope({
      envelope_id,
      mae_id,
      ward_id,
      subject,
      allowed_action_types,
      expires_at: expires_at ?? new Date(Date.now() + 24 * 3600_000).toISOString(),
      version: version ?? 1
    });
    res.status(201).json({ ok: true, envelope });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/v1/mesh/revoke", async (req, res) => {
  try {
    const { target_id, kind, reason } = req.body as {
      target_id: string;
      kind?: "envelope" | "warrant" | "subject";
      reason?: string;
    };
    if (!target_id) return res.status(400).json({ ok: false, error: "missing_target_id" });
    const rev = await root.revoke(target_id, kind ?? "envelope", reason ?? "operator-revoke");
    res.status(201).json({ ok: true, revocation: rev });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/v1/mesh/fluidity-token", (req, res) => {
  try {
    const { edge_id, envelope_id, ttl_ms } = req.body as {
      edge_id: string;
      envelope_id: string;
      ttl_ms?: number;
    };
    if (!edge_id || !envelope_id) {
      return res.status(400).json({ ok: false, error: "missing_required_fields" });
    }
    const token = root.issueFluidityToken({
      edge_id,
      envelope_id,
      ttl_ms: ttl_ms ?? 60_000
    });
    res.status(201).json({ ok: true, token });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/v1/mesh/state", (_req, res) => {
  res.json({
    ok: true,
    role: "root",
    node_id: root.getId(),
    peers,
    partitions: [...root.partitions],
    submitted_edge_decisions: root.getSubmittedEdgeDecisions().length
  });
});

app.listen(port, () => console.log(`meta-authority-registry on ${port} (substrate-wired: RootNode at /mesh, /v1/mesh/*)`));
