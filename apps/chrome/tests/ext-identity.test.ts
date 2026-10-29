// The extension's identity: the manifest pins a public key, so the extension has the same id on every computer that loads it unpacked, and the native messaging host's manifest can name that id.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(HERE, "../manifest.json"), "utf8")) as { key?: string; version: string };

/** Chrome's id for a key: the first 32 hex digits of the SHA-256 of the DER public key, each digit written as a letter a to p. */
export function extensionId(keyBase64: string): string {
  return [...createHash("sha256").update(Buffer.from(keyBase64, "base64")).digest("hex").slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
}

test("the manifest pins a public key and the id it gives is the one the desktop app writes into the native host manifest", () => {
  assert.match(manifest.key ?? "", /^MIIB[A-Za-z0-9+/=]+$/, "an RSA public key in DER, base64");
  const id = extensionId(manifest.key!);
  assert.match(id, /^[a-p]{32}$/);
  const rust = fs.readFileSync(path.join(HERE, "../../desktop/src-tauri/src/chrome.rs"), "utf8");
  assert.ok(rust.includes(`pub const EXTENSION_ID: &str = "${id}";`), `chrome.rs names ${id}`);
  assert.doesNotMatch(JSON.stringify(manifest), /PRIVATE/, "no private key");
});

test("the native host manifest is a template with exactly two places to fill, and nothing else asks for a path or an id", () => {
  const t = fs.readFileSync(path.join(HERE, "../src/worker/native/run.vyre.bridge.json"), "utf8");
  assert.deepEqual([...new Set(t.match(/__[A-Z_]+__/g))].sort(), ["__EXTENSION_ID__", "__HOST_PATH__"]);
  const filled = JSON.parse(t.replace("__HOST_PATH__", "/x/run-vyre-bridge").replace("__EXTENSION_ID__", extensionId(manifest.key!))) as { name: string; type: string; path: string; allowed_origins: string[] };
  assert.equal(filled.name, "run.vyre.bridge");
  assert.equal(filled.type, "stdio");
  assert.deepEqual(filled.allowed_origins, [`chrome-extension://${extensionId(manifest.key!)}/`], "only this extension may start the host");
});
