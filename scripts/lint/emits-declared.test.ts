import test from "node:test";
import assert from "node:assert/strict";
import { checkEmitsDeclared } from "./emits-declared.ts";

const caps = new Map([
  ["folders.create", { name: "folders.create", module: "files", emits: ["folder.created"] }],
  ["folders.place", { name: "folders.place", module: "files", emits: [] }],
  ["files.rename", { name: "files.rename", module: "files", emits: ["file.renamed"] }],
  ["other.thing", { name: "other.thing", module: "mail", emits: [] }],
]);
const run = (src: string, mod = "files") => checkEmitsDeclared("modules/files/handlers/a.ts", src, caps, mod);

test("emits-declared: an inline handler emitting an undeclared event is a finding with the line of the emit", () => {
  const hits = run(`export const h = {\n  "folders.create": async (ctx, i) => {\n    ctx.emit("folder.created", "x", {});\n    ctx.emit("folder.placed", "x", {});\n  },\n};`);
  assert.deepEqual(hits.map((h) => [h.cap, h.event, h.line]), [["folders.create", "folder.placed", 4]]);
});

test("emits-declared: a handler named by identifier is read from the same file, with the helpers it calls", () => {
  const src = `function mark(ctx) { ctx.emit("file.touched", "f", {}); }\nasync function place(ctx, i) { mark(ctx); }\nexport const h = {\n  "folders.place": place,\n  "files.rename": async (ctx) => { ctx.emit("file.renamed", "f", {}); },\n};`;
  const hits = run(src);
  assert.deepEqual(hits.map((h) => [h.cap, h.event]), [["folders.place", "file.touched"]]);
});

test("emits-declared: declared emits, capabilities of other modules and computed names are not findings", () => {
  assert.deepEqual(run(`const h = { "files.rename": async (ctx) => { ctx.emit("file.renamed", "f", {}); ctx.emit(name, "f", {}); } };`), []);
  assert.deepEqual(run(`const h = { "other.thing": async (ctx) => { ctx.emit("anything", "f", {}); } };`), []);
});

test("emits-declared: a handler imported from another file of the module is found through the module resolver", () => {
  const files: Record<string, string> = {
    "modules/files/handlers/index.ts": `import { place } from "./tree.ts";\nexport const handlers = {\n  "folders.place": place,\n};`,
    "modules/files/handlers/tree.ts": `export async function place(ctx, i) {\n  ctx.emit("folder.placed", "f", {});\n}`,
  };
  const resolve = (id: string, from: string) => {
    for (const [f, src] of Object.entries(files)) {
      const m = new RegExp(`function ${id}\\b`).exec(src);
      if (m) { const open = src.indexOf("{", m.index + 20); return { file: f, source: src, text: src.slice(open), start: open }; }
    }
    return null;
  };
  const hits = checkEmitsDeclared("modules/files/handlers/index.ts", files["modules/files/handlers/index.ts"]!, caps, "files", resolve);
  assert.deepEqual(hits.map((h) => [h.cap, h.event, h.file, h.line]), [["folders.place", "folder.placed", "modules/files/handlers/tree.ts", 2]]);
});

test("emits-declared: an apostrophe in a comment does not stretch a handler over the rest of the file", () => {
  const src = `export const h = {\n  "files.rename": async (ctx) => {\n    // it doesn't matter here\n    ctx.emit("file.renamed", "f", {});\n  },\n};\nfunction later(ctx) { ctx.emit("file.late", "f", {}); }\n`;
  assert.deepEqual(run(src), []);
});
