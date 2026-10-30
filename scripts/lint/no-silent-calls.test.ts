import test from "node:test";
import assert from "node:assert/strict";
import { checkNoSilentCalls } from "./no-silent-calls.ts";

const f = (src: string) => checkNoSilentCalls("apps/app/src/x.tsx", src);

test("no-silent-calls: a voided call with no handler is flagged, the TableView newRecord shape included", () => {
  assert.equal(f(`const go = () => { void data.call("views.save", { a: 1 }); };`).length, 1);
  assert.equal(f(`const newRecord = () => {\n  void data.call("records.create", { type }).then((out) => { open(out); });\n};`).length, 1);
});

test("no-silent-calls: a catch, a two-argument then, an await or a returned call is judged handled", () => {
  assert.equal(f(`void data.call("a.b", {}).catch(() => undefined);`).length, 0);
  assert.equal(f(`void data.call("a.b", {}).then((x) => ok(x), (e) => fail(e));`).length, 0);
  assert.equal(f(`const run = async () => { await data.call("a.b", {}); };`).length, 0);
  assert.equal(f(`const run = () => data.call("a.b", {});`).length, 0);
  assert.equal(f(`return rt.call("a.b", {}).then((x) => x);`).length, 0);
});

test("no-silent-calls: Function.prototype.call and strings are not read", () => {
  assert.equal(f(`void fn.call(this, 1);`).length, 0);
  assert.equal(f(`const s = 'void data.call("a.b", {})';`).length, 0);
});

test("no-silent-calls: a key names the file, the capability and the nth call, so a baseline entry survives line moves", () => {
  const out = f(`void data.call("a.b", {});\nvoid data.call("a.b", {});`);
  assert.deepEqual(out.map((x) => x.key), ["apps/app/src/x.tsx#a.b#1", "apps/app/src/x.tsx#a.b#2"]);
});
