// A title made of several pointers: first and last name joined with a space, empty parts left out; a single pointer means what it always did.
import test from "node:test";
import assert from "node:assert/strict";
import { ledgerSpec } from "../fixtures/crm.ts";
import { world } from "../fixtures/crm-world.ts";
import { compileSpec, joinTitle, parseSpec } from "../syncspec.ts";
import type { SyncSpec } from "../syncspec.ts";

const mutate = (spec: Record<string, any>, fn: (s: Record<string, any>) => void): Record<string, any> => {
  const s = JSON.parse(JSON.stringify(spec));
  fn(s);
  return s;
};
const two = () =>
  mutate(ledgerSpec(), (s) => {
    s["objects"][1]["fields"].push({ path: "/attributes/last", label: "Last name", type: "text" });
    s["mapping"][1]["titleField"] = ["/attributes/full_name", "/attributes/last"];
  });

test("joinTitle: two pointers, one empty, both empty", () => {
  const parts = ["/first", "/last"];
  assert.equal(joinTitle({ "/first": "Imran", "/last": "Ibarra" }, parts), "Imran Ibarra");
  assert.equal(joinTitle({ "/first": " Imran ", "/last": "" }, parts), "Imran");
  assert.equal(joinTitle({ "/first": null, "/last": "Ibarra" }, parts), "Ibarra");
  assert.equal(joinTitle({ "/first": "", "/last": null }, parts), null);
  assert.equal(joinTitle({}, parts), null);
});

test("a list of pointers compiles to one joined text field that is the record's title", () => {
  const spec = parseSpec(two()).spec as SyncSpec;
  const person = compileSpec(spec).types.find((t) => t.recordType === "person")!;
  const joined = person.fields.find((f) => f.remote.startsWith("=join:"))!;
  assert.equal(joined.remote, "=join:/attributes/full_name|/attributes/last");
  assert.equal(joined.dir, "pull");
  assert.equal(person.titleField, joined.key);
  assert.ok(person.defs.some((d) => d.key === joined.key && d.type === "text"));
  // the parts are read from the app's answer even though they are not mapped fields
  const c = compileSpec(spec).connector;
  const shape = c.actions.find((a) => a.name === c.objects!["people"]!.list)!.shape as { fields: string[] };
  assert.ok(shape.fields.includes("/attributes/last"));
});

test("a single pointer is unchanged", () => {
  const one = mutate(ledgerSpec(), (s) => (s["mapping"][1]["titleField"] = "/attributes/full_name"));
  const person = compileSpec(parseSpec(one).spec as SyncSpec).types.find((t) => t.recordType === "person")!;
  assert.equal(person.titleField, "name");
  assert.ok(!person.fields.some((f) => f.remote.startsWith("=join:")));
  const none = compileSpec(parseSpec(ledgerSpec()).spec as SyncSpec).types.find((t) => t.recordType === "person")!;
  assert.equal(none.titleField, "name");
});

test("validate and preview carry the list: a part not described is an error, the preview shows the joined title", async () => {
  const w = world();
  const bad = mutate(two(), (s) => (s["mapping"][1]["titleField"] = ["/attributes/full_name", "/attributes/missing"]));
  const v = await w.k.hs["sync_specs.validate"](w.ctx, { spec: bad });
  assert.equal(v.ok, false);
  assert.match(
    v.problems.filter((p) => p.level === "error")[0]!.message,
    /\/attributes\/missing is part of the title but not described/,
  );
  const ok = await w.k.hs["sync_specs.validate"](w.ctx, { spec: two() });
  assert.equal(ok.ok, true, JSON.stringify(ok.problems));
  assert.ok(
    ok.problems.some(
      (p) => p.level === "warn" && /\/attributes\/last is empty on the 2 records looked at/.test(p.message),
    ),
  );
  const p = await w.k.hs["sync_specs.preview"](w.ctx, { spec: two() });
  const first = p.samples.find((s) => s.type === "person")!;
  assert.ok(
    first.fields.some((f) => f.value === "Ada Stone"),
    "both parts empty but one filled: the filled one is the title",
  );
});
