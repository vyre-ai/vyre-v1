// @reads /modules/mounts/handlers/engine.ts
// @reads /modules/mounts/handlers/outbound-moves.ts
// @reads /modules/mounts/handlers/providers.ts
// @reads /modules/mounts/projections.ts
// @reads /modules/mounts/migrations/0006_mounts_writeback.sql
// Write-back to Google Drive and OneDrive (15 Nov 2026): each rule the owner set for a connected folder has a test here. The fakes refuse a write that carries no idempotency key, as the host does
// (modules/mounts/fixtures/world.ts reads the real manifests), so a missing key fails these tests instead of passing them. What the fake Drive does not model: Drive's real permission checks, eventual
// consistency, the 100-revision cap, quota, shortcuts. The booted-daemon proof against a stand-in Drive is test/mounts.drive.live.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import mountsManifest from "../../../manifests/mounts.ts";
import { handlers } from "../impl.ts";
import { localChangesConsumer } from "../projections.ts";
import { movesConsumer } from "../handlers/outbound-moves.ts";
import { harness, vyreErr } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";

type Row = Record<string, unknown>;

const call = (w: World, cap: keyof typeof handlers, input: Row): Promise<Row> =>
  (handlers[cap] as (c: Ctx, i: unknown) => Promise<Row>)(w.ctx, input);

function feed(w: World, name: string, payload: Row, actor = "usr_owner"): void {
  const fn = localChangesConsumer.on[name] ?? movesConsumer.on[name];
  assert.ok(fn, `consumer for ${name}`);
  fn(w.db, { at: w.now(), actor, payload: new TextEncoder().encode(JSON.stringify(payload)) });
}

const DRIVE = { kind: "google_drive", connectionId: "con_g", ref: "root_drv" };
const SHARE = { kind: "sharepoint", connectionId: "con_m", ref: "drv1" };

async function add(w: World, source: Row = DRIVE, extra: Row = {}): Promise<{ mountId: string; folderId: string }> {
  const r = await call(w, "mounts.add", { into: "fld_into", source, name: "Drive", mode: "server_copy", ...extra });
  return { mountId: String(r["mountId"]), folderId: String(r["folderId"]) };
}
const sync = (w: World, mountId: string): Promise<Row> => call(w, "mounts.sync_now", { mountId });
const item = (w: World, mountId: string, name: string): Row => {
  const r = w.items(mountId).find((x) => x["name"] === name);
  assert.ok(r, `item ${name}`);
  return r;
};
function edit(w: World, name: string, text: string): string {
  const fileId = w.files.fileNamed(name).id;
  feed(w, "file.version_added", { fileId, n: w.files.edit(fileId, text) });
  return fileId;
}
function rename(w: World, fileId: string, from: string, to: string): void {
  w.files.call("files.rename", { fileId, name: to });
  feed(w, "file.renamed", { fileId, from, to });
}

// ---- the fakes refuse what the host refuses ----

test("a write with no idempotency key is refused by the fakes, as the host refuses it", async () => {
  const w = harness();
  await assert.rejects(
    () => w.ctx.call("google.drive.trash_file", { fileId: "f1" }),
    (e: Error) => /idempotency key/.test(e.message),
  );
  await assert.rejects(
    () => w.ctx.call("ms.drive.update_item", { itemId: "m1", name: "x" }),
    (e: Error) => /idempotency key/.test(e.message),
  );
  await w.ctx.call("google.drive.trash_file", { fileId: "f1", idempotencyKey: "k" });
});

test("every capability that can run a pass declares every event a pass emits (a booted daemon refuses an undeclared one)", () => {
  const passEvents = ["mount.synced", "mount.failed", "mount.conflict", "mount.file_sent"];
  for (const name of ["mounts.add", "mounts.sync_now", "mounts.nudge", "mounts.company_drive", "mounts.restore"]) {
    const cap = (mountsManifest.capabilities ?? []).find((c) => c.name === name);
    assert.ok(cap, name);
    for (const ev of passEvents) assert.ok(cap.emits.includes(ev as never), `${name} declares ${ev}`);
  }
});

// ---- rule 1: an edit is a new revision of the same file ----

test("rule 1: an edit sends a new revision of the same Drive file with the revision it was based on; nothing is made or trashed", async () => {
  const w = harness();
  w.google.decorate("f1", { headRevisionId: "r1" });
  const { mountId } = await add(w);
  edit(w, "intro.pdf", "revised");
  await sync(w, mountId);
  assert.deepEqual(w.google.replaced, [{ remoteId: "f1", ifRevision: "r1" }]);
  assert.deepEqual([w.google.trashed, w.google.folders], [[], []]);
  assert.equal(w.google.uploads.length, 1);
});

// ---- rule 3: delete goes to the provider's own Trash, and a restore takes it back ----

test("rule 3: a delete in Vyre puts the Drive file in Drive's Trash; restoring it from Vyre's Trash takes the same file back out", async () => {
  const w = harness();
  const { mountId, folderId } = await add(w);
  const intro = w.files.fileNamed("intro.pdf");
  w.files.call("files.delete", { fileId: intro.id });
  feed(w, "file.deleted", { fileId: intro.id, folderId });
  await sync(w, mountId);
  assert.deepEqual(w.google.trashed, ["f1"], "trashed, not deleted for good");
  const tomb = item(w, mountId, "intro.pdf");
  assert.deepEqual([tomb["deleted"], tomb["dirty"]], [1, 0]);
  assert.notEqual(tomb["trashed_at"], null);

  w.files.call("files.restore", { fileId: intro.id });
  feed(w, "file.restored", { fileId: intro.id, folderId });
  await sync(w, mountId);
  assert.deepEqual(w.google.updates, [{ fileId: "f1", trashed: false }], "the same Drive file comes back");
  assert.ok(
    w.google.listings.get("root_drv")?.some((p) => (p["files"] as Row[]).some((f) => f["id"] === "f1")),
    "it is listed in its folder again",
  );
  const back = item(w, mountId, "intro.pdf");
  assert.deepEqual([back["deleted"], back["trashed_at"], back["dirty"]], [0, null, 0]);
  assert.deepEqual(w.google.uploads, [], "no new file was made for it");
});

test("rule 3: restoring from Vyre's Trash before the delete went out cancels it; Drive is never touched", async () => {
  const w = harness();
  const { mountId, folderId } = await add(w);
  const intro = w.files.fileNamed("intro.pdf");
  w.files.call("files.delete", { fileId: intro.id });
  feed(w, "file.deleted", { fileId: intro.id, folderId });
  w.files.call("files.restore", { fileId: intro.id });
  feed(w, "file.restored", { fileId: intro.id, folderId });
  await sync(w, mountId);
  assert.deepEqual([w.google.trashed, w.google.updates, w.google.uploads], [[], [], []]);
  assert.equal(item(w, mountId, "intro.pdf")["deleted"], 0);
});

test("rule 3: a tombstone survives the next listing, which no longer shows the trashed file", async () => {
  const w = harness();
  const { mountId, folderId } = await add(w);
  const intro = w.files.fileNamed("intro.pdf");
  w.files.call("files.delete", { fileId: intro.id });
  feed(w, "file.deleted", { fileId: intro.id, folderId });
  await sync(w, mountId);
  await sync(w, mountId);
  assert.notEqual(
    item(w, mountId, "intro.pdf")["trashed_at"],
    null,
    "still known after a full scan that no longer lists it",
  );
});

// ---- rule 4: a new file is made once, a retry never makes two ----

test("rule 4: a retry of a failed create reuses its key and Drive holds one file", async () => {
  const w = harness();
  const { mountId, folderId } = await add(w);
  const made = (
    w.files.call("files.create", { folderId, name: "new.txt", content: { blobId: w.files.blob("blb_n", "n") } }) as Row
  ).file as Row;
  feed(w, "file.created", { fileId: String(made["fileId"]), folderId, name: "new.txt" });
  w.google.failWith = vyreErr("provider.unavailable", "Drive is down.", true);
  await sync(w, mountId);
  assert.equal(item(w, mountId, "new.txt")["dirty"], 1, "it waits");
  w.google.failWith = null;
  await sync(w, mountId);
  await sync(w, mountId);
  assert.equal(
    w.google.uploads.filter((u) => u.name === "new.txt").length,
    1,
    "one file is made however often the pass ran",
  );
  const keys = w.google.keys.filter((k) => k.cap === "google.drive.upload_file").map((k) => k.key);
  assert.equal(new Set(keys).size, 1, "every attempt carried the same key");
});

// ---- rule 5: offline, the change waits with a reason, nothing is lost, an item that can never go out says so ----

test("rule 5: with Drive down an edit waits on its file with the reason; the next pass sends it and the reason goes", async () => {
  const w = harness();
  const { mountId } = await add(w);
  edit(w, "intro.pdf", "offline edit");
  w.google.failWith = vyreErr("provider.unavailable", "Drive is down.", true);
  await sync(w, mountId);
  const waiting = item(w, mountId, "intro.pdf");
  assert.equal(waiting["dirty"], 1);
  assert.equal(
    waiting["wait_reason"],
    "Google Drive could not be reached. Vyre tries again by itself.",
    "the file says why it has not gone out",
  );
  const opened = (await call(w, "mounts.open", { fileId: w.files.fileNamed("intro.pdf").id })) as Row;
  assert.deepEqual((opened["source"] as Row)["notSent"], { reason: waiting["wait_reason"] });
  w.google.failWith = null;
  await sync(w, mountId);
  const done = item(w, mountId, "intro.pdf");
  assert.deepEqual([done["dirty"], done["wait_reason"]], [0, null]);
});

test("rule 5: a change Drive refuses for this file (permission removed) says so in one sentence and does not fail the mount", async () => {
  const w = harness();
  const { mountId } = await add(w);
  edit(w, "intro.pdf", "my edit");
  const real = w.google.call.bind(w.google);
  w.google.call = (cap: string, i: Row): unknown => {
    if (cap === "google.drive.upload_file") throw vyreErr("provider.auth_failed", "Drive refused.", false);
    return real(cap, i);
  };
  await sync(w, mountId);
  const row = item(w, mountId, "intro.pdf");
  assert.equal(row["can_edit"], 0);
  assert.match(
    String(row["wait_reason"]),
    /You can no longer change this at Google Drive\. Your change stays in Vyre\./,
  );
  assert.equal(w.mountRow(mountId)["state"], "idle", "the mount itself is fine");
  const opened = (await call(w, "mounts.open", { fileId: w.files.fileNamed("intro.pdf").id })) as Row;
  assert.equal((opened["source"] as Row)["viewOnly"], true);
});

// ---- rule 6: the pass's own rename sends nothing ----

test("rule 6: a pass that renames and moves files as Drive did sends nothing back, then or on the next passes", async () => {
  const w = harness();
  w.google.startToken = "tok1";
  const { mountId, folderId } = await add(w);
  // Drive renamed intro.pdf and moved it into Contracts: the pass applies it to Files
  w.google.feed.set("tok1", {
    changes: [
      {
        fileId: "f1",
        removed: false,
        file: {
          id: "f1",
          name: "intro-renamed.pdf",
          mimeType: "application/pdf",
          parents: ["d1"],
          modifiedTime: "2026-10-01T10:05:00.000Z",
        },
      },
    ],
    newStartPageToken: "tok2",
  });
  await sync(w, mountId);
  const f = w.files.fileNamed("intro-renamed.pdf");
  // the events the files module raised for the pass's own calls arrive afterwards, as the host projects them
  feed(w, "file.renamed", { fileId: f.id, from: "intro.pdf", to: "intro-renamed.pdf" });
  feed(w, "file.moved", { fileId: f.id, fromFolderId: folderId, toFolderId: w.files.folderNamed("Contracts").id });
  feed(w, "file.version_added", { fileId: f.id, n: f.version });
  w.google.calls.length = 0;
  await sync(w, mountId);
  await sync(w, mountId);
  const wrote = w.google.calls.filter((c) => /upload_file|update_file|trash_file|create_folder/.test(c.cap));
  assert.deepEqual(wrote, [], "nothing was sent to Drive");
  assert.deepEqual([w.google.uploads, w.google.updates], [[], []]);
  const row = item(w, mountId, "intro-renamed.pdf");
  assert.deepEqual([row["dirty"], row["wait_reason"]], [0, null]);
});

test("rule 6: an item marked changed with no real change (an old phantom mark) is cleared and no new revision goes out", async () => {
  const w = harness();
  const { mountId } = await add(w);
  const row = item(w, mountId, "intro.pdf");
  w.db.run("UPDATE mounts_item SET dirty = ? WHERE mount_id = ? AND item_key = ?", 1, mountId, row["item_key"]);
  await sync(w, mountId);
  assert.deepEqual([w.google.uploads, w.google.replaced], [[], []]);
  assert.equal(item(w, mountId, "intro.pdf")["dirty"], 0);
});

// ---- rule 7: view only, before the person types ----

test("rule 7: a file Drive says the person may not edit opens as view only", async () => {
  const w = harness();
  w.google.decorate("f1", { canEdit: false });
  const { mountId } = await add(w);
  const opened = (await call(w, "mounts.open", { fileId: w.files.fileNamed("intro.pdf").id })) as Row;
  assert.equal((opened["source"] as Row)["viewOnly"], true);
  assert.equal(item(w, mountId, "intro.pdf")["can_edit"], 0);
  const other = (await call(w, "mounts.open", { fileId: w.files.fileNamed("Budget").id })) as Row;
  assert.equal((other["source"] as Row)["viewOnly"], undefined, "a file with no such word stays editable");
});

// ---- rule 8: two-way by default; Read only is a choice; old mounts stay as they were ----

test("rule 8: a new mount is two-way unless the person chose Read only; Read only sends nothing", async () => {
  const w = harness();
  const two = await add(w);
  assert.equal(((await call(w, "mounts.get", { mountId: two.mountId }))["mount"] as Row)["readOnly"], false);
  const ro = await call(w, "mounts.add", {
    into: "fld_into",
    source: { kind: "sharepoint", connectionId: "con_m", ref: "drv1" },
    name: "Library",
    mode: "server_copy",
    readOnly: true,
  });
  const view = (await call(w, "mounts.get", { mountId: String(ro["mountId"]) }))["mount"] as Row;
  assert.equal(view["readOnly"], true);
  const readme = w.files.fileNamed("readme.md");
  feed(w, "file.version_added", { fileId: readme.id, n: w.files.edit(readme.id, "edited") });
  await sync(w, String(ro["mountId"]));
  assert.deepEqual([w.graph.uploads, w.graph.replaced], [[], []], "a Read only mount never sends");
  await call(w, "mounts.update", { mountId: String(ro["mountId"]), pullOnly: false });
  assert.equal(
    ((await call(w, "mounts.get", { mountId: String(ro["mountId"]) }))["mount"] as Row)["readOnly"],
    false,
    "and the owner can turn two-way on",
  );
});

test("rule 8: the migration leaves every mount made before write-back read only and offers two-way; a device or GitHub mount is untouched", () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
  const db = new DatabaseSync(":memory:");
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
  for (const f of files.filter((x) => !x.startsWith("0006"))) db.exec(readFileSync(join(dir, f), "utf8"));
  const ins = db.prepare(
    "INSERT INTO mounts_mount (id, folder_id, kind, name, mode, review_changes, pull_only, state, owner, created_at, updated_at) VALUES (?, 'fld', ?, 'm', 'live_only', 1, 0, 'idle', 'usr', 1, 1)",
  );
  for (const k of ["google_drive", "onedrive", "sharepoint", "dropbox", "local", "github"]) ins.run(`mnt_${k}`, k);
  db.exec(readFileSync(join(dir, files.find((f) => f.startsWith("0006"))!), "utf8"));
  const rows = db.prepare("SELECT kind, pull_only, two_way_offer FROM mounts_mount ORDER BY kind").all() as Row[];
  const by = Object.fromEntries(rows.map((r) => [r["kind"], [r["pull_only"], r["two_way_offer"]]]));
  assert.deepEqual(by, {
    dropbox: [0, 0],
    github: [0, 0],
    google_drive: [1, 1],
    local: [0, 0],
    onedrive: [1, 1],
    sharepoint: [1, 1],
  });
});

test("rule 8: a mount with the offer says so, and answering it (either way) clears it", async () => {
  const w = harness();
  const { mountId } = await add(w);
  w.db.run("UPDATE mounts_mount SET pull_only = ?, two_way_offer = ? WHERE id = ?", 1, 1, mountId);
  const before = (await call(w, "mounts.get", { mountId }))["mount"] as Row;
  assert.deepEqual([before["readOnly"], before["twoWayOffer"]], [true, true]);
  edit(w, "intro.pdf", "local only");
  await sync(w, mountId);
  assert.deepEqual([w.google.uploads, w.google.replaced], [[], []], "an old mount sends nothing by itself");
  await call(w, "mounts.update", { mountId, pullOnly: false });
  const after = (await call(w, "mounts.get", { mountId }))["mount"] as Row;
  assert.deepEqual([after["readOnly"], after["twoWayOffer"]], [false, undefined]);
});

// ---- a rename or move of a Graph item is the same item too ----

test("Graph: an edit goes up with the eTag, a move changes the parent of the same item, a delete is the recycle bin's delete", async () => {
  const w = harness();
  const { mountId, folderId } = await add(w, SHARE);
  const readme = w.files.fileNamed("readme.md");
  const remote = String(item(w, mountId, "readme.md")["remote_id"]);
  w.files.call("files.delete", { fileId: readme.id });
  feed(w, "file.deleted", { fileId: readme.id, folderId });
  await sync(w, mountId);
  assert.deepEqual(w.graph.deleted, [remote]);
  assert.ok(w.graph.keys.some((k) => k.cap === "ms.drive.delete_item"));
  w.files.call("files.restore", { fileId: readme.id });
  feed(w, "file.restored", { fileId: readme.id, folderId });
  await sync(w, mountId);
  assert.deepEqual(w.graph.restored, [remote], "taken back out of the recycle bin");
});

test("Graph: a restore OneDrive does not allow says so in one sentence on the file", async () => {
  const w = harness();
  const { mountId, folderId } = await add(w, SHARE);
  const readme = w.files.fileNamed("readme.md");
  w.files.call("files.delete", { fileId: readme.id });
  feed(w, "file.deleted", { fileId: readme.id, folderId });
  await sync(w, mountId);
  const real = w.graph.call.bind(w.graph);
  w.graph.call = (cap: string, i: Row): unknown => {
    if (cap === "ms.drive.restore_item")
      throw vyreErr(
        "validation.unsupported",
        "OneDrive does not let Vyre bring this back from its recycle bin. Restore it there.",
      );
    return real(cap, i);
  };
  w.files.call("files.restore", { fileId: readme.id });
  feed(w, "file.restored", { fileId: readme.id, folderId });
  await sync(w, mountId);
  assert.match(String(item(w, mountId, "readme.md")["wait_reason"]), /Restore it there\./);
});

// ---- the soak ----

/** A small deterministic generator, so a failure replays. */
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

for (const seed of [20261115, 7, 99, 1234, 31337]) {
  test(`soak (seed ${seed}): 200 mixed edits, renames, moves, creates, deletes and restores with injected failures and abandoned passes end with Drive and Vyre identical, nothing lost and nothing doubled`, async () => {
    const w = harness();
    const { mountId, folderId } = await add(w);
    const rnd = prng(seed);
    const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]!;
    const subs: string[] = [folderId, w.files.folderNamed("Contracts").id];
    let n = 0;
    const live = (): { id: string; name: string; folderId: string }[] =>
      [...w.files.files.values()].filter((f) => !f.deleted && subs.includes(f.folderId));
    const injected: string[] = [];
    const trail: string[] = [];
    for (let step = 0; step < 200; step++) {
      const op = pick(["edit", "edit", "rename", "move", "create", "delete", "restore", "pass", "pass"]);
      const files = live();
      const trashed = [...w.files.files.values()].filter((f) => f.deleted && subs.includes(f.folderId));
      try {
        if (op === "edit" && files.length) {
          const f = pick(files);
          feed(w, "file.version_added", { fileId: f.id, n: w.files.edit(f.id, `edit ${step}`) });
        } else if (op === "rename" && files.length) {
          const f = pick(files);
          n += 1;
          trail.push(`${step} rename ${f.name} -> r${n}.txt`);
          rename(w, f.id, f.name, `r${n}.txt`);
        } else if (op === "move" && files.length) {
          const f = pick(files);
          const to = pick(subs.filter((s) => s !== f.folderId));
          const from = f.folderId;
          trail.push(
            `${step} move ${f.name} ${from === folderId ? "root" : "Contracts"} -> ${to === folderId ? "root" : "Contracts"}`,
          );
          w.files.call("files.move", { fileId: f.id, toFolderId: to });
          feed(w, "file.moved", { fileId: f.id, fromFolderId: from, toFolderId: to });
        } else if (op === "create") {
          n += 1;
          const to = pick(subs);
          const made = (
            w.files.call("files.create", {
              folderId: to,
              name: `c${n}.txt`,
              content: { blobId: w.files.blob(`blb_s${n}`, `new ${n}`) },
            }) as Row
          ).file as Row;
          feed(w, "file.created", { fileId: String(made["fileId"]), folderId: to, name: `c${n}.txt` });
        } else if (op === "delete" && files.length > 2) {
          const f = pick(files);
          trail.push(`${step} delete ${f.name}`);
          w.files.call("files.delete", { fileId: f.id });
          feed(w, "file.deleted", { fileId: f.id, folderId: f.folderId });
        } else if (op === "restore" && trashed.length) {
          const f = pick(trashed);
          trail.push(`${step} restore ${f.name}`);
          w.files.call("files.restore", { fileId: f.id });
          feed(w, "file.restored", { fileId: f.id, folderId: f.folderId });
        } else if (op === "pass") {
          // some passes meet a provider that is down or answers 503 mid-way; some are abandoned by a restart (the state is the database, so the next pass simply continues)
          const r = rnd();
          trail.push(`${step} pass${r < 0.3 ? " (down)" : ""}`);
          if (r < 0.3) {
            w.google.failWith = vyreErr("provider.unavailable", "Drive is down.", true);
            injected.push("down");
          }
          await sync(w, mountId).catch(() => undefined);
          w.google.failWith = null;
        }
      } catch (e) {
        if (!(e instanceof Error) || !/name is already|no such|No such/i.test(e.message)) throw e;
      }
    }
    // the provider is back: a few passes settle everything that waited
    w.google.failWith = null;
    for (let i = 0; i < 4; i++) await sync(w, mountId);

    // Vyre's view: every live file under the mounted folder, by path and content
    const pathOf = (folder: string): string => {
      if (folder === folderId) return "";
      const f = w.files.folders.get(folder)!;
      return `${pathOf(f.parentId!)}${f.name}/`;
    };
    const vyre = live()
      .map((f) => `${pathOf(f.folderId)}${f.name}`)
      .sort();
    // Drive's view: every file in Drive's folders, by path
    const names = new Map<string, string>([["root_drv", ""]]);
    for (const [id, pages] of w.google.listings)
      for (const p of pages)
        for (const f of p["files"] as Row[])
          if (f["mimeType"] === "application/vnd.google-apps.folder") names.set(String(f["id"]), `${f["name"]}/`);
    const drive: string[] = [];
    for (const [parent, pages] of w.google.listings)
      for (const p of pages)
        for (const f of p["files"] as Row[])
          if (f["mimeType"] !== "application/vnd.google-apps.folder")
            drive.push(`${parent === "root_drv" ? "" : (names.get(parent) ?? "?/")}${f["name"]}`);
    // files Drive only listed (never changed in Vyre) are placeholders in Vyre with the same names
    assert.deepEqual(
      drive.sort(),
      vyre,
      `Drive and Vyre hold the same files (after ${injected.length} injected failures) ${process.env["SOAK_TRAIL"] ? trail.join("; ") : ""}`,
    );
    assert.equal(new Set(drive).size, drive.length, "no file is doubled");
    // content: every file Vyre changed is in Drive with Vyre's words
    for (const r of w.items(mountId)) {
      if (r["file_id"] && r["remote_id"] && !r["deleted"] && w.google.content.has(String(r["remote_id"])))
        assert.equal(
          w.google.content.get(String(r["remote_id"])),
          w.files.text(String(r["file_id"])),
          `content of ${String(r["name"])}`,
        );
    }
    assert.equal(
      w.items(mountId).filter((r) => r["dirty"] === 1 && r["conflict"] !== 1).length,
      0,
      "nothing is left waiting",
    );
  });
}
