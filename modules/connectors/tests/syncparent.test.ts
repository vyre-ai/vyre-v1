// A per-parent list (list.eachOf): a SyncSpec reads /matters/{matter}/contacts once for every matter. The spec names the parent object and the path's placeholder; the compiler turns the
// placeholder into the call's `parent` input, the validator samples the list under a real parent, and every row carries its parent's id at /_parent. Fixtures are shaped like an
// estate-planning intake system (matters with contacts), made up here: no client data.
import test from "node:test";
import assert from "node:assert/strict";
import { compileSpec, firstPageRequest, parseSpec } from "../syncspec.ts";
import type { SyncSpec } from "../syncspec.ts";

function intakeRaw(): Record<string, any> {
  return {
    app: { name: "Intake", domain: "intake.test" },
    auth: { vaultHandle: "#Intake.key", style: "header", header: "Authorization", prefix: "Token " },
    objects: [
      {
        remote: "matters",
        label: "Matter",
        id: "/id",
        itemsAt: "/results",
        list: { path: "/v1/matters", cursor: { kind: "page", param: "page", size: 200, sizeParam: "page_size" } },
        fields: [{ path: "/name", label: "Name", type: "text" }],
      },
      {
        remote: "contacts",
        label: "Contact",
        id: "/id",
        itemsAt: "/contacts",
        list: { path: "/v1/matters/{matter}/contacts", eachOf: { object: "matters", param: "matter" } },
        fields: [
          { path: "/full_name", label: "Full name", type: "text" },
          { path: "/_parent", label: "Matter", type: "relation", relationTo: "matters" },
        ],
      },
    ],
    mapping: [
      {
        remote: "matters",
        recordType: "in_matter",
        title: "Matter",
        titleField: "/name",
        fields: [{ path: "/name", field: "name", direction: "pull" }],
      },
      {
        remote: "contacts",
        recordType: "in_contact",
        title: "Contact",
        titleField: "/full_name",
        fields: [
          { path: "/full_name", field: "full_name", direction: "pull" },
          { path: "/_parent", field: "matter", direction: "pull" },
        ],
      },
    ],
    plan: { firstPull: { words: "Matters and their contacts, read only." }, backfill: "now", conflicts: "newest" },
  };
}
const ok = (raw: unknown): SyncSpec => {
  const p = parseSpec(raw);
  assert.ok(p.spec, JSON.stringify(p.problems));
  return p.spec;
};
const errs = (raw: unknown): string[] =>
  parseSpec(raw)
    .problems.filter((x) => x.level === "error")
    .map((x) => `${x.at}: ${x.message}`);

test("a per-parent list parses, and the compiled list takes the parent's id as its `parent` input", () => {
  const c = compileSpec(ok(intakeRaw()));
  const list = c.connector.actions.find((a) => a.name === "list_contacts")!;
  const after = c.connector.actions.find((a) => a.name === "list_contacts_after")!;
  assert.equal(list.url, "https://intake.test/v1/matters/{input.parent}/contacts");
  assert.equal(after.url, list.url);
  assert.deepEqual(c.connector.objects!["contacts"]!.eachOf, { remote: "matters" });
  assert.equal(c.connector.objects!["matters"]!.eachOf, undefined, "the parent is an ordinary list");
  assert.equal(c.connector.actions.find((a) => a.name === "list_matters")!.url, "https://intake.test/v1/matters");
  // the relation to the parent reads the stamped /_parent pointer
  const t = c.types.find((x) => x.recordType === "in_contact")!;
  assert.equal(t.fields.find((f) => f.key === "matter")!.remote, "/_parent");
  assert.equal(t.relations[0]!.to, "in_matter");
});

test("the validator's first request puts the parent id in the path, encoded", () => {
  const spec = ok(intakeRaw());
  const o = spec.objects[1]!;
  assert.equal(firstPageRequest(spec, o, "matter_AB12").path, "/v1/matters/matter_AB12/contacts");
  assert.equal(firstPageRequest(spec, o, "a b").path, "/v1/matters/a%20b/contacts");
  assert.equal(firstPageRequest(spec, spec.objects[0]!).path, "/v1/matters");
});

test("a per-parent list that is wrong is refused in plain words", () => {
  const mut = (f: (r: Record<string, any>) => void): string[] => {
    const r = intakeRaw();
    f(r);
    return errs(r);
  };
  assert.ok(mut((r) => (r["objects"][1].list.path = "/v1/contacts")).some((e) => e.includes("must contain {matter}")));
  assert.ok(
    mut((r) => (r["objects"][1].list.eachOf.object = "nobody")).some((e) =>
      e.includes("not one of the listed objects"),
    ),
  );
  assert.ok(
    mut((r) => (r["objects"][1].list.eachOf.object = "contacts")).some((e) => e.includes("under its own object")),
  );
  assert.ok(mut((r) => (r["objects"][1].list.eachOf.param = "Bad Name")).some((e) => e.includes("eachOf is")));
  assert.ok(
    mut((r) => (r["objects"][1].list.updatedSince = { param: "since" })).some((e) =>
      e.includes("cannot say what changed since"),
    ),
  );
  // only one level: a per-parent list cannot be the parent of another
  const r = intakeRaw();
  r["objects"].push({
    remote: "phones",
    label: "Phone",
    id: "/id",
    itemsAt: "/phones",
    list: { path: "/v1/contacts/{contact}/phones", eachOf: { object: "contacts", param: "contact" } },
    fields: [{ path: "/number", label: "Number", type: "text" }],
  });
  assert.ok(errs(r).some((e) => e.includes("only one level")));
  assert.deepEqual(errs(intakeRaw()), []);
});

test("scoped ids: an app whose ids repeat from one parent to the next gets the parent in front of each id", () => {
  const raw = intakeRaw();
  raw["objects"][1].list.eachOf.scoped = true;
  const c = compileSpec(ok(raw));
  assert.deepEqual(c.connector.objects!["contacts"]!.eachOf, { remote: "matters", scoped: true });
  raw["objects"][1].list.eachOf.scoped = "yes";
  assert.ok(errs(raw).some((e) => e.includes("eachOf is")));
});
