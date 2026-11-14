// F62 (14 Nov 2026), an artifact's PAGES: who may read an artifact's files, and what is findable, follows the artifact. (Copy of the helpers of sites.privacy.live.test.ts.) Original header: F48 sites: who may reach a site is kept where the kernel decides, like an inbox. (Mail: an inbox a person set to private is private where the kernel decides: the owner, and the people it is shared with, nobody else, for send and for naming it in a saved definition. Setting
// it back to the Space gives it back to every member. Real daemon, two people.
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
import type { Daemon } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () =>
  Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve('{"apps":{"http":{}}}'),
  });
const OWNER = "tok-usr_olivia";
const NOAH = "tok-usr_noah";
const AGENT = "tok-agent";
const TO = "held@gate.test";

function seededDir(): string {
  const core = bootCore();
  core.store.appendBatch([
    {
      id: "evt_f47_box",
      type: "resource.created",
      sv: 1,
      trace_id: "1".repeat(32),
      actor: "svc_seed",
      vis: "space",
      entity: "resource",
      entity_id: "mbx_privatebox0001",
      payload: {
        id: "mbx_privatebox0001",
        type: "mailbox",
        parent_id: null,
        label: 0,
        owner_id: "usr_olivia",
        holds: 0,
      },
    } as never,
  ]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-grant-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

const boot = (dir: string): Promise<Daemon> =>
  startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux",
      hostname: "grant-live",
      free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    session: (h) => {
      const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
      if (t === OWNER)
        return { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "grant-live" };
      if (t === NOAH) return { space: "spc_core", principal: { kind: "person", id: "usr_noah" }, device: "grant-live" };
      if (t === "tok-agent-noah")
        return { space: "spc_core", principal: { kind: "agent", id: "agt_scout" }, actingFor: "usr_noah" };
      if (t === "tok-agent-olivia")
        return { space: "spc_core", principal: { kind: "agent", id: "agt_scout" }, actingFor: "usr_olivia" };
      if (t === AGENT)
        return { space: "spc_core", principal: { kind: "agent", id: "agt_scout" }, actingFor: "usr_noah" };
      return null;
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 200, tick: 200 },
  });

const post = async (d: Daemon, p: string, body: unknown, token = OWNER): Promise<Record<string, unknown>> => {
  const r = await fetch(`${d.url}${p}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  const text = await r.text();
  assert.equal(r.status, 200, `${p}: ${text}`);
  return (JSON.parse(text) as { data?: Record<string, unknown> }).data ?? {};
};
async function until<T>(what: string, ms: number, look: () => Promise<T | undefined>): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await look();
    if (v !== undefined) return v;
    assert.ok(Date.now() < end, `gave up waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

const raw = async (d: Daemon, p: string, body: unknown, token = OWNER): Promise<{ status: number; text: string }> => {
  const r = await fetch(`${d.url}${p}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  return { status: r.status, text: await r.text() };
};

const reachOf = async (d: Daemon, id: string, who: string): Promise<string> =>
  (
    JSON.parse((await raw(d, "/v1/access/reach", { items: [{ type: "site", id }] }, who)).text) as {
      data: { items: { level: string }[] };
    }
  ).data.items[0]!.level;
const make = async (d: Daemon, key: string): Promise<string> => {
  const r = await raw(d, "/v1/sites/create", { name: key, kind: "artifact", access: "space", idempotencyKey: key });
  assert.equal(r.status, 200, r.text);
  return (JSON.parse(r.text) as { data: { site: { siteId: string } } }).data.site.siteId;
};

const NOAH_AGENT = "tok-agent-noah";
const OLIVIA_AGENT = "tok-agent-olivia";
const WORD = "OKAPIWORD";

async function publish(
  d: Daemon,
  title: string,
  word: string,
  key: string,
): Promise<{ siteId: string; folderId: string }> {
  const r = await raw(d, "/v1/sites/artifact_publish", { title, html: `<p>${word}</p>`, idempotencyKey: key });
  assert.equal(r.status, 200, r.text);
  const siteId = (JSON.parse(r.text) as { data: { artifactId: string } }).data.artifactId;
  const f = d.db!.all("SELECT target_folder FROM sites_site WHERE id = ?", siteId)[0] as { target_folder: string };
  return { siteId, folderId: f.target_folder };
}
const finds = async (d: Daemon, word: string, who: string): Promise<boolean> =>
  new RegExp(word).test((await raw(d, "/v1/search/query", { q: word }, who)).text);
const waitIndexed = (d: Daemon, word: string): Promise<boolean> =>
  until("the page to be indexed", 15_000, async () => ((await finds(d, word, OWNER)) ? true : undefined));

test("a private artifact's page is not found by a second member through search, and its file id is refused to them; its owner finds it (F62)", async () => {
  const d = await boot(seededDir());
  try {
    const { folderId } = await publish(d, "Okapi artifact", WORD, "f62-pages");
    await waitIndexed(d, WORD);
    const noah = await raw(d, "/v1/search/query", { q: WORD }, NOAH);
    console.log("MEASURE F62 noah search:", noah.status, noah.text.slice(0, 300));
    assert.equal(new RegExp(WORD).test(noah.text), false, "a member who was never given the artifact finds its page");
    const fileId = (d.db!.all("SELECT id FROM files_file WHERE folder_id = ?", folderId)[0] as { id: string }).id;
    const real = await raw(d, "/v1/files/read", { fileId, as: "base64" }, NOAH);
    const fake = await raw(d, "/v1/files/read", { fileId: "fil_00000000000000000000000000000000", as: "base64" }, NOAH);
    console.log("MEASURE F62 noah read real/fake:", real.status, fake.status);
    assert.notEqual(real.status, 200, "a member reads the page by its id");
    // Files answers a file its asker cannot reach with 403 (no grant), and an id it has never seen with 404; that difference is Files' own for every private file, not this change's
    assert.equal(real.status, 403, "the page's id is refused to a member");
    assert.doesNotMatch(real.text, new RegExp(WORD), "and the refusal carries none of the page");
    assert.equal(fake.status, 404);
    assert.equal((await raw(d, "/v1/files/read", { fileId, as: "text" })).status, 200, "its owner reads the page");
  } finally {
    await d.stop();
  }
});
