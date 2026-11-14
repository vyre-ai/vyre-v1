// An artifact adopts only the folder the server made for it (review r-auto2, 14 Nov 2026): a folder a caller names when publishing stays its owner's, with its grants. Real daemon.
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
const settle = (ms = 1300): Promise<void> => new Promise((r) => setTimeout(r, ms));
const J = (t: string): any => JSON.parse(t); // eslint-disable-line @typescript-eslint/no-explicit-any

async function noahFolder(d: Daemon, withAgent = false): Promise<{ folder: string; file: string }> {
  const roots = J((await raw(d, "/v1/files/tree", {}, NOAH)).text).data.roots as { key: string; folderId: string }[];
  const personal = roots.find((x) => x.key.startsWith("personal"))!.folderId;
  const f = await raw(
    d,
    "/v1/files/folder/create",
    { parentId: personal, name: "Noah notes", idempotencyKey: "nf" },
    NOAH,
  );
  assert.equal(f.status, 200, f.text);
  const folder = J(f.text).data.folder.folderId as string;
  const c = await raw(
    d,
    "/v1/files/create",
    { folderId: folder, name: "plan.txt", content: { text: "NOAHPLAN" }, idempotencyKey: "nfile" },
    NOAH,
  );
  assert.equal(c.status, 200, c.text);
  const file = J(c.text).data.file.fileId as string;
  const sh = await raw(
    d,
    "/v1/access/share",
    {
      idempotencyKey: "nsh",
      resource: { type: "folder", id: folder },
      subject: { kind: "person", id: "usr_olivia" },
      level: "view",
    },
    NOAH,
  );
  assert.equal(sh.status, 200, sh.text);
  if (withAgent) {
    const a = await raw(
      d,
      "/v1/access/share",
      {
        idempotencyKey: "nsha",
        resource: { type: "folder", id: folder },
        subject: { kind: "agent", id: "agt_scout" },
        level: "view",
      },
      NOAH,
    );
    assert.equal(a.status, 200, a.text);
  }
  return { folder, file };
}
const reach = async (d: Daemon, type: string, id: string, who: string): Promise<string> =>
  J((await raw(d, "/v1/access/reach", { items: [{ type, id }] }, who)).text).data.items[0].level;

for (const [label, token] of [
  ["a person", OWNER],
  ["an agent acting for her", AGENT_OLIVIA],
] as const) {
  test(`${label} who can only view someone's folder publishes an artifact from it: the folder and its file stay their owner's, before and after a restart`, async () => {
    const dir = seededDir();
    let d = await boot(dir);
    let mine = { folder: "", file: "" };
    const check = async (when: string): Promise<void> => {
      assert.equal(await reach(d, "folder", mine.folder, NOAH), "manage", `${when}: noah's folder`);
      assert.equal(await reach(d, "file", mine.file, NOAH), "manage", `${when}: noah's file`);
      assert.equal(
        (await raw(d, "/v1/files/read", { fileId: mine.file, as: "text" }, NOAH)).status,
        200,
        `${when}: noah reads his file`,
      );
      assert.equal(await reach(d, "folder", mine.folder, OWNER), "view", `${when}: olivia only views the folder`);
      assert.equal(await reach(d, "file", mine.file, OWNER), "view", `${when}: and the file`);
    };
    try {
      mine = await noahFolder(d, token === AGENT_OLIVIA);
      await settle(600);
      const p = await raw(
        d,
        "/v1/sites/artifact_publish",
        { title: "From noah", folderId: mine.folder, idempotencyKey: "adopt1" },
        token,
      );
      assert.equal(p.status, 200, p.text);
      await settle(2000);
      await check("after the publish");
    } finally {
      await d.stop();
    }
    d = await boot(dir);
    try {
      await settle(2500);
      await check("after a restart");
    } finally {
      await d.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("a folder a person renames or builds to look like an artifact's own folder is not adopted", async () => {
  const dir = seededDir();
  let d = await boot(dir);
  let fake = { folder: "", file: "" };
  try {
    const p = await raw(d, "/v1/sites/artifact_publish", {
      title: "Real one",
      html: "<p>REALWORD</p>",
      idempotencyKey: "im1",
    });
    assert.equal(p.status, 200, p.text);
    const siteId = J(p.text).data.artifactId as string;
    const real = d.db!.all(
      "SELECT target_folder, (SELECT path FROM files_folder WHERE id = target_folder) AS path FROM sites_site WHERE id = ?",
      siteId,
    )[0] as { target_folder: string; path: string };
    // a person's folder carrying exactly the server's path text for this artifact
    const roots = J((await raw(d, "/v1/files/tree", {}, NOAH)).text).data.roots as { key: string; folderId: string }[];
    const personal = roots.find((x) => x.key.startsWith("personal"))!.folderId;
    const f = await raw(
      d,
      "/v1/files/folder/create",
      { parentId: personal, name: real.path.split("/").pop()!, idempotencyKey: "imf" },
      NOAH,
    );
    assert.equal(f.status, 200, f.text);
    fake.folder = J(f.text).data.folder.folderId;
    const c = await raw(
      d,
      "/v1/files/create",
      { folderId: fake.folder, name: "x.txt", content: { text: "FAKEWORD" }, idempotencyKey: "imc" },
      NOAH,
    );
    fake.file = J(c.text).data.file.fileId;
    const sh = await raw(
      d,
      "/v1/access/share",
      {
        idempotencyKey: "imsh",
        resource: { type: "folder", id: fake.folder },
        subject: { kind: "person", id: "usr_olivia" },
        level: "view",
      },
      NOAH,
    );
    assert.equal(sh.status, 200, sh.text);
    await settle(600);
    // and a second artifact that points at it
    const q = await raw(d, "/v1/sites/artifact_publish", {
      title: "Points at fake",
      folderId: fake.folder,
      idempotencyKey: "im2",
    });
    assert.equal(q.status, 200, q.text);
    await settle(2000);
  } finally {
    await d.stop();
  }
  d = await boot(dir);
  try {
    await settle(2500);
    assert.equal(await reach(d, "folder", fake.folder, NOAH), "manage");
    assert.equal(await reach(d, "file", fake.file, NOAH), "manage");
    assert.equal(await reach(d, "folder", fake.folder, OWNER), "view", "olivia keeps only the View noah gave");
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the owner of a private artifact reads and finds its pages; another member does not (the reason pages are adopted)", async () => {
  const d = await boot(seededDir());
  try {
    const p = await raw(d, "/v1/sites/artifact_publish", {
      title: "Mine",
      html: "<p>PRIVWORD</p>",
      idempotencyKey: "pv1",
    });
    assert.equal(p.status, 200, p.text);
    const siteId = J(p.text).data.artifactId as string;
    const folder = (d.db!.all("SELECT target_folder AS f FROM sites_site WHERE id = ?", siteId)[0] as { f: string }).f;
    const file = (d.db!.all("SELECT id FROM files_file WHERE folder_id = ?", folder)[0] as { id: string }).id;
    await settle(3000);
    assert.equal((await raw(d, "/v1/files/read", { fileId: file, as: "text" })).status, 200);
    assert.match((await raw(d, "/v1/search/query", { q: "PRIVWORD" })).text, /PRIVWORD/);
    assert.notEqual((await raw(d, "/v1/files/read", { fileId: file, as: "text" }, NOAH)).status, 200);
    assert.doesNotMatch((await raw(d, "/v1/search/query", { q: "PRIVWORD" }, NOAH)).text, /PRIVWORD/);
  } finally {
    await d.stop();
  }
});

for (const [label, token] of [
  ["olivia", OWNER],
  ["an agent acting for olivia", AGENT_OLIVIA],
] as const) {
  test(`${label} cannot forge the server's folder marker with sites.update: noah keeps his folder through a second publish and a restart`, async () => {
    const dir = seededDir();
    let d = await boot(dir);
    let mine = { folder: "", file: "" };
    const check = async (when: string): Promise<void> => {
      assert.equal(await reach(d, "folder", mine.folder, NOAH), "manage", `${when}: noah's folder`);
      assert.equal(await reach(d, "file", mine.file, NOAH), "manage", `${when}: noah's file`);
      assert.equal(
        (await raw(d, "/v1/files/read", { fileId: mine.file, as: "text" }, NOAH)).status,
        200,
        `${when}: noah reads his file`,
      );
      assert.equal(await reach(d, "folder", mine.folder, OWNER), "view", `${when}: olivia only views the folder`);
    };
    try {
      mine = await noahFolder(d, token === AGENT_OLIVIA);
      await settle(600);
      const p = await raw(
        d,
        "/v1/sites/artifact_publish",
        { title: "Forger", folderId: mine.folder, idempotencyKey: "fg1" },
        token,
      );
      assert.equal(p.status, 200, p.text);
      const siteId = J(p.text).data.artifactId as string;
      const u = await raw(d, "/v1/sites/update", { siteId, settings: { serverFolder: mine.folder } }, token);
      assert.equal(u.status, 422, `a settings patch naming the reserved key is refused: ${u.text.slice(0, 200)}`);
      assert.match(u.text, /kept by the server/);
      const again = await raw(
        d,
        "/v1/sites/artifact_publish",
        { title: "Forger", artifactId: siteId, folderId: mine.folder, idempotencyKey: "fg2" },
        token,
      );
      assert.equal(again.status, 200, again.text);
      await settle(2000);
      await check("after the forged marker and a second publish");
      const kept = d.db!.all("SELECT settings FROM sites_site WHERE id = ?", siteId)[0] as { settings: string };
      assert.doesNotMatch(kept.settings, /serverFolder/, "the marker is not in a caller's hands");
    } finally {
      await d.stop();
    }
    d = await boot(dir);
    try {
      await settle(2500);
      await check("after a restart");
    } finally {
      await d.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

for (const [label, token] of [
  ["its owner", OWNER],
  ["an agent acting for its owner", AGENT_OLIVIA],
] as const) {
  test(`a legacy artifact (no marker, folder registered to the server) through its life: adopted at start, ${label} publishes a new page, restarts change nothing`, async () => {
    const dir = seededDir();
    let d = await boot(dir);
    let siteId = "";
    let folder = "";
    const adoptEvents = async (): Promise<number> =>
      (await d.log!.read({ type: "resource.created" } as never)).filter((e) => /^evt_res_art/.test(String(e.id)))
        .length;
    const pageIds = (): string[] =>
      (
        d.db!.all("SELECT id FROM files_file WHERE folder_id = ? AND deleted_at IS NULL", folder) as { id: string }[]
      ).map((r) => r.id);
    const publish = async (html: string, key: string): Promise<void> => {
      const r = await raw(
        d,
        "/v1/sites/artifact_publish",
        { title: "Legacy", artifactId: siteId, html, idempotencyKey: key },
        token,
      );
      assert.equal(r.status, 200, r.text);
    };
    const finds = async (w: string, who: string): Promise<boolean> =>
      new RegExp(w).test((await raw(d, "/v1/search/query", { q: w }, who)).text);
    const owns = async (when: string, word: string): Promise<void> => {
      for (const id of pageIds()) {
        assert.equal(
          (await raw(d, "/v1/files/read", { fileId: id, as: "text" })).status,
          200,
          `${when}: owner reads ${id}`,
        );
        assert.notEqual(
          (await raw(d, "/v1/files/read", { fileId: id, as: "text" }, NOAH)).status,
          200,
          `${when}: member refused`,
        );
      }
      assert.equal(await finds(word, OWNER), true, `${when}: owner finds ${word}`);
      assert.equal(await finds(word, NOAH), false, `${when}: member does not find ${word}`);
    };
    try {
      const p = await raw(d, "/v1/sites/artifact_publish", {
        title: "Legacy",
        html: "<p>OLDPAGE</p>",
        idempotencyKey: "lg1",
      });
      assert.equal(p.status, 200, p.text);
      siteId = J(p.text).data.artifactId as string;
      const row = d.db!.all(
        "SELECT target_folder, (SELECT parent_id FROM files_folder WHERE id = target_folder) AS up FROM sites_site WHERE id = ?",
        siteId,
      )[0] as { target_folder: string; up: string };
      folder = row.target_folder;
      // the state before this build: no marker, the folder registered to the server under the Artifacts folder
      d.db!.run("UPDATE sites_site SET settings = '{}' WHERE id = ?", siteId);
      await d.log!.append({
        id: "evt_legacy_artfolder",
        type: "resource.created",
        sv: 1,
        trace_id: "1".repeat(32),
        actor: "svc_seed",
        vis: "space",
        entity: "resource",
        entity_id: folder,
        payload: { id: folder, type: "folder", parent_id: row.up, label: 0, owner_id: "svc_host", holds: 0 },
      } as never);
    } finally {
      await d.stop();
    }
    d = await boot(dir);
    try {
      await settle(3000);
      await owns("after the start", "OLDPAGE");
      // the start-up pass has just proven the folder is the server's: it records that, so a later publish needs no guess
      assert.match(
        (d.db!.all("SELECT settings FROM sites_site WHERE id = ?", siteId)[0] as { settings: string }).settings,
        /serverFolder/,
        "a legacy artifact is marked when it is adopted",
      );
      // a publish again: the page changes (the server writes a new version of the page it already holds)
      await publish("<p>NEWPAGE</p>", `lg-new-${Date.now()}`);
      await settle(3000);
      assert.equal(pageIds().length, 1);
      await owns("after the republish", "NEWPAGE");
    } finally {
      await d.stop();
    }
    d = await boot(dir);
    let n = 0;
    try {
      await settle(3000);
      await owns("after a restart", "NEWPAGE");
      n = await adoptEvents();
    } finally {
      await d.stop();
    }
    d = await boot(dir);
    try {
      await settle(3000);
      await owns("after a second restart", "NEWPAGE");
      assert.equal(await adoptEvents(), n, "the second restart emitted no adoption event");
    } finally {
      await d.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
