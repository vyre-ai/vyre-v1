// The Kit file step (spec 2.21, 2.16): a runbook ships as a Markdown file at a tree path. Folders are made on the way, the same step twice changes nothing, and nothing outside the tree's
// roots can be made. The files module is a scripted tree that answers like the real one: resolve, folder.create and create.
// @reads /modules/kits/migrations/0001_kits.sql

import test from "node:test";
import assert from "node:assert/strict";
import { checkFileStep, isFileStep, runFileStep, FILE_STEP_CAP, MAX_FILE_BYTES } from "../handlers/steps.ts";
import { codeOf, harness } from "../fixtures/db.ts";

const notFound = () => Object.assign(new Error("none"), { error: { code: "validation.not_found", message: "none" } });

/** A tree of folders and files keyed by path, with the roots Projects and Agents. */
function tree(h: ReturnType<typeof harness>, roots = ["Projects", "Agents"]) {
  const folders = new Map<string, string>(roots.map((r, i) => [r, `fld_root${i}`]));
  const files = new Map<string, string>();
  const made: { cap: string; input: any }[] = [];   // eslint-disable-line @typescript-eslint/no-explicit-any
  let n = 0;
  h.callee("files.resolve", (i: { path: string }) => {
    if (files.has(i.path)) return { kind: "file", fileId: files.get(i.path) };
    if (folders.has(i.path)) return { kind: "folder", folderId: folders.get(i.path) };
    throw notFound();
  });
  const pathOf = (id: string) => [...folders].find(([, v]) => v === id)![0];
  h.callee("files.folder.create", (i: { parentId: string; name: string }) => {
    made.push({ cap: "files.folder.create", input: i });
    const p = `${pathOf(i.parentId)}/${i.name}`;
    if (folders.has(p)) throw Object.assign(new Error("dup"), { error: { code: "validation.duplicate" } });
    folders.set(p, `fld_new${++n}`);
    return { folder: { folderId: folders.get(p) } };
  });
  h.callee("files.create", (i: { folderId: string; name: string; content: { text: string } }) => {
    made.push({ cap: "files.create", input: i });
    const p = `${pathOf(i.folderId)}/${i.name}`;
    if (files.has(p)) throw Object.assign(new Error("dup"), { error: { code: "validation.duplicate" } });
    files.set(p, `fil_new${++n}`);
    return { file: { fileId: files.get(p) } };
  });
  return { folders, files, made };
}

const RUNBOOK = "# New matter\n\n```sh\necho open the matter\n```\n";

test("the step makes the missing folders from the root down, then the file with its text", async () => {
  const h = harness();
  const t = tree(h);
  const r = await runFileStep(h.ctxFor(null), { path: "Projects/Runbooks/Intake/new-matter.md", content: RUNBOOK });
  assert.equal(r.created, true);
  assert.deepEqual([...t.folders.keys()].sort(), ["Agents", "Projects", "Projects/Runbooks", "Projects/Runbooks/Intake"]);
  assert.deepEqual(t.made.map((m) => m.cap), ["files.folder.create", "files.folder.create", "files.create"]);
  assert.deepEqual(t.made[0]!.input, { parentId: "fld_root0", name: "Runbooks", idempotencyKey: "kit-folder:Projects/Runbooks" });
  assert.deepEqual(t.made[2]!.input.content, { text: RUNBOOK });
  assert.equal(t.made[2]!.input.name, "new-matter.md");
  assert.equal(t.files.get("Projects/Runbooks/Intake/new-matter.md"), r.fileId);
});

test("applying it again changes nothing, and a file a person edited is left alone; existing folders are reused", async () => {
  const h = harness();
  const t = tree(h);
  const step = { path: "Projects/Runbooks/new-matter.md", content: RUNBOOK };
  const first = await runFileStep(h.ctxFor(null), step);
  t.made.length = 0;
  const second = await runFileStep(h.ctxFor(null), { ...step, content: "someone changed the Kit text" });
  assert.deepEqual(second, { fileId: first.fileId, created: false });
  assert.equal(t.made.length, 0);
  const sibling = await runFileStep(h.ctxFor(null), { path: "Projects/Runbooks/close-matter.md", content: RUNBOOK });
  assert.equal(sibling.created, true);
  assert.deepEqual(t.made.map((m) => m.cap), ["files.create"], "the Runbooks folder was reused");
});

test("a race on a folder or the file is read as success: duplicate means someone else made it", async () => {
  const h = harness();
  const t = tree(h);
  const base = h.ctxFor(null);
  let first = true;
  h.callee("files.folder.create", (i: { parentId: string; name: string }) => {
    if (first) { first = false; t.folders.set(`Projects/${i.name}`, "fld_raced"); }
    throw Object.assign(new Error("dup"), { error: { code: "validation.duplicate" } });
  });
  h.callee("files.create", (i: { folderId: string; name: string }) => {
    t.files.set(`Projects/Runbooks/${i.name}`, "fil_raced");
    throw Object.assign(new Error("dup"), { error: { code: "validation.duplicate" } });
  });
  const r = await runFileStep(base, { path: "Projects/Runbooks/a.md", content: "x" });
  assert.deepEqual(r, { fileId: "fil_raced", created: false });
});

test("refusals: a root that does not exist, a folder where the file should be, errors from the files module, and bad input", async () => {
  const h = harness();
  const t = tree(h);
  const ctx = h.ctxFor(null);
  t.files.set("Projects/Runbooks", "fil_in_the_way");
  await assert.rejects(runFileStep(ctx, { path: "Projects/Runbooks/a.md", content: "x" }), (e) => codeOf(e) === "validation.precondition_failed", "a file where a folder should be");
  await assert.rejects(runFileStep(ctx, { path: "Nowhere/x.md", content: "x" }), (e) => codeOf(e) === "validation.precondition_failed");
  h.callee("files.resolve", () => { throw Object.assign(new Error("denied"), { error: { code: "permission.role_lacks_permission" } }); });
  await assert.rejects(runFileStep(ctx, { path: "Projects/x.md", content: "x" }), (e) => codeOf(e) === "permission.role_lacks_permission");
  for (const bad of [null, [], {}, { path: "Projects/x.md" }, { path: 5, content: "x" }, { path: "x.md", content: "x" }, { path: "Projects/../x.md", content: "x" }, { path: "Projects//x.md", content: "x" },
    { path: "Projects/a\\b.md", content: "x" }, { path: "Projects/ x.md", content: "x" }, { path: "a/b/c/d/e/f/g/h/i.md", content: "x" }, { path: "Projects/x.md", content: "x".repeat(MAX_FILE_BYTES + 1) }]) {
    await assert.rejects(runFileStep(ctx, bad), (e) => codeOf(e) === "validation.bad_input", JSON.stringify(bad)?.slice(0, 60));
  }
});

test("checkFileStep names the problem for the Kit format check; the step kind has one name", () => {
  assert.equal(FILE_STEP_CAP, "file.put");
  assert.equal(isFileStep({ cap: "file.put" }), true);
  assert.equal(isFileStep({ cap: "files.create" }), false);
  assert.deepEqual(checkFileStep({ path: "Projects/Runbooks/a.md", content: "x" }), { segments: ["Projects", "Runbooks", "a.md"], problem: null });
  assert.match(checkFileStep({ path: "a.md", content: "x" }).problem ?? "", /a root and 1 to 7 more names/);
  assert.match(checkFileStep({ path: "Projects/../a.md", content: "x" }).problem ?? "", /".." is not a valid name/);
});
