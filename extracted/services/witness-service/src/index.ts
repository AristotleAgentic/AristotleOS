import { createApp, id, now } from "./lib.js";
import type { WitnessReceipt } from "@aristotle/shared-types";
import { WitnessNode, type NodeId, type MeshMessage } from "@aristotle/mesh-runtime";
import { ReadinessChecks, mountHealthEndpoints } from "@aristotle/service-runtime";

const port = Number(process.env.PORT_WITNESS_SERVICE ?? 7007);
const quorumDefault = Number(process.env.WITNESS_QUORUM ?? 2);
const app = createApp();
const receipts = new Map<string, WitnessReceipt>();

app.post("/verify", (req, res) => {
  const { warrantId, envelopeId, requestedWitnesses = ["node.attest.1", "node.attest.2"], quorumRequired = quorumDefault } = req.body;
  const quorumReached = requestedWitnesses.length;
  const receipt: WitnessReceipt = {
    id: id("wrc"),
    artifactType: "witness-receipt",
    timestamp: now(),
    actor: "witness-service",
    warrantId,
    envelopeId,
    quorumRequired,
    quorumReached,
    witnesses: requestedWitnesses,
    accepted: quorumReached >= quorumRequired,
    verification: { status: quorumReached >= quorumRequired ? "verified" : "failed", verifier: "witness-service" }
  };
  receipts.set(receipt.id, receipt);
  res.json(receipt);
});
app.get("/receipts/:id", (req, res) => {
  const receipt = receipts.get(req.params.id);
  if (!receipt) return res.status(404).json({ error: "not_found" });
  res.json(receipt);
});

// ---------------------------------------------------------------------------
// Substrate-backed WitnessNode (mesh-runtime)
//
// This service also acts as a mesh WITNESS: it mirrors envelope state
// from the root and re-gossips revocations to edge peers. Communicates
// via a `/mesh` POST route on this port.
// ---------------------------------------------------------------------------

const meshSecret = process.env.MESH_SECRET ?? "aos-demo-mesh-secret";
const meshHost = process.env.HOST_WITNESS_SERVICE ?? "127.0.0.1";
const witness = new WitnessNode({
  id: process.env.MESH_WITNESS_ID ?? "witness-mae",
  host: meshHost,
  port,
  secret: meshSecret,
  urlFor: (t: NodeId) => `http://${t.host}:${t.port}/mesh`
});

const peerSpec = process.env.MESH_PEERS ?? "root-mae:127.0.0.1:7004,edge-aos:127.0.0.1:7009";
const peers: NodeId[] = peerSpec
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((spec) => {
    const [pid, phost, pportStr] = spec.split(":");
    return {
      id: pid,
      role: pid.startsWith("edge")
        ? ("edge" as const)
        : pid.startsWith("witness")
          ? ("witness" as const)
          : ("root" as const),
      host: phost,
      port: Number(pportStr)
    };
  });
witness.setPeers(peers);

// /health + /healthz + /readyz mounted via the shared service-runtime
// helper after the WitnessNode + peers are constructed so the readiness
// closure can reference them. Checks: mesh signer constructed + at
// least one peer configured + MESH_SECRET is not a known demo string.
mountHealthEndpoints(app, {
  service: "witness-service",
  readiness: () => ReadinessChecks.start()
    .addTry("mesh_signer", () => typeof witness.getId() === "string")
    .addPeersConfiguredCheck(peers.length)
    .addDemoSecretCheck(meshSecret)
    .build()
});

app.post("/mesh", async (req, res) => {
  try {
    const msg = req.body as MeshMessage;
    if (msg.from && witness.partitions.has(msg.from)) {
      return res.status(504).json({ ok: false, reason: "partitioned" });
    }
    const out = await witness.direct(msg);
    res.json(out);
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/v1/mesh/state", (_req, res) => {
  res.json({
    ok: true,
    role: "witness",
    node_id: witness.getId(),
    peers,
    cached_envelopes: witness.cachedEnvelopeCount(),
    cached_revocations: witness.cachedRevocationCount(),
    partitions: [...witness.partitions]
  });
});

app.listen(port, () => console.log(`witness-service on ${port} (substrate-wired: WitnessNode at /mesh, /v1/mesh/state)`));
