// @reads /modules/mounts/handlers/engine.ts
// @reads /modules/mounts/handlers/providers.ts
// @reads /modules/mounts/projections.ts
// @reads /modules/mounts/migrations/0003_mounts_live.sql
// Live Folders: a cloud mount is live by default (placeholders, content fetched on open and cached by version), push channels and the poll fallback, conditional writes that keep both copies,
// the provider's history with restore, and who last edited a file.
import test from "node:test";
import assert from "node:assert/strict";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { handlers } from "../impl.ts";
import { localChangesConsumer } from "../projections.ts";
import { CLIENT_FRESH_MS, LIVE_POLL_MS, SYNC_INTERVAL_MS } from "../handlers/index.ts";
import { ME, NOW, harness } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";

type Row = Record<string, unknown>;

const call = (w: World, cap: keyof typeof handlers, input: Row, ctx?: Ctx): Promise<Row> => (handlers[cap] as (c: Ctx, i: unknown) => Promise<Row>)(ctx ?? w.ctx, input);

function feed(w: World, name: string, payload: Row, actor = "usr_owner"): void {
  const fn = localChangesConsumer.on[name];
  assert.ok(fn, `consumer for ${name}`);
  fn(w.db, { at: w.now(), actor, payload: new TextEncoder().encode(JSON.stringify(payload)) });
}

const DRIVE = { kind: "google_drive", connectionId: "con_g", ref: "root_drv" };
const SHARE = { kind: "sharepoint", connectionId: "con_m", ref: "drv1" };
const ADDRESS = { "mounts.public_address": "https://space.example/" };
const MAYA = { name: "Maya Lin", email: "maya@firm.test" };

async function add(w: World, source: Row, extra: Row = {}): Promise<string> {
  const r = await call(w, "mounts.add", { into: "fld_into", source, name: "Drive", ...extra });
  return String(r["mountId"]);
}
const view = async (w: World, mountId: string): Promise<Row> => (await call(w, "mounts.get", { mountId }))["mount"] as Row;
const sync = (w: World, mountId: string): Promise<Row> => call(w, "mounts.sync_now", { mountId });
const downloads = (w: World): number => w.google.calls.filter((c) => c.cap === "google.drive.download_file" || c.cap === "google.drive.export_file").length;
const itemFor = (w: World, mountId: string, name: string): Row => {
  const r = w.items(mountId).find((x) => x["name"] === name);
  assert.ok(r, `item ${name}`);
  return r;
};
const fileOf = (w: World, name: string): string => w.files.fileNamed(name).id;
/** A person edits the file in Vyre and the projection hears about it. */
function editInVyre(w: World, name: string, text: string, actor = "usr_owner"): string {
  const fileId = fileOf(w, name);
  feed(w, "file.version_added", { fileId, n: w.files.edit(fileId, text) }, actor);
  return fileId;
}

test("a cloud mount is live by default: the tree and metadata arrive, files are empty placeholders, nothing is downloaded", async () => {
  const w = harness();
  w.google.decorate("f1", { headRevisionId: "r1", lastModifyingUser: MAYA });
  const mountId = await add(w, DRIVE);
  const mount = await view(w, mountId);
  assert.equal(mount["mode"], "live_only");
  assert.deepEqual(w.files.paths(), ["Drive/Budget", "Drive/Contracts/nda.docx", "Drive/Plan", "Drive/intro.pdf"]);
  assert.equal(downloads(w), 0, "no content was fetched");
  assert.equal(w.files.text(fileOf(w, "intro.pdf")), "", "an empty placeholder");
  const item = itemFor(w, mountId, "intro.pdf");
  assert.deepEqual([item["cached_version"], item["remote_version"], item["remote_rev"], item["editor_name"], item["editor_email"]], [null, "2026-10-01T10:05:00.000Z", "r1", "Maya Lin", "maya@firm.test"]);
  assert.equal(item["dirty"], 0, "a placeholder is not a local change");

  const copy = await call(w, "mounts.add", { into: "fld_into", source: SHARE, name: "Library", mode: "server_copy" });
  assert.equal((await view(w, String(copy["mountId"])))["mode"], "server_copy", "a synced copy stays a choice");
  const sp = await add(w, { ...SHARE, ref: "drv2" }, { name: "Other library" });
  assert.equal((await view(w, sp))["mode"], "live_only", "SharePoint and OneDrive are live too");
});

test("opening a live file fetches it once, caches it by version and fetches again only when the provider changed it", async () => {
  const w = harness();
  const mountId = await add(w, DRIVE);
  const fileId = fileOf(w, "intro.pdf");
  const first = await call(w, "mounts.open", { fileId });
  assert.equal(first["fetched"], true);
  assert.equal(w.files.text(fileId), "drive:f1@2026-10-01T10:05:00.000Z");
  assert.equal((first["source"] as Row)["cached"], true);
  const again = await call(w, "mounts.open", { fileId });
  assert.deepEqual([again["fetched"], downloads(w)], [false, 1], "the cached copy is current");

  // someone saves it in Drive: the next open sees the new version without waiting for a pass
  w.google.decorate("f1", { modifiedTime: "2026-10-05T10:00:00.000Z", headRevisionId: "r2", lastModifyingUser: MAYA });
  const fresh = await call(w, "mounts.open", { fileId });
  assert.equal(fresh["fetched"], true);
  assert.equal(w.files.text(fileId), "drive:f1@2026-10-05T10:00:00.000Z");
  assert.deepEqual((fresh["source"] as Row)["lastEditedBy"], MAYA);
  assert.equal(itemFor(w, mountId, "intro.pdf")["dirty"], 0, "a fetch is not a local edit");

  // a pass that sees another change only marks the copy stale
  w.google.decorate("f1", { modifiedTime: "2026-10-06T10:00:00.000Z", headRevisionId: "r3" });
  await sync(w, mountId);
  assert.equal(w.files.text(fileId), "drive:f1@2026-10-05T10:00:00.000Z", "the pass fetched nothing");
  const stale = await call(w, "mounts.open", { fileId: fileOf(w, "intro.pdf") });
  assert.equal(stale["fetched"], true);
  assert.equal(downloads(w), 3);

  assert.deepEqual(await call(w, "mounts.open", { fileId: "fil_nowhere" }), { mounted: false, fetched: false });
});

test("a file still opens from the cache when the provider cannot be reached", async () => {
  const w = harness();
  await add(w, DRIVE);
  const fileId = fileOf(w, "intro.pdf");
  await call(w, "mounts.open", { fileId });
  w.google.failWith = (await import("../fixtures/world.ts")).vyreErr("provider.unavailable", "Drive is down.", true);
  const r = await call(w, "mounts.open", { fileId });
  assert.deepEqual([r["fetched"], r["offline"]], [false, true]);
  assert.equal(w.files.text(fileId), "drive:f1@2026-10-01T10:05:00.000Z");
});

test("becoming a synced copy brings every file's content in; becoming live keeps what was fetched", async () => {
  const w = harness();
  const mountId = await add(w, DRIVE);
  await call(w, "mounts.open", { fileId: fileOf(w, "intro.pdf") });
  await call(w, "mounts.update", { mountId, mode: "server_copy" });
  assert.ok(w.scheduled.some((s) => s.cap === "mounts.sync_now"), "a pass is queued");
  await sync(w, mountId);
  assert.equal(w.files.text(fileOf(w, "intro.pdf")), "drive:f1@2026-10-01T10:05:00.000Z");
  assert.equal(w.files.text(fileOf(w, "Plan")), "export:g1@2026-10-02T09:00:00.000Z");
  assert.equal(w.files.text(fileOf(w, "nda.docx")).startsWith("drive:"), true);
  const copied = downloads(w);
  await call(w, "mounts.update", { mountId, mode: "live_only" });
  await sync(w, mountId);
  assert.equal(downloads(w), copied, "nothing is fetched again");
  assert.equal(itemFor(w, mountId, "intro.pdf")["cached_version"], "2026-10-01T10:05:00.000Z");
});

test("a write is sent with the revision it was based on and replaces the file in place; the revision is noted with who made the edit", async () => {
  const w = harness();
  w.google.decorate("f1", { headRevisionId: "r1", lastModifyingUser: MAYA });
  const mountId = await add(w, DRIVE, { mode: "server_copy" });
  const fileId = editInVyre(w, "intro.pdf", "revised");
  await sync(w, mountId);
  assert.deepEqual(w.google.replaced, [{ remoteId: "f1", ifRevision: "r1" }]);
  const item = itemFor(w, mountId, "intro.pdf");
  assert.deepEqual([item["remote_id"], item["remote_rev"], item["dirty"], item["conflict"]], ["f1", "rev_up1", 0, 0]);
  assert.deepEqual(w.named("mount.file_sent"), [{ mountId, folderId: w.mountRow(mountId)["folder_id"], fileId, name: "intro.pdf", revisionId: "rev_up1", by: "usr_owner" }]);
  assert.deepEqual((w.db.rows("mounts_revision") as Row[]).map((r) => [r["remote_id"], r["revision_id"], r["by_actor"]]), [["f1", "rev_up1", "usr_owner"]]);
});

test("a file that moved on at the provider is never overwritten: the Vyre edit is kept as a copy and the mount raises a conflict", async () => {
  const w = harness();
  w.google.decorate("f1", { headRevisionId: "r1" });
  const mountId = await add(w, DRIVE, { mode: "server_copy" });
  const fileId = editInVyre(w, "intro.pdf", "my edit");
  // Maya saved in Drive after this pass read the listing: same modified time, new head revision
  w.google.decorate("f1", { headRevisionId: "r9", lastModifyingUser: MAYA });
  await sync(w, mountId);
  assert.deepEqual(w.google.replaced, [], "the file at Drive was left alone");
  assert.deepEqual(w.google.uploads.map((u) => u.name), ["intro (Noah's edit).pdf"], "both are kept");
  assert.equal(w.google.uploads[0]?.fileId, fileId);
  const item = itemFor(w, mountId, "intro.pdf");
  assert.deepEqual([item["conflict"], item["dirty"]], [1, 0]);
  assert.equal(w.files.text(fileId), "my edit", "the edit in Vyre is still there");
  assert.deepEqual(w.named("mount.conflict"), [{ mountId, folderId: w.mountRow(mountId)["folder_id"], fileId, name: "intro.pdf", keptAs: "intro (Noah's edit).pdf" }]);
  assert.equal((await view(w, mountId))["conflicts"], 1);
  assert.ok(w.scheduled.some((s) => s.cap === "mounts.sync_now"), "one more pass brings the provider's copies in");
});

test("a Graph write is conditional on the eTag: If-Match goes out, and a stale item keeps both", async () => {
  const w = harness();
  w.graph.decorate("m3", { eTag: "e1", lastModifiedBy: { user: { displayName: "Maya Lin", email: "maya@firm.test" } } });
  const mountId = await add(w, SHARE, { mode: "server_copy" });
  await sync(w, mountId);
  await sync(w, mountId);
  const fileId = editInVyre(w, "README.md", "one");
  await sync(w, mountId);
  assert.deepEqual(w.graph.replaced, [{ remoteId: "m3", ifMatch: "e1" }]);
  const sent = itemFor(w, mountId, "README.md");
  assert.equal(sent["remote_rev"], "etag_up1");
  assert.deepEqual([sent["editor_name"], sent["editor_email"]], ["Noah Reyes", ME]);

  w.graph.etags.set("m3", "someone-else");
  editInVyre(w, "README.md", "two");
  await sync(w, mountId);
  assert.equal(w.graph.replaced.length, 1, "not overwritten");
  assert.equal(w.graph.uploads.at(-1)?.name, "README (Noah's edit).md");
  assert.equal(itemFor(w, mountId, "README.md")["conflict"], 1);
  assert.equal(w.named("mount.conflict").length, 1);
  assert.ok(fileId);
});

test("history lists the provider's revisions newest first and names the person or agent behind the ones Vyre sent; restore puts one back as the newest", async () => {
  const w = harness();
  w.google.decorate("f1", { modifiedTime: "2026-10-01T10:05:00.000Z", headRevisionId: "r1", lastModifyingUser: MAYA });
  const mountId = await add(w, DRIVE, { mode: "server_copy" });
  const fileId = editInVyre(w, "intro.pdf", "agent edit", "agt_scribe");
  await sync(w, mountId);

  const h = await call(w, "mounts.history", { fileId });
  const revs = h["revisions"] as Row[];
  assert.deepEqual(revs.map((r) => [r["revisionId"], r["current"]]), [["rev_up1", true], ["r1", false]]);
  assert.deepEqual(revs[0]?.["by"], { name: "Noah Reyes", email: ME, actor: "agt_scribe" });
  assert.deepEqual(revs[1]?.["by"], MAYA);

  const restored = await call(w, "mounts.restore", { fileId, revisionId: "r1" });
  assert.equal(restored["restored"], true);
  assert.equal(w.files.text(fileId), "rev:f1@r1");
  assert.equal(w.files.fileNamed("intro.pdf").reasons.at(-1), "Restored from Google Drive history");
  assert.deepEqual(w.google.replaced.at(-1), { remoteId: "f1", ifRevision: "rev_up1" }, "the restore goes out like any edit, conditional on the head");
  assert.equal(((await call(w, "mounts.history", { fileId }))["revisions"] as Row[]).length, 3);
});

test("last edited by comes from the provider and is listed for the rows of a folder", async () => {
  const w = harness();
  w.google.decorate("f1", { headRevisionId: "r1", modifiedTime: "2026-10-01T10:05:00.000Z", lastModifyingUser: MAYA });
  await add(w, DRIVE);
  const out = await call(w, "mounts.editors", { fileIds: [fileOf(w, "intro.pdf"), fileOf(w, "Plan"), "fil_nowhere"] });
  assert.deepEqual(out["editors"], [{ fileId: fileOf(w, "intro.pdf"), provider: "Google Drive", ...MAYA, at: Date.parse("2026-10-01T10:05:00.000Z") }, { fileId: fileOf(w, "Plan"), provider: "Google Drive", at: Date.parse("2026-10-02T09:00:00.000Z") }]);
});

test("with a public address a Drive mount holds a push channel, a notice runs a pass, and the channel is replaced before it expires", async () => {
  const w = harness({ settings: ADDRESS });
  w.google.startToken = "tok3";
  const mountId = await add(w, DRIVE);
  assert.deepEqual(w.google.watches.map((x) => [x.pageToken, x.address]), [["tok3", "https://space.example/hooks/google/drive"]]);
  const row = w.mountRow(mountId);
  const channel = String(row["watch_id"]);
  assert.deepEqual([row["watch_resource"], row["watch_expires"]], ["res_1", NOW + 60 * 60 * 1000]);
  const mount = await view(w, mountId);
  assert.deepEqual([mount["live"], mount["liveVia"]], [true, "push"]);

  const passes = (): number => w.named("mount.synced").length;
  const before = passes();
  assert.deepEqual(await call(w, "mounts.nudge", { source: "google", channelId: "chn_stranger" }), { mounts: 0, passes: 0 });
  assert.equal(passes(), before);
  assert.deepEqual(await call(w, "mounts.nudge", { source: "google", channelId: channel }), { mounts: 1, passes: 1 });
  assert.equal(passes(), before + 1);

  w.advance(60 * 60 * 1000 - 5 * 60 * 1000);
  await sync(w, mountId);
  assert.equal(w.google.watches.length, 2, "a new channel opened first");
  assert.deepEqual(w.google.stopped, [{ channelId: channel, resourceId: "res_1" }], "then the old one closed");
  assert.notEqual(w.mountRow(mountId)["watch_id"], channel);
});

test("without a public address, or a start token, a mount is polled: no channel is opened", async () => {
  const w = harness();
  w.google.startToken = "tok3";
  const mountId = await add(w, DRIVE);
  assert.equal(w.google.watches.length, 0);
  assert.equal((await view(w, mountId))["liveVia"], "poll");
  const noToken = harness({ settings: ADDRESS });
  const id = await add(noToken, DRIVE);
  assert.deepEqual([noToken.google.watches.length, noToken.mountRow(id)["watch_id"]], [0, null], "the first pass scans, there is no change token to watch from");
});

test("an app showing a mount polls it every 30 seconds while it is open and goes back to 5 minutes after", async () => {
  const w = harness();
  const mountId = await add(w, DRIVE);
  const next = (): Row => w.scheduled.at(-1) as unknown as Row;
  assert.equal(next()["at"], NOW + SYNC_INTERVAL_MS);
  assert.equal((await view(w, mountId))["live"], false, "nobody is looking and nothing pushes");

  w.advance(10_000);
  assert.deepEqual(await call(w, "mounts.nudge", { source: "client", mountId }), { mounts: 1, passes: 0 });
  assert.equal(next()["at"], NOW + 10_000 + LIVE_POLL_MS, "the next pass is 30 s out, not 5 minutes");

  w.advance(LIVE_POLL_MS);
  assert.deepEqual(await call(w, "mounts.nudge", { source: "client", mountId }), { mounts: 1, passes: 1 });
  assert.equal((await view(w, mountId))["live"], true);

  w.advance(CLIENT_FRESH_MS + 1);
  assert.equal((await view(w, mountId))["live"], false, "the app went away");
  await sync(w, mountId);
  assert.equal(next()["at"], w.now() + SYNC_INTERVAL_MS);
});

test("a SharePoint mount holds a Graph subscription that the microsoft module renews; a replaced subscription is followed", async () => {
  const w = harness({ settings: ADDRESS });
  const mountId = await add(w, SHARE);
  assert.deepEqual(w.graph.subs, [{ subscriptionId: "sub1", notificationUrl: "https://space.example/hooks/microsoft" }]);
  const row = w.mountRow(mountId);
  assert.deepEqual([row["watch_id"], row["watch_expires"]], ["sub1", null]);
  assert.equal((await view(w, mountId))["liveVia"], "push");
  const before = w.named("mount.synced").length;
  assert.deepEqual(await call(w, "mounts.nudge", { source: "microsoft", subscriptionId: "sub1" }), { mounts: 1, passes: 1 });
  assert.equal(w.named("mount.synced").length, before + 1);
  assert.deepEqual(await call(w, "mounts.nudge", { source: "microsoft", subscriptionId: "sub1", replacedBy: "sub2" }), { mounts: 1, passes: 0 });
  assert.equal(w.mountRow(mountId)["watch_id"], "sub2");
  assert.deepEqual(w.graph.unsubscribed, [], "the mount never opens a second subscription for the same drive");
});
