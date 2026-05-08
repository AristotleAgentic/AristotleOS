import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
const rootEnvPath = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(rootEnvPath)) {
    process.loadEnvFile?.(rootEnvPath);
}
export const createApp = () => {
    const app = express();
    app.use(cors());
    app.use(express.json({ limit: "2mb" }));
    return app;
};
export const now = () => new Date().toISOString();
export const id = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
