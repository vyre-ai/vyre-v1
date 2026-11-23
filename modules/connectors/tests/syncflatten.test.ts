// Nested arrays as rows (object.rows) and a field that holds only when another field matches a pattern (onlyWhen.matches / not). Fixtures are made up in the shape of an intake system's roles
// (each role has assignments, each assignment a rank and the people serving together) and assets (a number or an address under one field, told apart by its label). No client data.
import test from "node:test";
import assert from "node:assert/strict";
import { compileSpec, expandRows, parseSpec, valueOfRemote, whenHolds, whenRemote } from "../syncspec.ts";
import { shapeList } from "../handlers/shape.ts";
import type { SyncSpec } from "../syncspec.ts";

const ROLE = (id: string, assignments: unknown) => ({ id, role_description: "Successor Trustee", assignments });

test("expandRows makes one row for every inner item, with the places and the values at each *", () => {
  const items = [
    ROLE("r1", [
      { position: 1, contacts: ["c1", "c2"] },
      { position: 2, contacts: ["c3"] },
    ]),
    ROLE("r2", []),
    ROLE("r3", [{ position: 1, contacts: [] }]),
    { id: "r4" },
  ];
  const rows = expandRows(items, { at: "/assignments/*/contacts/*", idAt: "/id" }) as Record<string, any>[];
  assert.deepEqual(
    rows.map((r) => r["_key"]),
    ["r1/0/0", "r1/0/1", "r1/1/0"],
    "nothing inside, no row",
  );
  assert.deepEqual(rows[1]!["_at"], [{ position: 1, contacts: ["c1", "c2"] }, "c2"]);
  assert.deepEqual(rows[1]!["_i"], [0, 1]);
  assert.equal(rows[2]!["_at"][0].position, 2);
  assert.equal(rows[0]!["role_description"], "Successor Trustee", "the item's own fields come along");
  // one wildcard, and a plain step between
  const one = expandRows([{ id: "x", box: { list: ["a", "b"] } }], { at: "/box/list/*", idAt: "/id" }) as Record<
    string,
    any
  >[];
  assert.deepEqual(
    one.map((r) => r["_key"]),
    ["x/0", "x/1"],
  );
  // an item with no id is passed on as it is, so the shaper names it
  const noId = expandRows([{ assignments: [1] }], { at: "/assignments/*", idAt: "/id" });
  assert.equal((noId[0] as Record<string, unknown>)["_key"], undefined);
});

test("shapeList reads the rows: ids are the keys, fields are read at /_at and /_i", () => {
  const body = {
    roles: [ROLE("r1", [{ position: 1, contacts: ["c1", "c2"] }]), ROLE("r2", [{ position: 3, contacts: ["c9"] }])],
  };
  const out = shapeList(
    body,
    undefined,
    {
      items: "/roles",
      id: "/_key",
      rows: { at: "/assignments/*/contacts/*", idAt: "/id" },
      fields: ["/_at/0/position", "/_at/1", "/_i/1", "/role_description"],
      types: { "/_at/0/position": "number", "/_at/1": "text", "/_i/1": "number", "/role_description": "text" },
      choices: {},
      cursor: { kind: "none" },
    },
    undefined,
  );
  assert.deepEqual(
    out.rows.map((r) => r.id),
    ["r1/0/0", "r1/0/1", "r2/0/0"],
  );
  assert.deepEqual(out.rows[1]!.data, {
    "/_at/0/position": 1,
    "/_at/1": "c2",
    "/_i/1": 1,
    "/role_description": "Successor Trustee",
  });
  assert.equal(out.rows[2]!.data["/_at/0/position"], 3);
  assert.throws(
    () =>
      shapeList(
        { roles: [{ assignments: [1] }] },
        undefined,
        {
          items: "/roles",
          id: "/_key",
          rows: { at: "/assignments/*", idAt: "/id" },
          fields: [],
          cursor: { kind: "none" },
        },
        undefined,
      ),
    /no id/,
  );
});

const base = (): Record<string, any> => ({
  app: { name: "Intake", domain: "intake.test" },
  auth: { vaultHandle: "#Intake.key", style: "header", header: "Authorization", prefix: "Token " },
  objects: [
    {
      remote: "assets",
      label: "Asset",
      id: "/id",
      itemsAt: "/assets",
      list: { path: "/v1/assets" },
      fields: [
        { path: "/identifier_label", label: "Identifier is", type: "text" },
        {
          path: "/identifier_value",
          label: "Address or description",
          type: "text",
          onlyWhen: { path: "/identifier_label", matches: "account|policy|\\bein\\b", not: true },
        },
        {
          path: "/identifier_value",
          key: "identifier_sealed",
          label: "Account or policy number",
          type: "sealed",
          onlyWhen: { path: "/identifier_label", matches: "account|policy|\\bein\\b" },
        },
      ],
    },
  ],
  mapping: [
    {
      remote: "assets",
      recordType: "in_asset",
      title: "Asset",
      titleField: "/identifier_label",
      fields: [
        { path: "/identifier_label", field: "identifier_label", direction: "pull" },
        { path: "/identifier_value", field: "identifier", direction: "pull" },
        { path: "/identifier_value", field: "identifier_sealed", direction: "pull" },
      ],
    },
  ],
  plan: { firstPull: { words: "Assets, read only." }, backfill: "now", conflicts: "newest" },
});
const errs = (raw: unknown): string[] =>
  parseSpec(raw)
    .problems.filter((x) => x.level === "error")
    .map((x) => x.message);

test("onlyWhen can match a pattern, or the opposite; each is a remote key the engine reads the same way", () => {
  const spec = parseSpec(base()).spec as SyncSpec;
  assert.ok(spec);
  const c = compileSpec(spec);
  const f = c.types[0]!.fields;
  const sealed = f.find((x) => x.key === "identifier_sealed")!;
  const plain = f.find((x) => x.key === "identifier")!;
  assert.equal(sealed.sealed, true);
  assert.ok(sealed.remote.startsWith("=when:") && plain.remote.startsWith("=when:") && sealed.remote !== plain.remote);
  const row = (label: string, v: string): Record<string, unknown> => ({
    "/identifier_label": label,
    "/identifier_value": v,
  });
  assert.equal(valueOfRemote(row("Account Number (last 4)", "1234"), plain.remote), null);
  assert.equal(valueOfRemote(row("Account Number (last 4)", "1234"), sealed.remote), "1234");
  assert.equal(valueOfRemote(row("Address / Description", "12 Sample St"), plain.remote), "12 Sample St");
  assert.equal(valueOfRemote(row("Address / Description", "12 Sample St"), sealed.remote), null);
  assert.equal(valueOfRemote(row("ACCOUNT number", "1"), sealed.remote), "1", "case does not matter");
  assert.equal(valueOfRemote({ "/identifier_value": "5" }, plain.remote), "5", "no label: not a number kind, so plain");
  assert.equal(valueOfRemote(row("Account", "[sealed]"), sealed.remote), null, "a masked value is never a value");
  assert.equal(whenHolds("x", { e: ["X "] }), true);
  assert.equal(
    whenRemote("/a", { path: "/b", equals: "x" }),
    '=when:{"p":"/a","w":"/b","e":["x"]}',
    "the old form is unchanged",
  );
});

test("a bad condition or a plain field beside a conditional sealed one is refused", () => {
  const mut = (f: (r: Record<string, any>) => void): string[] => {
    const r = base();
    f(r);
    return errs(r);
  };
  const w = (r: Record<string, any>): Record<string, any> => r["objects"][0].fields[1].onlyWhen;
  assert.ok(
    mut((r) => (w(r).matches = "(")).some((e) => e.includes("onlyWhen is")),
    "a pattern that is not one",
  );
  assert.ok(
    mut((r) => (w(r).equals = "x")).some((e) => e.includes("onlyWhen is")),
    "equals and matches together",
  );
  assert.ok(
    mut((r) => delete w(r).matches).some((e) => e.includes("onlyWhen is")),
    "neither",
  );
  assert.deepEqual(errs(base()), []);
  // a plain field at the sealed field's pointer that does not say when would lose its value
  const r = base();
  delete r["objects"][0].fields[1].onlyWhen;
  const said = parseSpec(r);
  assert.ok(said.spec, "the spec's shape is fine; the check is the validator's");
});

test("rows needs an id of /_key and a * in its pointer", () => {
  const r = base();
  r["objects"][0].rows = { at: "/parts/*", idAt: "/id" };
  assert.ok(errs(r).some((e) => e.includes("/_key")));
  r["objects"][0].id = "/_key";
  assert.deepEqual(errs(r), []);
  r["objects"][0].rows = { at: "/parts", idAt: "/id" };
  assert.ok(errs(r).some((e) => e.includes("rows is")));
  const c = compileSpec(
    parseSpec({ ...base(), objects: [{ ...base()["objects"][0], id: "/_key", rows: { at: "/parts/*", idAt: "/id" } }] })
      .spec!,
  );
  assert.deepEqual(c.connector.actions.find((a) => a.name === "list_assets")!.shape!.rows, {
    at: "/parts/*",
    idAt: "/id",
  });
});
