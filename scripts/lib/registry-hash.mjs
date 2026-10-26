// The registry hash a web export bakes in: sha256 (hex) of generated/registry.json read as UTF-8 text, exactly what the daemon computes (modules/mcp/projections.ts registryHash).
// generated/hash.txt is gone (per-manifest snapshots), so the app reads this at build time as EXPO_PUBLIC_VYRE_REGISTRY_HASH and sends it in hello.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** @param {string} [repo] */
export function registryHash(repo = REPO) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(repo, "generated/registry.json"), "utf8")).digest("hex");
}

/** Environment for `expo export`: the process env plus the registry hash. @param {Record<string, string | undefined>} [extra] */
export function exportEnv(extra = {}) {
  return { ...process.env, CI: "1", EXPO_NO_TELEMETRY: "1", EXPO_PUBLIC_VYRE_REGISTRY_HASH: registryHash(), ...extra };
}
