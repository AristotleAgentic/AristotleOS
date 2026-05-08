import { createApp, id, now } from "./lib.js";
import type { WitnessReceipt } from "@aristotle/shared-types";

const port = Number(process.env.PORT_WITNESS_SERVICE ?? 7007);
const quorumDefault = Number(process.env.WITNESS_QUORUM ?? 2);
const app = createApp();
const receipts = new Map<string, WitnessReceipt>();

app.get("/health", (_req, res) => res.json({ ok: true, service: "witness-service" }));
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

app.listen(port, () => console.log(`witness-service on ${port}`));
