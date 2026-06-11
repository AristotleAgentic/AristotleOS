import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateKeyPairSync } from "node:crypto";

// Generate an Ed25519 signing keypair for the GOVERNANCE_CHAIN_V2 chain (the
// kernel signs MAE/Ward/Envelope/Warrant + GEL records with it). Mirrors
// generate-ledger-keypair.mjs so the Ward chain has the same BYO trust-root story
// as the evidence ledger.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : path.join(repoRoot, "secrets");

mkdirSync(outputDir, { recursive: true });

const { privateKey, publicKey } = generateKeyPairSync("ed25519");

const privateKeyPath = path.join(outputDir, "governance-chain-ed25519-private.pem");
const publicKeyPath = path.join(outputDir, "governance-chain-ed25519-public.pem");

writeFileSync(privateKeyPath, privateKey.export({ type: "pkcs8", format: "pem" }), "utf8");
writeFileSync(publicKeyPath, publicKey.export({ type: "spki", format: "pem" }), "utf8");

console.log(`[chain-keys] private=${privateKeyPath}`);
console.log(`[chain-keys] public=${publicKeyPath}`);
console.log("[chain-keys] set GOVERNANCE_CHAIN_SIGNING_PRIVATE_KEY_PATH and GOVERNANCE_CHAIN_SIGNING_PUBLIC_KEY_PATH to these paths.");
