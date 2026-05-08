import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateKeyPairSync } from "node:crypto";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.join(repoRoot, "secrets");

mkdirSync(outputDir, { recursive: true });

const { privateKey, publicKey } = generateKeyPairSync("ed25519");

const privateKeyPath = path.join(outputDir, "ledger-ed25519-private.pem");
const publicKeyPath = path.join(outputDir, "ledger-ed25519-public.pem");

writeFileSync(
  privateKeyPath,
  privateKey.export({
    type: "pkcs8",
    format: "pem"
  }),
  "utf8"
);

writeFileSync(
  publicKeyPath,
  publicKey.export({
    type: "spki",
    format: "pem"
  }),
  "utf8"
);

console.log(`[keys] private=${privateKeyPath}`);
console.log(`[keys] public=${publicKeyPath}`);
