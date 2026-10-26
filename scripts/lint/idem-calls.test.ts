import test from "node:test";
import assert from "node:assert/strict";
import { checkIdemCalls } from "./idem-calls.ts";

const keyed = new Set(["tasks.create", "files.share"]);
const run = (src: string) => checkIdemCalls("modules/x/handlers/a.ts", src, keyed);

test("idem-calls: a keyed capability called without idempotencyKey is a finding with its line", () => {
  const hits = run(`const a = 1;\nawait ctx.call("tasks.create", {\n  title: "x",\n});\n`);
  assert.equal(hits.length, 1);
  assert.deepEqual([hits[0]!.kind, hits[0]!.line, hits[0]!.cap], ["missing", 2, "tasks.create"]);
  assert.equal(run(`await ctx.call("files.share");`).length, 1, "no input at all");
});

test("idem-calls: idempotencyKey in the literal, as a key or shorthand, passes; only the top level counts", () => {
  assert.deepEqual(run(`await ctx.call("tasks.create", { title: "x", idempotencyKey: \`t:\${id}\` });`), []);
  const idempotencyKey = "k";
  assert.ok(idempotencyKey);
  assert.deepEqual(run(`await ctx.call("tasks.create", { title: "x", idempotencyKey });`), []);
  assert.deepEqual(run(`await ctx.call("tasks.create", {\n  title: "x",\n  idempotencyKey: key(a, b),\n});`), []);
  assert.equal(run(`await ctx.call("tasks.create", { meta: { idempotencyKey: "k" }, title: "x" });`).length, 1, "a nested key is not the input's");
});

test("idem-calls: capabilities that do not declare a key, and non-literal names, are ignored", () => {
  assert.deepEqual(run(`await ctx.call("settings.get", { key: "a" }); await ctx.call(name, { a: 1 }); await ctx.call(\`x.\${n}\`, {});`), []);
});

test("idem-calls: an input the lint cannot see is a warning (unseen), never a failure", () => {
  const v = run(`await ctx.call("tasks.create", input);`);
  assert.deepEqual(v.map((h) => h.kind), ["unseen"]);
  assert.deepEqual(run(`await ctx.call("tasks.create", { ...base, title: "x" });`).map((h) => h.kind), ["unseen"]);
  assert.deepEqual(run(`await ctx.call("tasks.create", { ...base, idempotencyKey: "k" });`), []);
});
