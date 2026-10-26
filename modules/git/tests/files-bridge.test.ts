// @reads /modules/git/handlers/files-bridge.ts
// Golden 3: the Files tree and the git working copy are one tree. A file made in a git folder is in the commit, a file git pulled in is a file in Files, a file deleted in Files leaves the next commit,
// and a path git brought in is never deleted because Files has not heard of it. The Files module here is a small in-memory stand-in behind ctx.call; git is the real binary.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { handlers } from "../impl.ts";
import { world } from "../fixtures/world.ts";

const F = "fld_alpha";
type Row = Record<string, unknown>;

/** Files: folders and files by id, behind the capabilities the bridge calls. */
function filesStandIn() {
  const folders = new Map<string, { id: string; parent: string | null; name: string }>([[F, { id: F, parent: null, name: "Alpha" }]]);
  const files = new Map<string, { id: string; folder: string; name: string; bytes: Buffer; at: number; deleted: boolean }>();
  let n = 0, clock = 1000;
  const row = (f: { id: string; folder: string; name: string; bytes: Buffer; at: number }): Row => ({ fileId: f.id, folderId: f.folder, name: f.name, size: f.bytes.length, updatedAt: f.at });
  const call = async (cap: string, i: Row): Promise<unknown> => {
    if (cap === "settings.get") return { row: { key: "git.protected_branches", value: ["main"] } };
    if (cap === "files.list") {
      const folder = String(i["folder"]);
      return {
        files: [...files.values()].filter((f) => f.folder === folder && !f.deleted).map(row),
        folders: [...folders.values()].filter((f) => f.parent === folder).map((f) => ({ folderId: f.id, name: f.name })),
        total: 0,
      };
    }
    if (cap === "files.read") {
      const f = files.get(String(i["fileId"]));
      if (!f) throw new Error("no such file");
      return { base64: f.bytes.toString("base64"), truncated: false, size: f.bytes.length };
    }
    if (cap === "files.folder.create") {
      const id = `fld_made${++n}`;
      folders.set(id, { id, parent: String(i["parentId"]), name: String(i["name"]) });
      return { folder: { folderId: id } };
    }
    if (cap === "files.create") {
      const id = `fil_made${++n}`;
      const f = { id, folder: String(i["folderId"]), name: String(i["name"]), bytes: Buffer.from(String((i["content"] as Row)["base64"]), "base64"), at: ++clock, deleted: false };
      files.set(id, f);
      return { file: row(f) };
    }
    if (cap === "files.write") {
      const f = files.get(String(i["fileId"]));
      if (!f) throw new Error("no such file");
      f.bytes = Buffer.from(String((i["content"] as Row)["base64"]), "base64");
      f.at = ++clock;
      return { file: row(f) };
    }
    if (cap === "files.delete") { const f = files.get(String(i["fileId"])); if (f) f.deleted = true; return { deleted: true }; }
    throw new Error(`unscripted call ${cap}`);
  };
  return {
    call,
    add(name: string, text: string, folder = F): string { const id = `fil_t${++n}`; files.set(id, { id, folder, name, bytes: Buffer.from(text), at: ++clock, deleted: false }); return id; },
    folder(name: string, parent = F): string { const id = `fld_t${++n}`; folders.set(id, { id, parent, name }); return id; },
    remove(id: string): void { const f = files.get(id); if (f) f.deleted = true; },
    named(name: string) { return [...files.values()].find((f) => f.name === name && !f.deleted); },
  };
}

async function with_(run: (ctx: Ctx, w: ReturnType<typeof world>, fl: ReturnType<typeof filesStandIn>) => Promise<void>): Promise<void> {
  const w = world();
  try {
    const fl = filesStandIn();
    await run({ ...w.ctx, call: ((cap: string, input: unknown) => fl.call(cap, input as Row)) as Ctx["call"] }, w, fl);
  } finally { w.cleanup(); }
}
const op = (ctx: Ctx, cap: keyof typeof handlers, input: Row): Promise<Row> => (handlers[cap] as (c: Ctx, i: unknown) => Promise<Row>)(ctx, input);
const filesOf = (r: Row): string[] => (r["changes"] as { path: string }[]).map((c) => c.path).sort();

test("a file made in Files is in the commit git makes next, nested folders included", async () => {
  await with_(async (ctx, w, fl) => {
    await op(ctx, "git.init", { folderId: F });
    fl.add("plan.md", "# Plan\n");
    fl.add("deep.txt", "x", fl.folder("docs"));
    const status = await op(ctx, "git.status", { folderId: F });
    assert.deepEqual(filesOf(status), ["docs/deep.txt", "plan.md"], "Files' content is the working copy");
    const made = await op(ctx, "git.commit", { folderId: F, message: "Add plan" });
    assert.equal(made["files"], 2, "the commit holds both files");
    assert.equal(fs.readFileSync(path.join(w.tree(F), "plan.md"), "utf8"), "# Plan\n");
  });
});

test("a file edited in Files goes into the next commit, and one deleted in Files leaves it", async () => {
  await with_(async (ctx, _w, fl) => {
    await op(ctx, "git.init", { folderId: F });
    const keep = fl.add("keep.txt", "one"), gone = fl.add("gone.txt", "two");
    await op(ctx, "git.commit", { folderId: F, message: "First" });
    fl.named("keep.txt")!.bytes = Buffer.from("one, edited"); fl.named("keep.txt")!.at += 10;
    fl.remove(gone);
    const second = await op(ctx, "git.status", { folderId: F });
    assert.deepEqual(filesOf(second), ["gone.txt", "keep.txt"], "the edit and the removal are both changes");
    assert.ok(keep);
  });
});

test("a file git brings in is brought into Files, and is not deleted on the next copy out", async () => {
  await with_(async (ctx, w, fl) => {
    const remote = await w.bare();
    await op(ctx, "git.init", { folderId: F });
    fl.add("a.txt", "a");
    await op(ctx, "git.commit", { folderId: F, message: "A" });
    await op(ctx, "git.remote_add", { folderId: F, name: "origin", url: remote });
    // somebody else's clone pushes b.txt
    await w.git(F, "push", "origin", "HEAD:refs/heads/main");
    const other = "fld_other";
    await w.git(other, "clone", remote, ".").catch(() => undefined);
    fs.mkdirSync(w.tree(other), { recursive: true });
    await w.git(other, "init", "--quiet");
    await w.git(other, "remote", "add", "origin", remote);
    await w.git(other, "pull", "origin", "main");
    w.write(other, "b.txt", "from elsewhere");
    await w.git(other, "add", "-A");
    await w.git(other, "-c", "user.name=O", "-c", "user.email=o@x.test", "commit", "-m", "B");
    await w.git(other, "push", "origin", "HEAD:main");

    await op(ctx, "git.pull", { folderId: F, strategy: "ff_only" });
    assert.equal(fl.named("b.txt")?.bytes.toString(), "from elsewhere", "the pulled file is a file in Files");
    await op(ctx, "git.status", { folderId: F });
    assert.equal(fs.existsSync(path.join(w.tree(F), "b.txt")), true, "and the next copy out leaves it where git put it");
  });
});

test("when Files does not answer, the git operation still works on the working copy", async () => {
  await with_(async (_ctx, w) => {
    await op(w.ctx, "git.init", { folderId: F });
    w.write(F, "solo.txt", "s");
    const made = await op(w.ctx, "git.commit", { folderId: F, message: "Solo" });
    assert.equal(made["files"], 1);
  });
});
