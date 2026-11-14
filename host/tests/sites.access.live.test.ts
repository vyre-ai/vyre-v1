// Who may change who reaches a site, and an artifact's pages (F56, F62, F64, 14 Nov 2026). Real daemon, three people and an agent. Split from sites.privacy.live.test.ts so each file stays inside its time cap.
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
      return null;
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 200, tick: 200 },
  });

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

const AGENT_OLIVIA = "tok-agent-olivia";
const events = async (d: Daemon, type: string): Promise<number> => (await d.log!.read({ type } as never)).length;
const sitePick = async (d: Daemon, id: string): Promise<{ access: string; name: string }> =>
  (
    JSON.parse((await raw(d, "/v1/sites/get", { siteId: id })).text) as {
      data: { site: { access: string; name: string } };
    }
  ).data.site;
const settle = (ms = 1300): Promise<void> => new Promise((r) => setTimeout(r, ms));

test("changing who may reach a site, for every value: a plain member and the agent that made it are refused with nothing changed and nothing emitted; the owner and a manager may (F64, R1)", async () => {
  const d = await boot(seededDir());
  try {
    const made = await raw(
      d,
      "/v1/sites/create",
      { name: "Maker site", kind: "artifact", access: "space", idempotencyKey: "r1-mk" },
      AGENT_OLIVIA,
    );
    assert.equal(made.status, 200, made.text);
    const id = (JSON.parse(made.text) as { data: { site: { siteId: string; owner: string } } }).data.site.siteId;
    assert.equal(
      (await raw(d, "/v1/sites/update", { siteId: id, name: "Maker site 2" }, AGENT_OLIVIA)).status,
      200,
      "the agent that made it holds Edit and renames it",
    );
    const before = await sitePick(d, id);
    const changed = "site.access_changed";
    const words = /Only the owner of this site, or someone who manages it/;
    // a plain member and the maker agent: refused for every value, nothing changed, nothing emitted
    for (const access of ["public", "password", "private"]) {
      const n = await events(d, changed);
      for (const [who, label] of [
        [NOAH, "a plain member"],
        [AGENT_OLIVIA, "the agent that made it"],
      ] as const) {
        const r = await raw(d, "/v1/sites/update", { siteId: id, access }, who);
        assert.equal(r.status, 403, `${label} set ${access}: ${r.text.slice(0, 160)}`);
        assert.match(r.text, words, `${label}, ${access}`);
      }
      assert.equal(await events(d, changed), n, `a refused ${access} emitted site.access_changed`);
      assert.deepEqual(await sitePick(d, id), before, `a refused ${access} changed the site`);
      assert.equal(await reachOf(d, id, NOAH), "edit", `${access}: and the kernel still holds it under the Space`);
    }
    // the owner and a manager, for each value: private and public change it (one event each); password has no address to ask on for a site Vyre does not deploy, so it is refused for that reason, not for who asked
    const asWho = async (who: string, label: string): Promise<void> => {
      for (const access of ["private", "public", "password"]) {
        const n = await events(d, changed);
        const r = await raw(d, "/v1/sites/update", { siteId: id, access }, who);
        if (access === "password") {
          assert.equal(r.status, 422, `${label} set password: ${r.text.slice(0, 200)}`);
          assert.doesNotMatch(r.text, words, `${label}: password is refused for what it is, not for who asked`);
          assert.equal(await events(d, changed), n);
        } else {
          assert.equal(r.status, 200, `${label} set ${access}: ${r.text.slice(0, 200)}`);
          assert.equal(await events(d, changed), n + 1, `${label} ${access}: one event`);
          await settle();
          if (access === "private") assert.equal(await reachOf(d, id, NOAH), who === OWNER ? "none" : "manage");
          const back = await raw(d, "/v1/sites/update", { siteId: id, access: "space" }, who);
          assert.equal(back.status, 200, `${label} set it back: ${back.text.slice(0, 200)}`);
          await settle();
        }
      }
    };
    await asWho(OWNER, "the owner");
    assert.equal(
      (
        await raw(d, "/v1/access/share", {
          idempotencyKey: "r1-mgr",
          resource: { type: "site", id },
          subject: { kind: "person", id: "usr_noah" },
          level: "manage",
        })
      ).status,
      200,
    );
    await asWho(NOAH, "a manager");
  } finally {
    await d.stop();
  }
});

test("a member who may only view a site cannot change it or rename it; one who may edit still renames it (R1)", async () => {
  const d = await boot(seededDir());
  try {
    const id = await make(d, "view-only");
    assert.equal((await raw(d, "/v1/sites/update", { siteId: id, access: "private" })).status, 200);
    await settle();
    assert.equal(
      (
        await raw(d, "/v1/access/share", {
          idempotencyKey: "vo",
          resource: { type: "site", id },
          subject: { kind: "person", id: "usr_noah" },
          level: "view",
        })
      ).status,
      200,
    );
    await settle(600);
    const before = await sitePick(d, id);
    for (const body of [{ name: "Not yours" }, { access: "space" }]) {
      const r = await raw(d, "/v1/sites/update", { siteId: id, ...body }, NOAH);
      assert.equal(r.status, 403, `a viewer's ${JSON.stringify(body)}: ${r.text.slice(0, 160)}`);
    }
    assert.deepEqual(await sitePick(d, id), before, "nothing changed");
  } finally {
    await d.stop();
  }
});

test("the start-up pass closes only a private site: a Space site, a password site, a public site and one set back to the Space stay as they were after a start (R2)", async () => {
  const dir = seededDir();
  let d = await boot(dir);
  const ids: Record<string, string> = {};
  try {
    for (const k of ["space", "password", "public", "back", "closed"]) ids[k] = await make(d, `r2-${k}`);
    // the module's rows for a password and a public site, set as an older build left them (the kernel holds them under the Space)
    d.db!.run("UPDATE sites_site SET access = 'password' WHERE id = ?", ids["password"]);
    d.db!.run("UPDATE sites_site SET access = 'public' WHERE id = ?", ids["public"]);
    assert.equal((await raw(d, "/v1/sites/update", { siteId: ids["back"], access: "private" })).status, 200);
    await settle();
    assert.equal((await raw(d, "/v1/sites/update", { siteId: ids["back"], access: "space" })).status, 200);
    assert.equal((await raw(d, "/v1/sites/update", { siteId: ids["closed"], access: "private" })).status, 200);
    await settle();
  } finally {
    await d.stop();
  }
  d = await boot(dir);
  try {
    await settle(2500);
    for (const k of ["space", "password", "public", "back"])
      assert.equal(await reachOf(d, ids[k]!, NOAH), "edit", `the ${k} site is still the Space's after a start`);
    assert.equal(await reachOf(d, ids["closed"]!, NOAH), "none", "the private one stays private");
    assert.notEqual(await reachOf(d, ids["closed"]!, OWNER), "none");
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("no agent, and no one, moves or renames an artifact's folder, or the Artifacts folder above it, through any call in Files (F62, item 4)", async () => {
  const d = await boot(seededDir());
  try {
    const r = await raw(
      d,
      "/v1/sites/artifact_publish",
      { title: "Tapir artifact", html: "<p>TAPIRWORD</p>", idempotencyKey: "tp1" },
      AGENT_OLIVIA,
    );
    assert.equal(r.status, 200, r.text);
    const siteId = (JSON.parse(r.text) as { data: { artifactId: string } }).data.artifactId;
    const f = d.db!.all(
      "SELECT id, parent_id FROM files_folder WHERE id = (SELECT target_folder FROM sites_site WHERE id = ?)",
      siteId,
    )[0] as { id: string; parent_id: string };
    const roots = JSON.parse((await raw(d, "/v1/files/tree", {})).text) as {
      data: { roots: { key: string; folderId: string }[] };
    };
    const personal = roots.data.roots.find((x) => x.key.startsWith("personal"))!.folderId;
    for (const who of [AGENT_OLIVIA, OWNER, NOAH]) {
      for (const [path, body] of [
        ["/v1/files/folder/move", { folderId: f.id, toParentId: personal }],
        ["/v1/files/folder/move", { folderId: f.id }],
        ["/v1/files/folder/rename", { folderId: f.id, name: "Mine now" }],
        ["/v1/files/folder/move", { folderId: f.parent_id, toParentId: personal }],
        ["/v1/files/folder/rename", { folderId: f.parent_id, name: "Mine" }],
      ] as const) {
        const x = await raw(d, path, body, who);
        assert.ok(
          x.status >= 400 && x.status < 500,
          `${who} ${path} ${JSON.stringify(body)}: ${x.status} ${x.text.slice(0, 200)}`,
        );
      }
    }
    const row = d.db!.all("SELECT parent_id, name FROM files_folder WHERE id = ?", f.id)[0] as {
      parent_id: string;
      name: string;
    };
    assert.equal(row.parent_id, f.parent_id, "the folder is where it was");
    await settle(1500);
    assert.equal(/TAPIRWORD/.test((await raw(d, "/v1/search/query", { q: "TAPIRWORD" }, NOAH)).text), false);
  } finally {
    await d.stop();
  }
});

test("an artifact made Space-wide and then private leaves nothing findable by another member, now and after a restart (F62, item 6)", async () => {
  const dir = seededDir();
  let d = await boot(dir);
  let siteId = "";
  const finds = async (who: string): Promise<boolean> =>
    /ZEBUWORD/.test((await raw(d, "/v1/search/query", { q: "ZEBUWORD" }, who)).text);
  try {
    const r = await raw(d, "/v1/sites/artifact_publish", {
      title: "Zebu artifact",
      html: "<p>ZEBUWORD</p>",
      idempotencyKey: "zb1",
    });
    assert.equal(r.status, 200, r.text);
    siteId = (JSON.parse(r.text) as { data: { artifactId: string } }).data.artifactId;
    assert.equal((await raw(d, "/v1/sites/update", { siteId, access: "space" })).status, 200);
    await settle(2500);
    assert.equal(await finds(NOAH), true, "Space-wide, another member finds the page");
    assert.equal((await raw(d, "/v1/sites/update", { siteId, access: "private" })).status, 200);
    await settle(2000);
    assert.equal(await finds(NOAH), false, "private, another member finds nothing");
    assert.equal(await finds(OWNER), true, "its owner still finds it");
  } finally {
    await d.stop();
  }
  d = await boot(dir);
  try {
    await settle(2500);
    assert.equal(await finds(NOAH), false, "and after a restart");
    assert.equal(await finds(OWNER), true);
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the maker's grant on a site shows in its sharing list and the owner removes it; after that the agent that made it is refused (item 10)", async () => {
  const d = await boot(seededDir());
  try {
    const made = await raw(
      d,
      "/v1/sites/create",
      { name: "Grant site", kind: "artifact", access: "space", idempotencyKey: "mg1" },
      AGENT_OLIVIA,
    );
    assert.equal(made.status, 200, made.text);
    const id = (JSON.parse(made.text) as { data: { site: { siteId: string } } }).data.site.siteId;
    assert.equal((await raw(d, "/v1/sites/update", { siteId: id, access: "private" })).status, 200);
    await settle();
    assert.equal(
      (await raw(d, "/v1/sites/update", { siteId: id, name: "By the agent" }, AGENT_OLIVIA)).status,
      200,
      "private, the agent that made it goes on working on it",
    );
    const grants = JSON.parse((await raw(d, "/v1/access/grants/list", { resource: { type: "site", id } })).text) as {
      data: { grants: { id: string; subject: { id: string }; level: string; source?: string }[] };
    };
    const g = grants.data.grants.find((x) => x.subject.id === "agt_scout");
    assert.equal(g?.level, "edit", "the maker's grant is written");
    assert.equal(g?.source, "made-by:agt_scout");
    const shown = JSON.parse((await raw(d, "/v1/access/shares_of", { resource: { type: "site", id } })).text) as {
      data: { shares: { grant: { subject: { id: string } } }[] };
    };
    assert.ok(
      shown.data.shares.some((x) => x.grant.subject.id === "agt_scout"),
      "it shows in the site's sharing list",
    );
    const un = await raw(d, "/v1/access/unshare", { idempotencyKey: "mg-un", grantId: g!.id });
    assert.equal(un.status, 200, un.text);
    await settle();
    assert.equal(
      (await raw(d, "/v1/sites/update", { siteId: id, name: "Again" }, AGENT_OLIVIA)).status,
      403,
      "removed, the agent is refused",
    );
  } finally {
    await d.stop();
  }
});
