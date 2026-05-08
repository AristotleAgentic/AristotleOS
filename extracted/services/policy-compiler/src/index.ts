import { createApp, id, now } from "./lib.js";

const port = Number(process.env.PORT_POLICY_COMPILER ?? 7002);
const app = createApp();

type CompileOutput = {
  compileId: string;
  timestamp: string;
  policyName: string;
  valid: boolean;
  graph: { nodes: string[]; edges: Array<{ from: string; to: string; rule: string }> };
  admissibilityRules: string[];
  errors: string[];
};

app.get("/health", (_req, res) => res.json({ ok: true, service: "policy-compiler" }));
app.post("/compile", (req, res) => {
  const { policyName, policyText } = req.body as { policyName: string; policyText: string };
  const lines = (policyText || "").split("\n").map(l => l.trim()).filter(Boolean);
  const errors = lines.some(l => !l.includes(":")) ? ["All policy lines must use key:value form"] : [];
  const out: CompileOutput = {
    compileId: id("compile"),
    timestamp: now(),
    policyName,
    valid: errors.length === 0,
    graph: {
      nodes: ["meta-authority", "authority", "witness", "execution", "ledger"],
      edges: [
        { from: "meta-authority", to: "authority", rule: "issuer delegation" },
        { from: "authority", to: "witness", rule: "high-stakes witness obligation" },
        { from: "witness", to: "execution", rule: "quorum satisfied" },
        { from: "execution", to: "ledger", rule: "portable receipt required" }
      ]
    },
    admissibilityRules: lines.map(l => l.replace(/:.*/, "")).slice(0, 12),
    errors
  };
  res.json(out);
});

app.listen(port, () => console.log(`policy-compiler on ${port}`));
