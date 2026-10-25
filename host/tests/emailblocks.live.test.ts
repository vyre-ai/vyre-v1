// P-CC_30: saved email blocks through the gateway on a booted daemon. host/modules.json still says email-builder-api is a stub (its live flip is P-L8_LIVE), so this test boots from a
// copy of the code root whose modules.json has it live; every other file is a symlink to the real one. Two real people from the seeded Space: the owner (Olivia) saves, a member (Noah) lists.
// Path mapping: the packet owns this test because it boots the daemon.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));
const OWNER = "tok-usr_olivia";
const MEMBER = "tok-usr_noah";

function seededDir(): string {
  const core = bootCore();
  const dir = tmp("vyre-eb-live-");
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

function codeRootWithEmailBuilderLive(): string {
  const root = tmp("vyre-eb-root-");
  for (const name of fs.readdirSync(CODE_ROOT)) {
    if (name.startsWith(".") || name === "host") continue;
    fs.symlinkSync(path.join(CODE_ROOT, name), path.join(root, name));
  }
  fs.mkdirSync(path.join(root, "host"));
  for (const name of fs.readdirSync(path.join(CODE_ROOT, "host"))) {
    if (name !== "modules.json") fs.symlinkSync(path.join(CODE_ROOT, "host", name), path.join(root, "host", name));
  }
  const list = JSON.parse(fs.readFileSync(path.join(CODE_ROOT, "host/modules.json"), "utf8")) as { modules: { id: string; status: string }[] };
  const m = list.modules.find((x) => x.id === "email-builder-api");
  assert.ok(m, "email-builder-api is in host/modules.json");
  m.status = "live";
  fs.writeFileSync(path.join(root, "host/modules.json"), JSON.stringify(list));
  return root;
}

async function boot(dir: string, codeRoot: string): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    codeRoot,
    platform: fakePlatform({
      os: "linux", hostname: "eb-live", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    session: (h) => {
      const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
      const who = t === OWNER ? "usr_olivia" : t === MEMBER ? "usr_noah" : null;
      return who === null ? null : { space: "spc_core", principal: { kind: "person", id: who }, device: "eb-live" };
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
}

async function call(d: Daemon, token: string, cap: string, input: unknown): Promise<{ status: number; body: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(input) });
  return { status: r.status, body: await r.json() };
}

test("email blocks live: through the gateway a person saves a block and lists it, a shared one is seen by a member who cannot change it, a private one is not seen at all", async () => {
  const d = await boot(seededDir(), codeRootWithEmailBuilderLive());
  const social = { type: "social", props: { links: [{ network: "linkedin", url: "https://linkedin.com/company/acme" }], align: "center" } };
  try {
    assert.deepEqual((d.seams?.missing ?? []).filter((m) => m.module === "email-builder-api"), [], "email-builder-api is not reported as not set up");
    const priv = await call(d, OWNER, "email_builder.saved_blocks.save", { idempotencyKey: "eb-live-1", name: "Private row", block: social });
    assert.equal(priv.status, 200, JSON.stringify(priv.body));
    const shared = await call(d, OWNER, "email_builder.saved_blocks.save", { idempotencyKey: "eb-live-2", name: "Shared row", block: social, shared: true });
    assert.equal(shared.status, 200, JSON.stringify(shared.body));
    const privId = priv.body.data.block.blockId as string;
    const sharedId = shared.body.data.block.blockId as string;
    assert.match(sharedId, /^blk_[a-z0-9]+$/);

    const mine = await call(d, OWNER, "email_builder.saved_blocks.list", {});
    assert.equal(mine.status, 200, JSON.stringify(mine.body));
    assert.deepEqual(mine.body.data.blocks.map((b: { name: string }) => b.name), ["Private row", "Shared row"]);

    const theirs = await call(d, MEMBER, "email_builder.saved_blocks.list", {});
    assert.equal(theirs.status, 200, JSON.stringify(theirs.body));
    assert.deepEqual(theirs.body.data.blocks.map((b: { name: string }) => b.name), ["Shared row"], "a private block is not listed for someone else");

    const refused = await call(d, MEMBER, "email_builder.saved_blocks.save", { idempotencyKey: "eb-live-3", blockId: sharedId, name: "Taken", block: social });
    assert.equal(refused.status, 403, JSON.stringify(refused.body));
    assert.equal(refused.body.error?.code, "permission.no_grant");
    const hidden = await call(d, MEMBER, "email_builder.saved_blocks.save", { idempotencyKey: "eb-live-4", blockId: privId, name: "Taken", block: social });
    assert.equal(hidden.status, 404, JSON.stringify(hidden.body));
    assert.equal(hidden.body.error?.code, "validation.not_found");
    const after = await call(d, OWNER, "email_builder.saved_blocks.list", {});
    assert.deepEqual(after.body.data.blocks.map((b: { name: string }) => b.name), ["Private row", "Shared row"], "the refused saves changed nothing");
  } finally { await d.stop(); }
});
