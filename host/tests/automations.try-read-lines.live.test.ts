// The one safe read a connector build runs, when it goes wrong: a private address is refused before the key leaves the Vault, and each failure (the app refused the key, nothing at that
// path, no answer, no such Vault item) comes back as its own plain line with a way forward, never only "did not succeed". The app here is a stand-in answered by the network stub.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { DaemonOptions } from "../src/daemon/daemon.ts";
import type { SeamFetch } from "../src/seams/ports.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const OWNER = "tok-usr_olivia";
const SECRET = "fake_notely_key_77";
const APP = "api.notely.test";

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-try-read-lines-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

test("a connector's safe read: private addresses are refused before sending, and every failure says what to do", async () => {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  // the app: /v1/notes answers 200, /v1/private 401, /v1/slow never answers in time, a rebinding name resolves to a private address
  const seamFetch: SeamFetch = async (url, init) => {
    seen.push({ url, headers: { ...(init?.headers ?? {}) } });
    const u = new URL(url);
    if (u.hostname !== APP) throw new Error("connect refused");
    if (u.pathname === "/v1/notes") return { status: 200, text: async () => '{"notes":[]}', arrayBuffer: async () => new ArrayBuffer(0) };
    if (u.pathname === "/v1/private") return { status: 401, text: async () => "unauthorized", arrayBuffer: async () => new ArrayBuffer(0) };
    if (u.pathname === "/v1/busy") return { status: 503, text: async () => "busy", arrayBuffer: async () => new ArrayBuffer(0) };
    if (u.pathname === "/v1/slow") throw new Error("timeout");
    return { status: 404, text: async () => "not found", arrayBuffer: async () => new ArrayBuffer(0) };
  };
  const dir = seededDir();
  const daemon = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "try-read-lines", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    seams: {
      vaultSinks: { env: () => undefined }, fetch: seamFetch,
      drivers: {
        // names resolve without the outside DNS: the app to a public address, rebind.notely.test to a private one
        setDocumentNetwork: () => ({
          lookup: async (host: string) => (host === "rebind.notely.test" ? ["10.0.0.7"] : ["93.184.216.34"]),
          fetch: async () => { throw new Error("not used"); },
        }),
      },
    },
    session: (h) => {
      const token = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
      return token === OWNER ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "try-read-lines" } : null;
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000, tick: 200 },
  } satisfies DaemonOptions);
  const post = async (route: string, body: unknown) => {
    const response = await fetch(`${daemon.url}${route}`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${OWNER}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(8_000),
    });
    const text = await response.text();
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* not JSON */ }
    return { status: response.status, data: (json["data"] as Record<string, unknown> | undefined) ?? {}, text };
  };
  try {
    const folder = await post("/v1/vault/folders/create", { name: "Keys", scope: "shared", idempotencyKey: "lines-folder" });
    const folderId = String((folder.data["folder"] as { id?: string } | undefined)?.id ?? "");
    const put = await post("/v1/vault/item/put", { folderId, name: "Notely", kind: "api_key", fields: [{ key: "api_key", value: SECRET }], idempotencyKey: "lines-notely" });
    assert.equal(put.status, 200, put.text);
    const handle = String((put.data["item"] as { handle?: string } | undefined)?.handle ?? "");
    const read = (p: string, domains: string[], item = `${handle}.api_key`) => post("/v1/automations/try_read", { method: "GET", path: p, domains, vaultItemId: item, header: "X-Api-Key", prefix: "" });

    const ok = await read("/v1/notes", [APP]);
    assert.equal(ok.data["level"], "tested", ok.text);

    // a private address, a loopback name, the metadata address and a name that resolves private: refused, and the key is never sent
    for (const host of ["10.0.0.5", "localhost", "169.254.169.254", "rebind.notely.test"]) {
      const before = seen.length;
      const r = await read("/v1/notes", [host]);
      assert.equal(r.data["level"], "draft", `${host}: ${r.text}`);
      assert.match(String(r.data["reason"]), /not a public/i, `${host}: ${r.text}`);
      assert.equal(seen.length, before, `${host}: nothing is sent to a private address`);
    }
    assert.equal(seen.some((s) => Object.values(s.headers).includes(SECRET) && new URL(s.url).hostname !== APP), false, "the key went only to the app");

    const lines: [string, RegExp][] = [
      ["/v1/private", /refused the key.*401/i],
      ["/v1/missing", /nothing at that address.*404/i],
      ["/v1/busy", /app had a problem.*503/i],
      ["/v1/slow", /did not answer/i],
    ];
    for (const [p, line] of lines) {
      const r = await read(p, [APP]);
      assert.equal(r.data["level"], "draft", r.text);
      assert.match(String(r.data["reason"]), line, `${p}: ${r.text}`);
      assert.equal(r.text.includes(SECRET), false, r.text);
    }
    const gone = await read("/v1/notes", [APP], "#Nothing_here.api_key");
    assert.equal(gone.data["level"], "draft", gone.text);
    assert.match(String(gone.data["reason"]), /#Nothing_here/, gone.text);
  } finally {
    await daemon.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
