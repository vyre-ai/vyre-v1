// P-SEC_07: memory.graph_export writes the viewer's graph into a file, and the read filter cannot reach a file's contents. A node whose resource the caller cannot view must be absent from the
// file; a context with no authorize writes nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { graphExport, indexGraph } from "../handlers/graph.ts";
import { DAY, harness, NOW } from "../fixtures/harness.ts";

const FILES: Record<string, { folder: string; name: string; text: string }> = {
  fil_open: { folder: "fld_space", name: "Handbook.md", text: "# Handbook\nStart here." },
  fil_secret: { folder: "fld_space", name: "Merger.md", text: "# Merger\nterms of the restricted deal" },
};

function setup(extra: Record<string, (i: Record<string, unknown>) => unknown> = {}) {
  return harness({
    respond: {
      "files.get": (i) => {
        const f = FILES[String(i["fileId"])]!;
        return {
          file: {
            fileId: i["fileId"],
            folderId: f.folder,
            name: f.name,
            ownerId: "usr_dana",
            createdAt: NOW - DAY,
            updatedAt: NOW,
            kind: "markdown",
          },
        };
      },
      "files.folder.get": () => ({ folder: { path: "Knowledge/Memory" } }),
      "files.read": (i) => ({ text: FILES[String(i["fileId"])]!.text }),
      "files.tree": () => ({ roots: [{ key: "space", kind: "folder", title: "Space", folderId: "fld_root" }] }),
      ...extra,
    },
  });
}

test("memory.graph_export: a node the caller cannot view is absent from the file", async () => {
  let written = "";
  const h = setup({
    "files.create": (i) => {
      written = String((i["content"] as { text: string }).text);
      return { file: { fileId: "fil_export" } };
    },
  });
  await indexGraph(h.ctx, { entity: "file", id: "fil_open", seq: 1 });
  await indexGraph(h.ctx, { entity: "file", id: "fil_secret", seq: 2 });
  h.deny("file:fil_secret");
  await graphExport(h.ctx, { scope: "space" });
  assert.ok(written.includes("Handbook"), "the viewable note is in the file");
  assert.ok(!written.includes("Merger") && !written.includes("fil_secret"), "the restricted note is absent");
});

test("memory.graph_export: a context with no authorize writes no file", async () => {
  let created = 0;
  const h = setup({
    "files.create": () => {
      created++;
      return { file: { fileId: "fil_export" } };
    },
  });
  await indexGraph(h.ctx, { entity: "file", id: "fil_secret", seq: 1 });
  (h.ctx as { authorize?: unknown }).authorize = undefined;
  await assert.rejects(graphExport(h.ctx, { scope: "space" }));
  assert.equal(created, 0);
});

test("memory.graph_export: exporting again the same day makes a file of its own, and never fails over the name", async () => {
  const taken = new Set<string>();
  const h = setup({
    "files.list": () => ({ files: [...taken].map((name) => ({ name })) }),
    "files.create": (i) => {
      const name = String(i["name"]);
      if (taken.has(name))
        throw Object.assign(new Error("That name is already in this folder."), {
          error: { code: "validation.duplicate" },
        });
      taken.add(name);
      return { file: { fileId: `fil_${taken.size}` } };
    },
  });
  await indexGraph(h.ctx, { entity: "file", id: "fil_open", seq: 1 });
  const a = await graphExport(h.ctx, { scope: "space" });
  const b = await graphExport(h.ctx, { scope: "space" });
  const c = await graphExport(h.ctx, { scope: "space" });
  assert.deepEqual([a.fileId, b.fileId, c.fileId], ["fil_1", "fil_2", "fil_3"]);
  const names = [...taken];
  assert.match(names[0]!, /^memory-graph-space-\d{4}-\d{2}-\d{2}\.json$/);
  assert.match(names[1]!, / \(2\)\.json$/);
  assert.match(names[2]!, / \(3\)\.json$/);
});
