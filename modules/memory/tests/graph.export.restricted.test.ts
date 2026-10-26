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
      "files.get": (i) => { const f = FILES[String(i["fileId"])]!; return { file: { fileId: i["fileId"], folderId: f.folder, name: f.name, ownerId: "usr_dana", createdAt: NOW - DAY, updatedAt: NOW, kind: "markdown" } }; },
      "files.folder.get": () => ({ folder: { path: "Knowledge/Memory" } }),
      "files.read": (i) => ({ text: FILES[String(i["fileId"])]!.text }),
      "files.tree": () => ({ roots: [{ key: "space", kind: "folder", title: "Space", folderId: "fld_root" }] }),
      ...extra,
    },
  });
}

test("memory.graph_export: a node the caller cannot view is absent from the file", async () => {
  let written = "";
  const h = setup({ "files.create": (i) => { written = String((i["content"] as { text: string }).text); return { file: { fileId: "fil_export" } }; } });
  await indexGraph(h.ctx, { entity: "file", id: "fil_open", seq: 1 });
  await indexGraph(h.ctx, { entity: "file", id: "fil_secret", seq: 2 });
  h.deny("file:fil_secret");
  await graphExport(h.ctx, { scope: "space" });
  assert.ok(written.includes("Handbook"), "the viewable note is in the file");
  assert.ok(!written.includes("Merger") && !written.includes("fil_secret"), "the restricted note is absent");
});

test("memory.graph_export: a context with no authorize writes no file", async () => {
  let created = 0;
  const h = setup({ "files.create": () => { created++; return { file: { fileId: "fil_export" } }; } });
  await indexGraph(h.ctx, { entity: "file", id: "fil_secret", seq: 1 });
  (h.ctx as { authorize?: unknown }).authorize = undefined;
  await assert.rejects(graphExport(h.ctx, { scope: "space" }));
  assert.equal(created, 0);
});
