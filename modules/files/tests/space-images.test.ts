// Files for the Space image (rc.16). Shared knowledge holds a system folder, Branding, where Console puts the Space image it uploads. And "Choose from Files" finds every picture in the Space's
// folders the person can see: files.list with deep lists the whole Space section (never anyone's Personal), newest first, filtered by kind and by a name search, through the same access check.
// @reads /modules/files/migrations/0001_files_tree.sql
// @reads /modules/files/migrations/0005_files_entities.sql
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { configureFilesHost, handlers } from "../impl.ts";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
type H = Record<string, (ctx: Ctx, input: unknown) => Promise<any>>;   // eslint-disable-line @typescript-eslint/no-explicit-any
const run = handlers as unknown as H;
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function world() {
  const sql = new DatabaseSync(":memory:");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) sql.exec(readFileSync(join(dir, f), "utf8"));
  configureFilesHost({ resources: { ensure: async () => {}, setLabel: async () => {} } });
  let clock = 1_790_000_000_000;
  const hidden = new Set<string>();
  const ctx = {
    space: "spc_t", principal: { kind: "person", id: "usr_a" }, trace: { traceId: "t".repeat(32), spanId: "s".repeat(16) }, origin: "api", depth: 0, now: () => (clock += 1000),
    db: { all: (q: string, ...a: unknown[]) => sql.prepare(q).all(...(a as never[])) as unknown[], run: (q: string, ...a: unknown[]) => ({ changes: Number(sql.prepare(q).run(...(a as never[])).changes) }) },
    emit: ((_n: string, _s: string, p: unknown) => ({ payload: p })) as never, call: (async () => ({ rows: [], total: 0 })) as never,
    seal: { seal(bytes: Uint8Array) { return { keyId: "test", nonce: "test", bytes: Buffer.from(bytes).toString("base64") }; }, unseal(value: { bytes: string }) { return Uint8Array.from(Buffer.from(value.bytes, "base64")); } },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    authorize: ((_a: unknown, r: { id: string | null }) => ({ effect: r.id !== null && hidden.has(r.id) ? "deny" : "allow", reason: "", decisionId: "d" })) as never,
  } as unknown as Ctx;
  return { ctx, hidden };
}

const make = async (ctx: Ctx, folderId: string, name: string, n: number): Promise<string> =>
  (await run["files.create"]!(ctx, { folderId, name, content: name.endsWith(".png") || name.endsWith(".jpg") ? { base64: PNG } : { text: "x" }, idempotencyKey: `c-${n}` })).file.fileId as string;

test("Shared knowledge holds the Branding system folder, and files.resolve finds it by its path", async () => {
  const w = world();
  const tree = (await run["files.tree"]!(w.ctx, {})) as { roots: { key: string; folderId?: string }[] };
  const shared = tree.roots.find((r) => r.key === "shared_knowledge")!.folderId!;
  const listed = await run["files.list"]!(w.ctx, { folder: shared });
  assert.deepEqual(listed.folders.map((f: { name: string }) => f.name), ["Branding"]);
  const found = await run["files.resolve"]!(w.ctx, { path: "Shared knowledge/Branding" });
  assert.deepEqual([found.kind, found.folderId], ["folder", listed.folders[0].folderId]);
  // made once: a second look finds the same folder
  await run["files.tree"]!(w.ctx, {});
  assert.equal((await run["files.list"]!(w.ctx, { folder: shared })).folders.length, 1);
});

test("deep lists every picture in the Space's folders the person may see, newest first, with a name search; never Personal, Trash or what they may not see", async () => {
  const w = world();
  const tree = (await run["files.tree"]!(w.ctx, {})) as { roots: { key: string; folderId?: string }[] };
  const at = (key: string): string => tree.roots.find((r) => r.key === key)!.folderId!;
  const branding = (await run["files.resolve"]!(w.ctx, { path: "Shared knowledge/Branding" })).folderId as string;
  const deeper = (await run["files.folder.create"]!(w.ctx, { parentId: at("projects"), name: "Probate GTM", idempotencyKey: "f1" })).folder.folderId as string;
  const old = await make(w.ctx, at("shared_knowledge"), "old logo.png", 1);
  const notes = await make(w.ctx, branding, "brand notes.md", 2);
  const banner = await make(w.ctx, deeper, "Probate banner.jpg", 3);
  const mine = await make(w.ctx, at("personal"), "my selfie.png", 4);
  const secret = await make(w.ctx, deeper, "secret logo.png", 5);
  const gone = await make(w.ctx, branding, "deleted logo.png", 6);
  const logo = await make(w.ctx, branding, "MLA logo.png", 7);
  await run["files.delete"]!(w.ctx, { fileId: gone });
  w.hidden.add(secret);
  const deep = async (extra: Record<string, unknown> = {}): Promise<string[]> => (await run["files.list"]!(w.ctx, { section: "space", deep: true, kind: "image", sort: "updated", dir: "desc", ...extra })).files.map((f: { fileId: string }) => f.fileId);
  assert.deepEqual(await deep(), [logo, banner, old], "newest first, from any depth; not Personal, Trash, a note or a hidden file");
  assert.deepEqual(await deep({ q: "LOGO" }), [logo, old], "the search keeps names that contain it, any case");
  assert.deepEqual(await deep({ q: "logo", limit: 1 }), [logo]);
  assert.ok(!(await deep()).includes(mine) && !(await deep()).includes(notes));
  // the plain Space list is unchanged: the system roots, no files
  const plain = await run["files.list"]!(w.ctx, { section: "space", kind: "image" });
  assert.deepEqual(plain.files, []);
  await assert.rejects(() => run["files.list"]!(w.ctx, { section: "personal", deep: true }), (e: { error?: { code?: string } }) => e.error?.code === "validation.bad_input");
});
