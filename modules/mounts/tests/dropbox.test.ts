// @reads /modules/mounts/handlers/dropbox-provider.ts
// @reads /modules/mounts/handlers/providers.ts
// @reads /modules/mounts/handlers/engine.ts
// The Dropbox mount provider (live folders L3): the first full read, the change feed that follows (renames, moves, deletes named by id), parents asked for once, a cursor Dropbox lost, the writes going out,
// browse, and a whole mount from add to a second sync. A fake Dropbox sits behind the dropbox.* capabilities; it keeps a tree and a change log the way Dropbox does.
import test from "node:test";
import assert from "node:assert/strict";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { handlers } from "../impl.ts";
import { PROVIDER_LABEL, isCloud, providerOf } from "../handlers/providers.ts";
import type { MountRec } from "../handlers/index.ts";
import { TRACE, harness } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";

type Row = Record<string, unknown>;

interface Node { id: string; name: string; path: string; isFolder: boolean; rev?: string; size?: number }

/** A Dropbox: nodes by id, a change log, paged full listings and a feed cursor. Every call is recorded. */
class FakeDropbox {
  readonly calls: { cap: string; input: Row }[] = [];
  readonly nodes = new Map<string, Node>();
  private log: { seq: number; entry: Row }[] = [];
  private seq = 0;
  pageSize = 100;
  webhooks = true;
  private made = 0;

  constructor() {
    this.add({ id: "id:sales", name: "Sales", path: "/Sales", isFolder: true });
    this.add({ id: "id:report", name: "Report.docx", path: "/Sales/Report.docx", isFolder: false, rev: "r1", size: 1200 });
    this.add({ id: "id:q4", name: "Q4", path: "/Sales/Q4", isFolder: true });
    this.add({ id: "id:deck", name: "Deck.pptx", path: "/Sales/Q4/Deck.pptx", isFolder: false, rev: "d1", size: 90 });
    this.add({ id: "id:other", name: "Other.txt", path: "/Other.txt", isFolder: false, rev: "o1", size: 5 });
    this.log = [];
  }

  private entry(n: Node): Row {
    return { id: n.id, name: n.name, path: n.path, pathLower: n.path.toLowerCase(), isFolder: n.isFolder, ...(n.rev ? { rev: n.rev } : {}), ...(n.size !== undefined ? { size: n.size } : {}), webUrl: "https://www.dropbox.com/home" };
  }

  add(n: Node): void {
    this.nodes.set(n.id, n);
    this.log.push({ seq: ++this.seq, entry: this.entry(n) });
  }

  edit(id: string, rev: string): void {
    const n = this.nodes.get(id) as Node;
    n.rev = rev;
    this.log.push({ seq: ++this.seq, entry: this.entry(n) });
  }

  rename(id: string, name: string): void {
    const n = this.nodes.get(id) as Node;
    const old = n.path;
    n.name = name;
    n.path = `${old.slice(0, old.lastIndexOf("/"))}/${name}`;
    this.log.push({ seq: ++this.seq, entry: this.entry(n) });
  }

  drop(id: string): void {
    const n = this.nodes.get(id) as Node;
    this.nodes.delete(id);
    this.log.push({ seq: ++this.seq, entry: { id: "", name: n.name, path: n.path, pathLower: n.path.toLowerCase(), isFolder: n.isFolder, deleted: true, webUrl: "" } });
  }

  private find(path: string): Node | undefined {
    if (path.startsWith("id:")) return this.nodes.get(path);
    return [...this.nodes.values()].find((n) => n.path.toLowerCase() === path.toLowerCase());
  }

  private under(path: string, recursive: boolean): Node[] {
    const base = path === "" ? "" : (this.find(path)?.path ?? path);
    return [...this.nodes.values()].filter((n) => n.path.startsWith(`${base}/`) && (recursive || n.path.slice(base.length + 1).indexOf("/") < 0)).sort((a, b) => a.path.localeCompare(b.path));
  }

  call(cap: string, i: Row): unknown {
    this.calls.push({ cap, input: i });
    if (cap === "dropbox.files.get_metadata") {
      const n = this.find(String(i["path"]));
      if (!n) throw new VyreErr({ code: "validation.not_found" as never, message: "Dropbox has no such file or folder.", retryable: false, traceId: TRACE, next: [] });
      return { entry: this.entry(n) };
    }
    if (cap === "dropbox.files.list_folder") {
      const cursor = i["cursor"];
      if (typeof cursor === "string") {
        if (cursor === "feed:lost") throw new VyreErr({ code: "validation.precondition_failed" as never, message: "gone", retryable: false, traceId: TRACE, next: [], details: { reason: "cursor_reset" } } as never);
        if (cursor.startsWith("page:")) return this.page(Number(cursor.split(":")[1]), String(cursor.split(":")[2]));
        const since = Number(cursor.slice(5));
        const entries = this.log.filter((l) => l.seq > since).map((l) => l.entry);
        return { entries, cursor: `feed:${this.seq}`, hasMore: false };
      }
      const path = String(i["path"] ?? "");
      this.listing = this.under(path, i["recursive"] === true);
      return this.page(0, path);
    }
    if (cap === "dropbox.files.download") {
      const n = this.find(String(i["path"]));
      // content is the revision, so a test can see which one was fetched
      return { blobId: `blb_dbx_${String(i["path"]).replace(/\W/g, "")}_${String(i["rev"] ?? n?.rev ?? "x")}`, size: 7, mime: "application/octet-stream" };
    }
    if (cap === "dropbox.files.list_revisions") {
      const n = this.find(String(i["path"]));
      return { revisions: [{ id: n?.id ?? "", name: n?.name ?? "", path: n?.path ?? "", pathLower: (n?.path ?? "").toLowerCase(), isFolder: false, rev: n?.rev ?? "", size: n?.size ?? 0, modified: "2026-10-20T10:00:00Z", webUrl: "" }, { id: n?.id ?? "", name: n?.name ?? "", path: n?.path ?? "", pathLower: "", isFolder: false, rev: "r0", size: 4, modified: "2026-10-01T10:00:00Z", webUrl: "" }], deleted: false };
    }
    if (cap === "dropbox.app.status") return { configured: true, webhooks: this.webhooks };
    if (cap === "dropbox.account.list") return { connections: [{ connectionId: "con_d", ownerKind: "person", accountId: "dbid:AAH4" }] };
    if (cap === "dropbox.files.create_folder") {
      const path = String(i["path"]);
      const n: Node = { id: `id:new${++this.made}`, name: path.slice(path.lastIndexOf("/") + 1), path, isFolder: true };
      this.add(n);
      return { entry: this.entry(n) };
    }
    if (cap === "dropbox.files.upload") {
      const path = String(i["path"]);
      const there = this.find(path);
      if (there && i["rev"] !== undefined && i["rev"] !== there.rev) throw new VyreErr({ code: "validation.version_conflict" as never, message: "moved on", retryable: false, traceId: TRACE, next: [] });
      const n: Node = there ?? { id: `id:new${++this.made}`, name: path.slice(path.lastIndexOf("/") + 1), path, isFolder: false };
      n.rev = `u${++this.made}`;
      n.size = 3;
      if (!there) this.add(n); else this.edit(n.id, n.rev);
      return { entry: this.entry(n) };
    }
    if (cap === "dropbox.files.delete") {
      const n = this.find(String(i["path"]));
      if (n) this.drop(n.id);
      return { deleted: true };
    }
    throw new Error(`unscripted ${cap}`);
  }

  private listing: Node[] = [];
  private page(at: number, key: string): Row {
    const slice = this.listing.slice(at, at + this.pageSize);
    const more = at + this.pageSize < this.listing.length;
    return { entries: slice.map((n) => this.entry(n)), cursor: more ? `page:${at + this.pageSize}:${key}` : `feed:${this.seq}`, hasMore: more };
  }
}

function world(): { w: World; db: FakeDropbox } {
  const w = harness();
  const db = new FakeDropbox();
  const inner = w.ctx.call.bind(w.ctx);
  (w.ctx as { call: Ctx["call"] }).call = (async (cap: string, input: unknown) => (cap.startsWith("dropbox.") ? db.call(cap, input as Row) : inner(cap as never, input as never))) as Ctx["call"];
  return { w, db };
}

const mount = (o: Partial<MountRec> = {}): MountRec => ({ id: "mnt_x", folderId: "fld_x", kind: "dropbox", connectionId: "con_d", ref: "id:sales", name: "Sales", mode: "server_copy", reviewChanges: true, pullOnly: false, ...o });
const call = (w: World, cap: keyof typeof handlers, input: Row): Promise<Row> => (handlers[cap] as (c: Ctx, i: unknown) => Promise<Row>)(w.ctx, input);

async function expectCode(code: string, run: () => Promise<unknown>): Promise<void> {
  try { await run(); } catch (e) {
    assert.ok(e instanceof VyreErr, e instanceof Error ? (e.stack ?? e.message) : "throw");
    assert.equal(e.error.code, code);
    return;
  }
  assert.fail(`expected ${code}`);
}

test("Dropbox is a cloud kind with its own name", () => {
  assert.equal(PROVIDER_LABEL.dropbox, "Dropbox");
  assert.equal(isCloud("dropbox"), true);
  assert.equal(providerOf("dropbox").label, "Dropbox");
  assert.equal(providerOf("dropbox").pushes, true);
});

test("the first pass reads the mounted folder in full (paged), with parents by id and the revision as the version", async () => {
  const { w, db } = world();
  db.pageSize = 2;
  const batch = await providerOf("dropbox").pull!(w.ctx, mount());
  assert.equal(batch.full, true);
  assert.match(String(batch.cursor), /^feed:\d+$/, "the cursor is the feed's, kept for the next pass");
  assert.deepEqual(batch.items.map((x) => [x.id, x.isFolder, x.version, x.revision, x.size]).sort(), [["id:deck", false, "d1", "d1", 90], ["id:q4", true, undefined, undefined, undefined], ["id:report", false, "r1", "r1", 1200]]);
  const byId = Object.fromEntries(batch.items.map((x) => [x.id, x.parentId]));
  assert.deepEqual(byId, { "id:q4": "id:sales", "id:deck": "id:q4", "id:report": "id:sales" });
  assert.equal(batch.items.find((x) => x.id === "id:report")?.version, "r1");
  assert.ok(!batch.items.some((x) => x.id === "id:other"), "what is outside the mounted folder is not read");
  const reads = db.calls.filter((c) => c.cap === "dropbox.files.list_folder");
  assert.deepEqual(reads[0]?.input, { connectionId: "con_d", path: "id:sales", recursive: true, limit: 2000 });
  assert.equal(reads.length, 2, "two pages of two");
  assert.deepEqual(db.calls.filter((c) => c.cap === "dropbox.files.get_metadata").map((c) => c.input["path"]), ["id:sales"], "the mounted folder's own path, once");
});

test("the whole account mounts at / and its top-level items hang off that root", async () => {
  const { w, db } = world();
  const batch = await providerOf("dropbox").pull!(w.ctx, mount({ ref: "/" }));
  assert.equal(batch.items.find((x) => x.id === "id:other")?.parentId, "/");
  assert.equal(batch.items.find((x) => x.id === "id:sales")?.parentId, "/");
  assert.equal(db.calls.some((c) => c.cap === "dropbox.files.get_metadata"), false, "no root to look up");
  assert.deepEqual(db.calls.find((c) => c.cap === "dropbox.files.list_folder")?.input, { connectionId: "con_d", path: "", recursive: true, limit: 2000 });
});

test("the next pass reads the feed: an edit, a rename and a delete (by id); a parent outside the batch is asked for once", async () => {
  const { w, db } = world();
  const first = await providerOf("dropbox").pull!(w.ctx, mount());
  db.calls.length = 0;
  db.edit("id:deck", "d2");
  db.edit("id:deck", "d3");
  db.rename("id:report", "Final.docx");
  db.add({ id: "id:memo", name: "Memo.txt", path: "/Sales/Q4/Memo.txt", isFolder: false, rev: "m1", size: 2 });
  db.drop("id:report");
  const next = await providerOf("dropbox").pull!(w.ctx, mount({ cursor: first.cursor as string }));
  assert.equal(next.full, false);
  assert.deepEqual(next.removed, [], "a delete the module could not name has no id");
  const deck = next.items.filter((x) => x.id === "id:deck");
  assert.equal(deck.length, 2);
  assert.equal(deck.at(-1)?.version, "d3");
  assert.equal(next.items.find((x) => x.id === "id:memo")?.parentId, "id:q4");
  // /Sales/Q4 was not in the batch, so it was asked for, once, not per item
  const asked = db.calls.filter((c) => c.cap === "dropbox.files.get_metadata").map((c) => c.input["path"]);
  assert.deepEqual(asked, ["id:sales", "/sales/q4"]);
  assert.notEqual(next.cursor, first.cursor);
  assert.match(String(next.cursor), /^feed:/);
});

test("a delete the feed names with an id removes that mounted item", async () => {
  const { w, db } = world();
  const first = await providerOf("dropbox").pull!(w.ctx, mount());
  db.drop("id:deck");
  // the dropbox module answers a deleted path with the id it indexed; the fake does the same
  const real = db.call.bind(db);
  db.call = (cap: string, i: Row) => {
    const out = real(cap, i) as Row;
    if (cap === "dropbox.files.list_folder" && typeof i["cursor"] === "string") for (const e of out["entries"] as Row[]) if (e["deleted"] === true) e["id"] = "id:deck";
    return out;
  };
  const next = await providerOf("dropbox").pull!(w.ctx, mount({ cursor: first.cursor as string }));
  assert.deepEqual(next.removed, ["id:deck"]);
});

test("a cursor Dropbox lost falls back to one full read", async () => {
  const { w, db } = world();
  const batch = await providerOf("dropbox").pull!(w.ctx, mount({ cursor: "feed:lost" }));
  assert.equal(batch.full, true);
  assert.equal(batch.items.length, 3);
  assert.deepEqual(db.calls.filter((c) => c.cap === "dropbox.files.list_folder").map((c) => c.input["cursor"] ?? "full"), ["feed:lost", "full"]);
  await expectCode("validation.not_found", () => providerOf("dropbox").pull!(w.ctx, mount({ ref: "id:gone" })));
});

test("download, upload, new folder and delete use the connection and carry the paths Dropbox needs", async () => {
  const { w, db } = world();
  const p = providerOf("dropbox");
  const m = mount();
  const got = await p.download!(w.ctx, m, { remoteId: "id:report", name: "Report.docx" });
  assert.deepEqual([got.size, got.mime], [7, "application/octet-stream"]);
  assert.deepEqual(db.calls[0], { cap: "dropbox.files.download", input: { connectionId: "con_d", path: "id:report" } });
  db.calls.length = 0;

  const folder = await p.createFolder!(w.ctx, m, { name: "Drafts", parentRemote: "id:sales" });
  assert.deepEqual(db.calls.map((c) => [c.cap, c.input["path"]]), [["dropbox.files.get_metadata", "id:sales"], ["dropbox.files.create_folder", "/Sales/Drafts"]]);
  db.calls.length = 0;
  const fresh = await p.upload!(w.ctx, m, { fileId: "fil_1", name: "a.txt", parentRemote: folder.remoteId });
  assert.deepEqual(db.calls.map((c) => [c.cap, c.input["path"], c.input["rev"]]), [["dropbox.files.get_metadata", folder.remoteId, undefined], ["dropbox.files.upload", "/Sales/Drafts/a.txt", undefined]]);
  assert.match(String(fresh.version), /^u/);
  db.calls.length = 0;

  // an existing file is replaced on the revision the write was based on, or on the current one when none is recorded
  const sent = await p.upload!(w.ctx, m, { fileId: "fil_2", name: "Report.docx", parentRemote: "id:sales", remoteId: "id:report", ifMatch: { revision: "r1" } });
  assert.deepEqual(db.calls.at(-1)?.input, { connectionId: "con_d", fileId: "fil_2", path: "/Sales/Report.docx", rev: "r1" });
  assert.deepEqual([sent.remoteId, sent.stale, sent.revision === sent.version, typeof sent.revision], ["id:report", undefined, true, "string"], "the new revision is the version and the revision");
  // a file that moved on is left alone and the answer says nothing was written: the engine keeps both copies
  const late = await p.upload!(w.ctx, m, { fileId: "fil_2", name: "Report.docx", parentRemote: "id:sales", remoteId: "id:report", ifMatch: { revision: "stale" } });
  assert.deepEqual(late, { remoteId: "id:report", stale: true });
  db.calls.length = 0;
  await p.upload!(w.ctx, m, { fileId: "fil_3", name: "Deck.pptx", parentRemote: "id:q4", remoteId: "id:deck" });
  assert.equal(db.calls.at(-1)?.input["rev"], "d1", "no recorded revision: the current one");

  await p.remove!(w.ctx, m, "id:deck", false);
  assert.deepEqual(db.calls.at(-1), { cap: "dropbox.files.delete", input: { connectionId: "con_d", path: "id:deck" } });
  const root = await p.createFolder!(w.ctx, mount({ ref: "/" }), { name: "Top", parentRemote: "/" });
  assert.equal(db.nodes.get(root.remoteId)?.path, "/Top", "a folder at the account root has no parent path");
});

test("browse lists the top of the account after a row that mounts all of it, then a folder's own items, paged and searchable", async () => {
  const { w, db } = world();
  const top = await call(w, "mounts.browse", { kind: "dropbox", connectionId: "con_d", limit: 50 });
  assert.deepEqual((top["items"] as Row[]).map((x) => [x["ref"], x["name"], x["isFolder"]]), [["/", "All of Dropbox", true], ["id:other", "Other.txt", false], ["id:sales", "Sales", true]]);
  assert.deepEqual(db.calls[0]?.input, { connectionId: "con_d", path: "", limit: 50 });
  const inSales = await call(w, "mounts.browse", { kind: "dropbox", connectionId: "con_d", parent: "id:sales" });
  assert.deepEqual((inSales["items"] as Row[]).map((x) => x["name"]), ["Q4", "Report.docx"]);
  const found = await call(w, "mounts.browse", { kind: "dropbox", connectionId: "con_d", q: "oth" });
  assert.deepEqual((found["items"] as Row[]).map((x) => x["name"]), ["Other.txt"]);
  db.pageSize = 1;
  const paged = await call(w, "mounts.browse", { kind: "dropbox", connectionId: "con_d", parent: "id:sales" });
  assert.equal((paged["items"] as Row[]).length, 1);
  assert.ok(paged["next"]);
  const more = await call(w, "mounts.browse", { kind: "dropbox", connectionId: "con_d", cursor: String(paged["next"]) });
  assert.equal((more["items"] as Row[]).length, 1);
  await expectCode("validation.bad_input", () => call(w, "mounts.browse", { kind: "dropbox" }));
});

test("a Dropbox mount from add to the second sync: files land in the folder, a change comes in as a new version", async () => {
  const { w, db } = world();
  const added = await call(w, "mounts.add", { into: "fld_into", source: { kind: "dropbox", connectionId: "con_d", ref: "id:sales" }, name: "Sales (Dropbox)", mode: "server_copy" });
  const mountId = String(added["mountId"]);
  assert.equal(w.mountRow(mountId)["kind"], "dropbox");
  assert.deepEqual(w.files.paths(), ["Sales (Dropbox)/Q4/Deck.pptx", "Sales (Dropbox)/Report.docx"]);
  assert.equal(w.mountRow(mountId)["cursor"] !== null, true, "the feed cursor is kept");
  assert.equal(w.items(mountId).find((x) => x["remote_id"] === "id:report")?.["remote_version"], "r1");

  db.edit("id:report", "r2");
  db.add({ id: "id:memo", name: "Memo.txt", path: "/Sales/Memo.txt", isFolder: false, rev: "m1", size: 2 });
  await call(w, "mounts.sync_now", { mountId });
  assert.deepEqual(w.files.paths(), ["Sales (Dropbox)/Memo.txt", "Sales (Dropbox)/Q4/Deck.pptx", "Sales (Dropbox)/Report.docx"]);
  assert.equal(w.files.fileNamed("Report.docx").version, 2, "the edit came in as a new version");
  const reads = db.calls.filter((c) => c.cap === "dropbox.files.list_folder");
  assert.equal(reads.at(-1)?.input["cursor"] !== undefined, true, "the second pass read the feed, not the folder");

  await expectCode("validation.bad_input", () => call(w, "mounts.add", { into: "fld_into", source: { kind: "dropbox", ref: "id:sales" } }));
  await expectCode("validation.bad_input", () => call(w, "mounts.add", { into: "fld_into", source: { kind: "dropbox", connectionId: "con_d" } }));
  await expectCode("validation.duplicate", () => call(w, "mounts.add", { into: "fld_into", source: { kind: "dropbox", connectionId: "con_d", ref: "id:sales" } }));
});

test("stat answers the item as Dropbox holds it now, or nothing when it is gone", async () => {
  const { w, db } = world();
  const p = providerOf("dropbox");
  const now = await p.stat!(w.ctx, mount(), "id:report");
  assert.deepEqual([now?.id, now?.revision, now?.version, now?.size, now?.isFolder], ["id:report", "r1", "r1", 1200, false]);
  db.drop("id:report");
  assert.equal(await p.stat!(w.ctx, mount(), "id:report"), undefined);
});

test("history lists Dropbox's revisions and fetches one revision's bytes", async () => {
  const { w, db } = world();
  const p = providerOf("dropbox");
  const revs = await p.revisions!(w.ctx, mount(), "id:report");
  assert.deepEqual(revs.map((r) => [r.id, r.size]), [["r1", 1200], ["r0", 4]]);
  assert.equal(typeof revs[0]?.at, "number");
  const blob = await p.revisionBlob!(w.ctx, mount(), { remoteId: "id:report", revisionId: "r0" });
  assert.match(blob.blobId, /_r0$/);
  assert.deepEqual(db.calls.at(-1)?.input, { connectionId: "con_d", path: "id:report", rev: "r0" });
});

test("a mount on an account whose app verifies change notices is watched by the account; without them it is polled", async () => {
  const { w, db } = world();
  const p = providerOf("dropbox");
  assert.equal(p.hookPath, "/hooks/dropbox");
  assert.deepEqual(await p.watch!(w.ctx, mount(), { address: "https://space.example/hooks/dropbox", channelId: "chn_1" }), { id: "dbx:dbid:AAH4", expiresAt: 0 });
  db.webhooks = false;
  assert.equal(await p.watch!(w.ctx, mount(), { address: "https://space.example/hooks/dropbox", channelId: "chn_2" }), undefined);
  await p.unwatch!(w.ctx, mount(), { id: "dbx:dbid:AAH4" });
});

test("live by default: the tree arrives as placeholders, opening fetches once, and a change by a person in Dropbox is fetched on the next open", async () => {
  const { w, db } = world();
  const added = await call(w, "mounts.add", { into: "fld_into", source: { kind: "dropbox", connectionId: "con_d", ref: "id:sales" }, name: "Sales (Dropbox)" });
  const mountId = String(added["mountId"]);
  assert.equal(((await call(w, "mounts.get", { mountId }))["mount"] as Row)["mode"], "live_only");
  const fileId = w.files.fileNamed("Report.docx").id;
  assert.equal(w.files.text(fileId), "", "an empty placeholder");
  assert.equal(db.calls.some((c) => c.cap === "dropbox.files.download"), false, "nothing was fetched");
  const first = await call(w, "mounts.open", { fileId });
  assert.equal(first["fetched"], true);
  assert.deepEqual(db.calls.filter((c) => c.cap === "dropbox.files.download").map((c) => c.input["path"]), ["id:report"]);
  const again = await call(w, "mounts.open", { fileId });
  assert.equal(again["fetched"], false, "the cached copy is the revision Dropbox holds");
  db.edit("id:report", "r2");
  const changed = await call(w, "mounts.open", { fileId });
  assert.equal(changed["fetched"], true, "Dropbox moved on, so the new revision is fetched");
});

test("a notice for an account wakes the mounts watched on it, and no others", async () => {
  const { w } = world();
  w.settings["mounts.public_address"] = "https://space.example";
  const added = await call(w, "mounts.add", { into: "fld_into", source: { kind: "dropbox", connectionId: "con_d", ref: "id:sales" }, name: "Sales (Dropbox)" });
  const mountId = String(added["mountId"]);
  assert.equal(w.mountRow(mountId)["watch_id"], "dbx:dbid:AAH4", "the pass kept a channel for the account");
  const hit = await call(w, "mounts.nudge", { source: "dropbox", channelId: "dbx:dbid:AAH4" });
  assert.deepEqual([hit["mounts"], hit["passes"]], [1, 1]);
  const miss = await call(w, "mounts.nudge", { source: "dropbox", channelId: "dbx:dbid:SOMEONE" });
  assert.deepEqual([miss["mounts"], miss["passes"]], [0, 0]);
  await expectCode("validation.bad_input", () => call(w, "mounts.nudge", { source: "dropbox" }));
});
