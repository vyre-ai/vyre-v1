import test from "node:test";
import assert from "node:assert/strict";
import { checkRaiseAfterWrite, scrub } from "./raise-after-write.ts";

const run = (src: string) => checkRaiseAfterWrite("modules/x/handlers/a.ts", src);

test("raise-after-write: a refusal after the first write is a finding with both lines", () => {
  const hits = run(`export async function update(ctx, input) {\n  ctx.db.run("UPDATE t SET a = ?", 1);\n  if (input.bad) raise(ctx, "validation.bad_input", "no");\n  return {};\n}`);
  assert.deepEqual(hits.map((h) => [h.fn, h.writeLine, h.raiseLine]), [["update", 2, 3]]);
});

test("raise-after-write: every refusal before the first write is clean", () => {
  assert.deepEqual(run(`export async function update(ctx, input) {\n  if (input.bad) raise(ctx, "validation.bad_input", "no");\n  ctx.db.run("UPDATE t SET a = ?", 1);\n  return {};\n}`), []);
});

test("raise-after-write: an inline handler is found by its capability name", () => {
  const hits = run(`export const h = {\n  "chat.rename": async (ctx, input) => {\n    ctx.db.run("UPDATE t SET a = ?", 1);\n    throw fail("validation.bad_input", ctx.trace.traceId, {});\n  },\n};`);
  assert.deepEqual(hits.map((h) => h.fn), ["chat.rename"]);
});

test("raise-after-write: a write in a branch that returns does not count for what follows", () => {
  const src = `async function f(ctx, input) {\n  if (input.undo) {\n    ctx.db.run("DELETE FROM t");\n    return { ok: true };\n  }\n  if (!input.to) raise(ctx, "validation.bad_input", "no");\n  return {};\n}`;
  assert.deepEqual(run(src), []);
});

test("raise-after-write: a bare rethrow, a refusal in a catch that follows its own try, and a sql string with braces are not findings", () => {
  assert.deepEqual(run(`async function f(ctx) {\n  try {\n    ctx.db.run("INSERT INTO t VALUES ('{')");\n    await ctx.call("x", {});\n  } catch (e) {\n    throw e;\n  }\n}`), []);
  assert.deepEqual(run(`async function f(ctx) {\n  try {\n    ctx.db.run("INSERT INTO t VALUES (1)");\n    await ctx.call("x", {});\n  } catch {\n    raise(ctx, "internal.unexpected", "x");\n  }\n}`), []);
});

test("raise-after-write: a regex with an apostrophe does not hide the refusal that follows", () => {
  const src = `async function f(ctx, input) {\n  const w = input.text.match(/[a-z']+/g) ?? [];\n  ctx.db.run("UPDATE t SET a = ?", w.length);\n  raise(ctx, "validation.bad_input", "no");\n}`;
  assert.deepEqual(run(src).map((h) => [h.writeLine, h.raiseLine]), [[3, 4]]);
});

test("raise-after-write: scrub blanks comments, strings and regex literals and keeps line numbers", () => {
  const out = scrub(`a // x'\nb = "q{" /* c\n d */;\nc = /[']/g`);
  assert.equal(out.split("\n").length, 4);
  assert.ok(!out.includes("q{") && !out.includes("'"));
});
