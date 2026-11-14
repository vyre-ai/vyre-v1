// F48 (14 Nov 2026), sites: who may reach a site is kept where the kernel decides, like an inbox. (Mail: an inbox a person set to private is private where the kernel decides: the owner, and the people it is shared with, nobody else, for send and for naming it in a saved definition. Setting
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

test("a site set private is private: a member is refused and cannot reach it, its owner can; set back to the Space it is the Space's again", async () => {
  const d = await boot(seededDir());
  try {
    const id = await make(d, "sp-live");
    assert.equal((await raw(d, "/v1/sites/get", { siteId: id }, NOAH)).status, 200, "a Space site is open to members");
    assert.equal((await raw(d, "/v1/sites/update", { siteId: id, access: "private" })).status, 200);
    await new Promise((r) => setTimeout(r, 1500));
    assert.notEqual(
      (await raw(d, "/v1/sites/get", { siteId: id }, NOAH)).status,
      200,
      "a member still reads a private site",
    );
    assert.equal(await reachOf(d, id, NOAH), "none");
    assert.equal((await raw(d, "/v1/sites/get", { siteId: id })).status, 200, "its owner still does");
    assert.equal((await raw(d, "/v1/sites/update", { siteId: id, access: "space" })).status, 200);
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(
      (await raw(d, "/v1/sites/get", { siteId: id }, NOAH)).status,
      200,
      "back to the Space, a member reads it again",
    );
  } finally {
    await d.stop();
  }
});

test("a site already private in the store before this build is closed when the daemon starts on it", async () => {
  const dir = seededDir();
  let d = await boot(dir);
  let id = "";
  try {
    id = await make(d, "sp-old");
    // the old state: the site's own row says private, the kernel still holds it under the Space, no event closed it
    d.db!.run("UPDATE sites_site SET access = 'private' WHERE id = ?", id);
    assert.equal(await reachOf(d, id, NOAH), "edit", "the old state is open to members");
  } finally {
    await d.stop();
  }
  d = await boot(dir);
  try {
    await new Promise((r) => setTimeout(r, 2000));
    assert.equal(await reachOf(d, id, NOAH), "none", "a member still reaches a site its owner set to private");
    assert.notEqual(await reachOf(d, id, OWNER), "none");
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const names = async (d: Daemon, who: string, name: string): Promise<{ list: boolean; search: boolean }> => {
  const l = await raw(d, "/v1/sites/list", {}, who);
  const q = await raw(d, "/v1/search/query", { q: name }, who);
  return { list: l.text.includes(name), search: q.text.includes(name) };
};

test("what an agent makes for a person is theirs: private, the person opens and edits it, the agent that made it goes on working on it, another member has none, and it stays so after a restart", async () => {
  const dir = seededDir();
  let d = await boot(dir);
  const AG = "tok-agent-olivia";
  let id = "";
  try {
    const r = await raw(
      d,
      "/v1/sites/create",
      { name: "Agent made", kind: "artifact", access: "space", idempotencyKey: "ag1" },
      AG,
    );
    assert.equal(r.status, 200, r.text);
    const site = (JSON.parse(r.text) as { data: { site: { siteId: string; owner: string } } }).data.site;
    id = site.siteId;
    assert.equal(site.owner, "usr_olivia", "the person the agent acted for owns it");
    // who may reach it is the person's to say (R1): the agent is refused, the person sets it
    assert.equal(
      (await raw(d, "/v1/sites/update", { siteId: id, access: "private" }, AG)).status,
      403,
      "an agent cannot change who may reach it",
    );
    assert.equal(
      (await raw(d, "/v1/sites/update", { siteId: id, access: "private" })).status,
      200,
      "the person sets it private",
    );
    await new Promise((r) => setTimeout(r, 1500));
    const check = async (when: string): Promise<void> => {
      assert.equal((await raw(d, "/v1/sites/get", { siteId: id })).status, 200, `${when}: the person opens it`);
      assert.equal(
        (await raw(d, "/v1/sites/update", { siteId: id, name: "Agent made" })).status,
        200,
        `${when}: the person edits it`,
      );
      const a = await raw(d, "/v1/sites/update", { siteId: id, name: "Agent made" }, AG);
      assert.equal(a.status, 200, `${when}: the agent that made it keeps working on it: ${a.text.slice(0, 200)}`);
      const other = await raw(d, "/v1/sites/update", { siteId: id, name: "Agent made" }, "tok-agent-noah");
      assert.notEqual(other.status, 200, `${when}: an agent working for another member got in`);
      assert.notEqual(
        (await raw(d, "/v1/sites/get", { siteId: id }, NOAH)).status,
        200,
        `${when}: another member is refused`,
      );
      assert.equal(await reachOf(d, id, NOAH), "none", `${when}: another member's reach`);
    };
    await check("after setting it");
    d.db!.run("UPDATE sites_site SET access = 'private' WHERE id = ?", id);
  } finally {
    await d.stop();
  }
  d = await boot(dir);
  try {
    await new Promise((r) => setTimeout(r, 2000));
    assert.equal((await raw(d, "/v1/sites/get", { siteId: id })).status, 200, "after restart: the person opens it");
    assert.equal(await reachOf(d, id, NOAH), "none");
    assert.equal(
      (await raw(d, "/v1/sites/update", { siteId: id, name: "Agent made" }, AG)).status,
      200,
      "after restart: the agent can update",
    );
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a private site shared with a named person keeps the share after the move out of the Space and after a restart; the other readers do not give a member its name", async () => {
  const dir = seededDir();
  let d = await boot(dir);
  let id = "";
  try {
    id = await make(d, "Shared one");
    const sh = await raw(d, "/v1/access/share", {
      idempotencyKey: "sh-noah",
      resource: { type: "site", id },
      subject: { kind: "person", id: "usr_noah" },
      level: "view",
    });
    assert.equal(sh.status, 200, sh.text);
    assert.equal((await raw(d, "/v1/sites/update", { siteId: id, access: "private" })).status, 200);
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(await reachOf(d, id, NOAH), "view", "the named person keeps view");
    assert.equal((await raw(d, "/v1/sites/get", { siteId: id }, NOAH)).status, 200);
    d.db!.run("UPDATE sites_site SET access = 'private' WHERE id = ?", id);
  } finally {
    await d.stop();
  }
  d = await boot(dir);
  try {
    await new Promise((r) => setTimeout(r, 2000));
    assert.equal(await reachOf(d, id, NOAH), "view", "after restart the share is still there");
    // and a private site with no share: the name does not reach a member through the list or the search
    const lone = await make(d, "Lonely site");
    assert.equal((await raw(d, "/v1/sites/update", { siteId: lone, access: "private" })).status, 200);
    await new Promise((r) => setTimeout(r, 2500));
    const seen = await names(d, NOAH, "Lonely site");
    assert.deepEqual(
      seen,
      { list: false, search: false },
      "a member gets the name of a private site from the list or the search",
    );
    assert.equal((await names(d, OWNER, "Lonely site")).list, true, "its owner still lists it");
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a calendar born personal is private: a second member has no reach and does not get it listed", async () => {
  const d = await boot(seededDir());
  try {
    const r = await raw(d, "/v1/calendar/create_calendar", {
      title: "Olivia private",
      personal: true,
      idempotencyKey: "cal1",
    });
    assert.equal(r.status, 200, r.text);
    const id = (JSON.parse(r.text) as { data: { calendar: { id?: string; calendarId?: string } } }).data.calendar;
    const cid = id.calendarId ?? id.id ?? "";
    await new Promise((x) => setTimeout(x, 1500));
    const reach = async (who: string): Promise<string> =>
      (
        JSON.parse((await raw(d, "/v1/access/reach", { items: [{ type: "calendar", id: cid }] }, who)).text) as {
          data: { items: { level: string }[] };
        }
      ).data.items[0]!.level;
    assert.equal(await reach(NOAH), "none", "a second member reaches a personal calendar");
    assert.notEqual(await reach(OWNER), "none");
    assert.equal(
      (await raw(d, "/v1/calendar/list_calendars", {}, NOAH)).text.includes("Olivia private"),
      false,
      "a second member sees it listed",
    );
  } finally {
    await d.stop();
  }
});

test("an artifact an agent publishes for a person: the agent can publish again and update it, the person too, another member's agent cannot", async () => {
  const d = await boot(seededDir());
  try {
    const AG = "tok-agent-olivia";
    const a = await raw(
      d,
      "/v1/sites/artifact_publish",
      { title: "Mine", html: "<p>one</p>", idempotencyKey: "k1" },
      AG,
    );
    assert.equal(a.status, 200, a.text);
    const id = (JSON.parse(a.text) as { data: { artifactId: string } }).data.artifactId;
    assert.equal(
      (
        await raw(
          d,
          "/v1/sites/artifact_publish",
          { title: "Mine", html: "<p>two</p>", artifactId: id, idempotencyKey: "k2" },
          AG,
        )
      ).status,
      200,
    );
    assert.equal(
      (await raw(d, "/v1/sites/update", { siteId: id, name: "Mine" }, AG)).status,
      200,
      "the agent updates what it made",
    );
    assert.equal((await raw(d, "/v1/sites/update", { siteId: id, name: "Mine" })).status, 200, "the person does too");
    assert.notEqual(
      (await raw(d, "/v1/sites/update", { siteId: id, name: "Mine" }, "tok-agent-noah")).status,
      200,
      "an agent working for another member cannot",
    );
    assert.equal(await reachOf(d, id, NOAH), "none");
  } finally {
    await d.stop();
  }
});

test("the other readers give a member neither the name nor the content of a private artifact: search by name and by content, the folder search, the Sites list", async () => {
  const d = await boot(seededDir());
  try {
    const r = await raw(d, "/v1/sites/artifact_publish", {
      title: "Zebra artifact",
      html: "<p>UNIQUEARTIFACTWORD</p>",
      idempotencyKey: "z1",
    });
    assert.equal(r.status, 200, r.text);
    await new Promise((x) => setTimeout(x, 2500));
    const probes: Record<string, string> = {
      "search by name": (await raw(d, "/v1/search/query", { q: "Zebra artifact" }, NOAH)).text,
      "search by content": (await raw(d, "/v1/search/query", { q: "UNIQUEARTIFACTWORD" }, NOAH)).text,
      "folder search": (await raw(d, "/v1/files/folder/search", { q: "Zebra" }, NOAH)).text,
      "sites list": (await raw(d, "/v1/sites/list", {}, NOAH)).text,
      "sites list (artifacts)": (await raw(d, "/v1/sites/list", { kind: "artifact" }, NOAH)).text,
    };
    for (const [what, text] of Object.entries(probes))
      assert.equal(
        /Zebra|UNIQUEARTIFACTWORD/.test(text),
        false,
        `${what} gave a member the private artifact: ${text.slice(0, 200)}`,
      );
    // and the owner does get it from the list, so the probe can see it
    assert.match((await raw(d, "/v1/sites/list", {})).text, /Zebra artifact/);
  } finally {
    await d.stop();
  }
});

test("an artifact made before this build, whose folder is still under the Space, is closed when the daemon starts", async () => {
  const dir = seededDir();
  let d = await boot(dir);
  let folderId = "";
  const folderReach = async (): Promise<string> =>
    (
      JSON.parse((await raw(d, "/v1/access/reach", { items: [{ type: "folder", id: folderId }] }, NOAH)).text) as {
        data: { items: { level: string }[] };
      }
    ).data.items[0]!.level;
  try {
    let f = { id: "", parent_id: "" };
    const r = await raw(d, "/v1/sites/artifact_publish", {
      title: "Giraffe artifact",
      html: "<p>OLDSTATEWORD</p>",
      idempotencyKey: "g1",
    });
    assert.equal(r.status, 200, r.text);
    const siteId = (JSON.parse(r.text) as { data: { artifactId: string } }).data.artifactId;
    f = d.db!.all(
      "SELECT id, parent_id FROM files_folder WHERE id = (SELECT target_folder FROM sites_site WHERE id = ?)",
      siteId,
    )[0] as { id: string; parent_id: string };
    folderId = f.id;
    await new Promise((x) => setTimeout(x, 2500));
    assert.equal(await folderReach(), "none", "closed when made");
    // the old state: the folder registered under the folder it sits in, as before this build
    await d.log!.append({
      id: "evt_old_artfolder",
      type: "resource.created",
      sv: 1,
      trace_id: "1".repeat(32),
      actor: "svc_seed",
      vis: "space",
      entity: "resource",
      entity_id: f.id,
      payload: { id: f.id, type: "folder", parent_id: f.parent_id, label: 0, owner_id: "usr_olivia", holds: 0 },
    } as never);
  } finally {
    await d.stop();
  }
  d = await boot(dir);
  try {
    await new Promise((x) => setTimeout(x, 2500));
    assert.equal(
      await folderReach(),
      "none",
      "a member still reaches a private artifact's folder after the start-up pass",
    );
    assert.equal(/OLDSTATEWORD/.test((await raw(d, "/v1/search/query", { q: "OLDSTATEWORD" }, NOAH)).text), false);
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("changing who may reach a site needs its owner or someone who manages it, for every value, and an agent never does it (F56 R1)", async () => {
  const d = await boot(seededDir());
  try {
    const id = await make(d, "Olivia's site");
    const get = async (): Promise<{ access: string; live: boolean }> =>
      (
        JSON.parse((await raw(d, "/v1/sites/get", { siteId: id })).text) as {
          data: { site: { access: string; live: boolean } };
        }
      ).data.site;
    const before = await get();
    // the site is the Space's: "space" would change nothing, so it is the three that change it
    for (const access of ["public", "password", "private"]) {
      const r = await raw(d, "/v1/sites/update", { siteId: id, access }, NOAH);
      assert.equal(r.status, 403, `a plain member set ${access}: ${r.text.slice(0, 160)}`);
      assert.match(r.text, /Only the owner of this site, or someone who manages it/);
      const a = await raw(d, "/v1/sites/update", { siteId: id, access }, "tok-agent-olivia");
      assert.equal(a.status, 403, `an agent acting for the owner set ${access}: ${a.text.slice(0, 160)}`);
    }
    assert.deepEqual(await get(), before, "a refused change changed nothing");
    assert.equal(await reachOf(d, id, NOAH), "edit", "and nothing moved the site in the kernel");
    // the owner may, and a member the owner gave Manage may
    assert.equal((await raw(d, "/v1/sites/update", { siteId: id, access: "private" })).status, 200);
    await new Promise((r) => setTimeout(r, 1200));
    assert.equal(
      (
        await raw(d, "/v1/access/share", {
          idempotencyKey: "mgr",
          resource: { type: "site", id },
          subject: { kind: "person", id: "usr_noah" },
          level: "manage",
        })
      ).status,
      200,
    );
    assert.equal(
      (await raw(d, "/v1/sites/update", { siteId: id, access: "space" }, NOAH)).status,
      200,
      "a manager sets it back",
    );
    // a rename is not an access change: a member who may edit still renames
    assert.equal((await raw(d, "/v1/sites/update", { siteId: id, name: "Renamed" }, NOAH)).status, 200);
  } finally {
    await d.stop();
  }
});

test("an artifact's folder cannot be moved or renamed from Files, nor the Artifacts folder above it; the page stays closed to a member (F62)", async () => {
  const d = await boot(seededDir());
  try {
    const r = await raw(d, "/v1/sites/artifact_publish", { title: "Okapi artifact", html: "<p>OKAPIWORD</p>", idempotencyKey: "ok1" });
    assert.equal(r.status, 200, r.text);
    const siteId = (JSON.parse(r.text) as { data: { artifactId: string } }).data.artifactId;
    const f = d.db!.all("SELECT id, parent_id FROM files_folder WHERE id = (SELECT target_folder FROM sites_site WHERE id = ?)", siteId)[0] as { id: string; parent_id: string };
    const roots = JSON.parse((await raw(d, "/v1/files/tree", {})).text) as { data: { roots: { key: string; folderId: string }[] } };
    const personal = roots.data.roots.find((x) => x.key.startsWith("personal"))!.folderId;
    const words = /This folder belongs to the artifact Okapi artifact\./;
    const move = await raw(d, "/v1/files/folder/move", { folderId: f.id, toParentId: personal });
    assert.equal(move.status, 422, move.text);
    assert.match(move.text, words);
    const up = await raw(d, "/v1/files/folder/move", { folderId: f.id });
    assert.equal(up.status, 422, up.text);
    const ren = await raw(d, "/v1/files/folder/rename", { folderId: f.id, name: "Mine now" });
    assert.equal(ren.status, 422, ren.text);
    assert.match(ren.text, words);
    // the Artifacts folder above it
    const parent = await raw(d, "/v1/files/folder/move", { folderId: f.parent_id, toParentId: personal });
    assert.equal(parent.status, 422, parent.text);
    assert.match(parent.text, /The Artifacts folder stays where it is/);
    await new Promise((x) => setTimeout(x, 1500));
    const reach = JSON.parse((await raw(d, "/v1/access/reach", { items: [{ type: "folder", id: f.id }] }, NOAH)).text) as { data: { items: { level: string }[] } };
    assert.equal(reach.data.items[0]!.level, "none", "a member still has no reach on the folder");
    assert.equal(/OKAPIWORD/.test((await raw(d, "/v1/search/query", { q: "OKAPIWORD" }, NOAH)).text), false);
  } finally {
    await d.stop();
  }
});

test("deleting an artifact takes its pages out of reach and out of search for everyone, the person it was shared with included (F62)", async () => {
  const d = await boot(seededDir());
  try {
    const r = await raw(d, "/v1/sites/artifact_publish", { title: "Lemur artifact", html: "<p>LEMURWORD</p>", idempotencyKey: "lm1" });
    assert.equal(r.status, 200, r.text);
    const siteId = (JSON.parse(r.text) as { data: { artifactId: string } }).data.artifactId;
    const folder = (d.db!.all("SELECT target_folder AS f FROM sites_site WHERE id = ?", siteId)[0] as { f: string }).f;
    const fileId = (d.db!.all("SELECT id FROM files_file WHERE folder_id = ?", folder)[0] as { id: string }).id;
    assert.equal((await raw(d, "/v1/access/share", { idempotencyKey: "lm-share", resource: { type: "site", id: siteId }, subject: { kind: "person", id: "usr_noah" }, level: "view" })).status, 200);
    await new Promise((x) => setTimeout(x, 2000));
    const finds = async (who: string): Promise<boolean> => /LEMURWORD/.test((await raw(d, "/v1/search/query", { q: "LEMURWORD" }, who)).text);
    const folderReach = async (who: string): Promise<string> =>
      (JSON.parse((await raw(d, "/v1/access/reach", { items: [{ type: "folder", id: folder }] }, who)).text) as { data: { items: { level: string }[] } }).data.items[0]!.level;
    assert.equal(await finds(NOAH), true, "the person it was shared with reads the page");
    assert.notEqual(await folderReach(NOAH), "none");
    const del = await raw(d, "/v1/sites/delete", { siteId, idempotencyKey: "lm-del" });
    assert.equal(del.status, 200, del.text);
    await new Promise((x) => setTimeout(x, 1500));
    for (const who of [NOAH, OWNER]) assert.equal(await finds(who), false, `${who} still finds a deleted artifact's page`);
    assert.notEqual((await raw(d, "/v1/files/read", { fileId, as: "base64" }, NOAH)).status, 200, "the share holder still reads the page");
    assert.notEqual((await raw(d, "/v1/files/read", { fileId, as: "base64" })).status, 200, "the owner reads it outside Trash");
  } finally {
    await d.stop();
  }
});
