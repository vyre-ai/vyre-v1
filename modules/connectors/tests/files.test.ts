import test from "node:test";
import assert from "node:assert/strict";
import { writeConnectorFolder } from "../handlers/files.ts";
import type { ConnectorsCtx } from "../projections.ts";
test("connector source writer accepts human test names and rejects traversal before any Files operation", async () => {
  const calls: { cap: string; input: any }[] = [];
  const ctx = {
    trace: { traceId: "1".repeat(32) },
    call: async (cap: string, input: unknown) => {
      calls.push({ cap, input });
      if (cap === "files.tree") return { roots: [{ key: "personal", folderId: "fld_personal" }] };
      if (cap === "files.folder.create") return { folder: { folderId: `fld_${calls.length}` } };
      return { file: { fileId: "fil_fixture" } };
    },
  } as unknown as ConnectorsCtx;
  const id = await writeConnectorFolder(ctx, "fixture", [{ path: "tests/ping answers ok.json", content: "{}" }]);
  assert.match(id, /^fld_/);
  assert.ok(
    calls.some(
      (row) =>
        row.cap === "files.create_many" &&
        row.input.files.some((f: { name: string }) => f.name === "ping answers ok.json"),
    ),
  );
  calls.length = 0;
  for (const path of ["../private", "actions/../../private", "tests/a/b.json", "tests/.."])
    await assert.rejects(writeConnectorFolder(ctx, "fixture", [{ path, content: "{}" }]));
  assert.equal(calls.length, 0);
});

test("a connector export writes each folder in one files.create_many call, not one call for each file", async () => {
  const calls: { cap: string; input: any }[] = [];
  const ctx = {
    trace: { traceId: "2".repeat(32) },
    call: async (cap: string, input: unknown) => {
      calls.push({ cap, input });
      if (cap === "files.tree") return { roots: [{ key: "personal", folderId: "fld_personal" }] };
      if (cap === "files.folder.create") return { folder: { folderId: `fld_${calls.length}` } };
      return { files: [] };
    },
  } as unknown as ConnectorsCtx;
  const files = [
    { path: "connector.toml", content: "x" },
    { path: "README.md", content: "x" },
    ...Array.from({ length: 50 }, (_, i) => ({ path: `actions/list_${i}.json`, content: "{}" })),
    ...Array.from({ length: 25 }, (_, i) => ({ path: `tests/t${i}.json`, content: "{}" })),
  ];
  await writeConnectorFolder(ctx, "wide", files);
  assert.equal(calls.filter((c) => c.cap === "files.create").length, 0);
  const many = calls.filter((c) => c.cap === "files.create_many");
  assert.deepEqual(
    many.map((c) => c.input.files.length).sort((a, b) => a - b),
    [2, 25, 50],
    "root, tests and actions: three calls for 77 files",
  );
});

test("a connector export splits a folder into calls of at most 200 files and 20 MB", async () => {
  const calls: { cap: string; input: any }[] = [];
  const ctx = {
    trace: { traceId: "3".repeat(32) },
    call: async (cap: string, input: unknown) => {
      calls.push({ cap, input });
      if (cap === "files.tree") return { roots: [{ key: "personal", folderId: "fld_personal" }] };
      if (cap === "files.folder.create") return { folder: { folderId: `fld_${calls.length}` } };
      return { files: [] };
    },
  } as unknown as ConnectorsCtx;
  const big = "x".repeat(9 * 1024 * 1024);
  await writeConnectorFolder(ctx, "heavy", [
    { path: "actions/a.json", content: big },
    { path: "actions/b.json", content: big },
    { path: "actions/c.json", content: big },
    { path: "actions/d.json", content: "{}" },
  ]);
  const many = calls.filter((c) => c.cap === "files.create_many");
  assert.deepEqual(
    many.map((c) => c.input.files.length),
    [2, 2],
    "9 + 9 MB in one call, the next 9 MB and the small one in the next",
  );
});
