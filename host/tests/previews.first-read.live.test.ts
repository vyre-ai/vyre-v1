// The first read of a file whose preview was never made renders it inline and announces it (preview.ready, or preview.failed). Those reads declare the events, so the pipeline lets them out:
// before 12 Nov 2026 the first previews.text, previews.get or previews.pages of a new file answered 500 "event not declared in emits" (lane f-revoke). A booted daemon, the real files and
// previews modules.
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

const caddyFetch: FetchFn = () =>
  Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve('{"apps":{"http":{}}}'),
  });
const OWNER = "tok-usr_olivia";

test("the first preview read of a new file answers, for each read that renders inline", async () => {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-preview-first-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--address", "team.example.com"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux",
      hostname: "preview-first",
      free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    session: (h) =>
      /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1] === OWNER
        ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "preview-first" }
        : null,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const post = async (p: string, body: unknown): Promise<{ status: number; body: any }> => {
    const r = await fetch(`${d.url}${p}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${OWNER}` },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : {} };
  };
  try {
    const roots = (await post("/v1/files/tree", {})).body.data.roots as Array<{ folderId?: string }>;
    const parent = roots.find((r) => r.folderId)?.folderId;
    assert.ok(parent, "a Space folder to write in");
    const make = async (name: string): Promise<string> => {
      const r = await post("/v1/files/create", {
        folderId: parent,
        name,
        content: { text: `# ${name}\n\nfirst read\n` },
        idempotencyKey: `pf-${name}`,
      });
      assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
      return r.body.data.file.fileId as string;
    };
    // a new file for each read, so each one is the first read of a file never rendered
    const text = await post("/v1/previews/text", { fileId: await make("a.md") });
    assert.equal(text.status, 200, `previews.text: ${JSON.stringify(text.body).slice(0, 300)}`);
    assert.match(String(text.body.data.text), /first read/);
    const get = await post("/v1/previews/get", { fileId: await make("b.md") });
    assert.equal(get.status, 200, `previews.get: ${JSON.stringify(get.body).slice(0, 300)}`);
    const pages = await post("/v1/previews/pages", { fileId: await make("c.md") });
    assert.equal(pages.status, 200, `previews.pages: ${JSON.stringify(pages.body).slice(0, 300)}`);
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
