import test from "node:test";
import assert from "node:assert/strict";
import { checkRaiseAfterWrite, scrub } from "./raise-after-write.ts";

const run = (src: string) => checkRaiseAfterWrite("modules/x/handlers/a.ts", src);

test("raise-after-write: a refusal after the first write is a finding with both lines", () => {
  const hits = run(
    `export async function update(ctx, input) {\n  ctx.db.run("UPDATE t SET a = ?", 1);\n  if (input.bad) raise(ctx, "validation.bad_input", "no");\n  return {};\n}`,
  );
  assert.deepEqual(
    hits.map((h) => [h.fn, h.writeLine, h.raiseLine]),
    [["update", 2, 3]],
  );
});

test("raise-after-write: every refusal before the first write is clean", () => {
  assert.deepEqual(
    run(
      `export async function update(ctx, input) {\n  if (input.bad) raise(ctx, "validation.bad_input", "no");\n  ctx.db.run("UPDATE t SET a = ?", 1);\n  return {};\n}`,
    ),
    [],
  );
});

test("raise-after-write: an inline handler is found by its capability name", () => {
  const hits = run(
    `export const h = {\n  "chat.rename": async (ctx, input) => {\n    ctx.db.run("UPDATE t SET a = ?", 1);\n    throw fail("validation.bad_input", ctx.trace.traceId, {});\n  },\n};`,
  );
  assert.deepEqual(
    hits.map((h) => h.fn),
    ["chat.rename"],
  );
});

test("raise-after-write: a write in a branch that returns does not count for what follows", () => {
  const src = `async function f(ctx, input) {\n  if (input.undo) {\n    ctx.db.run("DELETE FROM t");\n    return { ok: true };\n  }\n  if (!input.to) raise(ctx, "validation.bad_input", "no");\n  return {};\n}`;
  assert.deepEqual(run(src), []);
});

test("raise-after-write: a bare rethrow, a refusal in a catch that follows its own try, and a sql string with braces are not findings", () => {
  assert.deepEqual(
    run(
      `async function f(ctx) {\n  try {\n    ctx.db.run("INSERT INTO t VALUES ('{')");\n    await ctx.call("x", {});\n  } catch (e) {\n    throw e;\n  }\n}`,
    ),
    [],
  );
  assert.deepEqual(
    run(
      `async function f(ctx) {\n  try {\n    ctx.db.run("INSERT INTO t VALUES (1)");\n    await ctx.call("x", {});\n  } catch {\n    raise(ctx, "internal.unexpected", "x");\n  }\n}`,
    ),
    [],
  );
});

test("raise-after-write: a regex with an apostrophe does not hide the refusal that follows", () => {
  const src = `async function f(ctx, input) {\n  const w = input.text.match(/[a-z']+/g) ?? [];\n  ctx.db.run("UPDATE t SET a = ?", w.length);\n  raise(ctx, "validation.bad_input", "no");\n}`;
  assert.deepEqual(
    run(src).map((h) => [h.writeLine, h.raiseLine]),
    [[3, 4]],
  );
});

test("raise-after-write: scrub blanks comments, strings and regex literals and keeps line numbers", () => {
  const out = scrub(`a // x'\nb = "q{" /* c\n d */;\nc = /[']/g`);
  assert.equal(out.split("\n").length, 4);
  assert.ok(!out.includes("q{") && !out.includes("'"));
});

test("raise-after-write: a closure is read where it is called, not where it is defined", () => {
  const defined = `async function f(ctx) {\n  ctx.db.run("UPDATE t SET a = 1");\n  const live = () => { if (!open) throw new Error("gone"); };\n  return live;\n}`;
  assert.deepEqual(run(defined), [], "a throw inside a closure that is never called is not a refusal after the write");
  const called = `async function f(ctx, input) {\n  const put = (k) => {\n    ctx.db.run("INSERT INTO p VALUES (?)", k);\n  };\n  put("a");\n  if (input.bad) raise(ctx, "validation.bad_input", "no");\n}`;
  assert.deepEqual(
    run(called).map((h) => [h.writeLine, h.raiseLine]),
    [[5, 6]],
    "a closure that writes counts as a write at its call",
  );
  const checked = `async function f(ctx, input) {\n  const put = (k) => {\n    ctx.db.run("INSERT INTO p VALUES (?)", k);\n  };\n  if (input.bad) raise(ctx, "validation.bad_input", "no");\n  put("a");\n}`;
  assert.deepEqual(run(checked), []);
});

test("raise-after-write: a write and a refusal in different branches of one if and else are not judged", () => {
  assert.deepEqual(
    run(
      `async function f(ctx, input) {\n  if (input.a) {\n    ctx.db.run("UPDATE t SET a = 1");\n  } else {\n    raise(ctx, "validation.bad_input", "no");\n  }\n}`,
    ),
    [],
  );
  assert.equal(
    run(
      `async function f(ctx, input) {\n  if (input.a) {\n    ctx.db.run("UPDATE t SET a = 1");\n  }\n  raise(ctx, "validation.bad_input", "no");\n}`,
    ).length,
    1,
    "after the if, with no else, the write is still there",
  );
});

test("raise-after-write: a callback written inline is not read, and a one-line write that returns does not count", () => {
  assert.deepEqual(
    run(
      `async function f(ctx) {\n  ctx.db.run("UPDATE t SET a = 1");\n  items.forEach((i) => {\n    raise(ctx, "validation.bad_input", "no");\n  });\n}`,
    ),
    [],
  );
  assert.deepEqual(
    run(
      `async function f(ctx, input) {\n  if (input.undo) { ctx.db.run("DELETE FROM t"); return {}; }\n  raise(ctx, "validation.bad_input", "no");\n}`,
    ),
    [],
  );
});

test("raise-after-write: a write in an if condition and the refusal that if guards are one statement, however the formatter wraps it", () => {
  const oneLine = `async function f(ctx, input) {\n  if (ctx.db.run("UPDATE t SET s = 'taken' WHERE id = ? AND s = 'open'", input.id).changes !== 1) raise(ctx, "auth.expired", "no");\n  return {};\n}`;
  const wrapped = `async function f(ctx, input) {\n  if (\n    ctx.db.run("UPDATE t SET s = 'taken' WHERE id = ? AND s = 'open'", input.id).changes !== 1\n  )\n    raise(ctx, "auth.expired", "no");\n  return {};\n}`;
  const block = `async function f(ctx, input) {\n  if (ctx.db.run("UPDATE t SET s = 'taken' WHERE id = ?", input.id).changes !== 1) {\n    raise(ctx, "auth.expired", "no");\n  }\n  return {};\n}`;
  assert.deepEqual(run(oneLine), []);
  assert.deepEqual(run(wrapped), []);
  assert.deepEqual(run(block), []);
  // a refusal after the if is still a finding
  const after = `async function f(ctx, input) {\n  if (\n    ctx.db.run("UPDATE t SET s = 'taken' WHERE id = ?", input.id).changes !== 1\n  )\n    return {};\n  raise(ctx, "auth.expired", "no");\n}`;
  assert.equal(run(after).length, 1);
});

test("raise-after-write: only the nothing-changed idiom with a lone refusal is exempt; a write that stuck and then refuses is a finding", () => {
  const fn = (cond: string, body: string) =>
    `async function f(ctx, input) {\n  if (\n    ${cond}\n  ) ${body}\n  return {};\n}`;
  const upd = `ctx.db.run("UPDATE t SET s = 'taken' WHERE id = ?", input.id)`;
  const raise = `raise(ctx, "auth.expired", "no");`;
  // the idiom, wrapped: clean (a lone refusal, braced or not)
  assert.deepEqual(run(fn(`${upd}.changes !== 1`, raise)), []);
  assert.deepEqual(run(fn(`${upd}.changes === 0`, `{\n    ${raise}\n  }`)), []);
  assert.deepEqual(run(fn(`!${upd}.changes`, raise)), []);
  // wrong polarity: the write stuck and then it refuses
  assert.equal(run(fn(`${upd}.changes === 1`, raise)).length, 1, "=== 1");
  assert.equal(run(fn(`${upd}.changes > 0`, raise)).length, 1, "> 0");
  assert.equal(run(fn(`${upd}.changes`, raise)).length, 1, "truthy");
  assert.equal(run(fn(`ctx.db.run("INSERT INTO t VALUES (1)")`, `{\n    cleanup();\n    ${raise}\n  }`)).length, 1, "insert, other work, raise");
  // a second write in the guarded block, then the refusal
  const second = fn(`${upd}.changes !== 1`, `{\n    ctx.db.run("DELETE FROM t");\n    ${raise}\n  }`);
  assert.equal(run(second).length, 1, "second write then raise");
  const secondOne = fn(`${upd}.changes !== 1`, `{\n    note(1);\n    ${raise}\n  }`);
  assert.equal(run(secondOne).length, 1, "other work before the raise");
});

test("raise-after-write: a write in a branch that ends in a return over several lines does not count for what follows", () => {
  const src = `async function f(ctx, input) {\n  if (input.undo) {\n    ctx.db.run("DELETE FROM t");\n    return {\n      ok: true,\n      n: 1,\n    };\n  }\n  if (!input.to) raise(ctx, "validation.bad_input", "no");\n  return {};\n}`;
  assert.deepEqual(run(src), []);
  // a branch that ends in an unbraced if is not a return
  const open = `async function f(ctx, input) {\n  if (input.undo) {\n    ctx.db.run("DELETE FROM t");\n    if (input.more)\n      return { ok: true };\n  }\n  if (!input.to) raise(ctx, "validation.bad_input", "no");\n  return {};\n}`;
  assert.equal(run(open).length, 1);
});
