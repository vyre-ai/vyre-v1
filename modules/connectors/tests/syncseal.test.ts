// A sealed field in a SyncSpec: compiled to a Vyre sealed field read from the app only, never shown by validate, preview or sample, and a secret-looking field mapped plain is warned about.
import test from "node:test";
import assert from "node:assert/strict";
import { ledgerSpec } from "../fixtures/crm.ts";
import { world } from "../fixtures/crm-world.ts";
import { compileSpec, parseSpec } from "../syncspec.ts";
import type { SyncSpec } from "../syncspec.ts";

const mutate = (spec: Record<string, any>, fn: (s: Record<string, any>) => void): Record<string, any> => {
  const s = JSON.parse(JSON.stringify(spec));
  fn(s);
  return s;
};
const PHONE = "555 0101";
/** The people object's phone field (a value every sampled record has) given as sealed. */
const sealedPhone = (direction = "pull") =>
  mutate(ledgerSpec(), (s) => {
    const f = s["objects"][1]["fields"].find((x: any) => x.path === "/attributes/phone");
    f.type = "sealed";
    s["mapping"][1]["fields"].find((x: any) => x.path === "/attributes/phone").direction = direction;
  });

test("sealed is a field type: it compiles to a Vyre sealed field read from the app only", () => {
  const parsed = parseSpec(sealedPhone("both"));
  assert.ok(parsed.spec, JSON.stringify(parsed.problems));
  const person = compileSpec(parsed.spec as SyncSpec).types.find((t) => t.recordType === "person")!;
  assert.deepEqual(
    person.defs.find((d) => d.key === "phone"),
    { key: "phone", type: "sealed", title: "Phone" },
  );
  const f = person.fields.find((x) => x.key === "phone")!;
  assert.equal(f.sealed, true);
  assert.equal(f.dir, "pull", "a sealed value is never written back, whatever the mapping says");
  assert.ok(person.fields.filter((x) => x.sealed).length === 1);
  // a sealed field is never the title
  const titled = compileSpec(
    parseSpec(mutate(sealedPhone(), (s) => (s["mapping"][1]["titleField"] = "/attributes/phone"))).spec as SyncSpec,
  ).types.find((t) => t.recordType === "person")!;
  assert.notEqual(titled.titleField, "phone");
});

test("validate and preview say a sealed field is sealed and whether values are there, never the value or its length", async () => {
  const w = world();
  const v = await w.k.hs["sync_specs.validate"](w.ctx, { spec: sealedPhone() });
  assert.equal(v.ok, true, JSON.stringify(v.problems));
  const note = v.problems.find((p) => p.at.endsWith("/attributes/phone"))!;
  assert.match(
    note.message,
    /Phone is sealed: \d+ of \d+ sampled records have a value, and the values are never shown\./,
  );
  assert.ok(!JSON.stringify(v).includes(PHONE));
  const p = await w.k.hs["sync_specs.preview"](w.ctx, { spec: sealedPhone() });
  assert.ok(!JSON.stringify(p).includes(PHONE), "the preview never holds the value");
  const shown = p.samples.find((s) => s.type === "person")!.fields.find((f) => f.key === "phone")!;
  assert.deepEqual(shown.value, { sealed: true, present: true });
  // written back is refused
  const both = await w.k.hs["sync_specs.validate"](w.ctx, { spec: sealedPhone("both") });
  assert.equal(both.ok, false);
  assert.match(both.problems.filter((x) => x.level === "error")[0]!.message, /Phone is sealed, so it is only read/);
});

test("a field that looks like a secret identifier and is mapped plain is warned about, by name", async () => {
  const w = world();
  const spec = mutate(ledgerSpec(), (s) => {
    s["objects"][1]["fields"].find((x: any) => x.path === "/attributes/tier").label = "Tax ID";
  });
  const v = await w.k.hs["sync_specs.validate"](w.ctx, { spec });
  assert.equal(v.ok, true);
  assert.ok(
    v.problems.some(
      (p) => p.level === "warn" && /Tax ID looks like a secret identifier\. Map it as sealed/.test(p.message),
    ),
  );
  // a date of birth is not one of them
  const dob = await w.k.hs["sync_specs.validate"](
    w.ctx,
    mutate(ledgerSpec(), (s) => {
      s["objects"][1]["fields"].find((x: any) => x.path === "/attributes/tier").label = "Date of birth";
    }) && {
      spec: mutate(ledgerSpec(), (s) => {
        s["objects"][1]["fields"].find((x: any) => x.path === "/attributes/tier").label = "Date of birth";
      }),
    },
  );
  assert.ok(!dob.problems.some((p) => /secret identifier/.test(p.message)));
});

test("sync_specs.sample shows a secret identifier as sealed, never its value", async () => {
  const w = world();
  w.k.deps.probe = async () => ({
    status: 200,
    text: JSON.stringify({
      data: [{ id: 1, name: "Imran Ibarra", ssn: "123-45-6789", notes: "call 987-65-4321 back" }],
    }),
  });
  const out = await w.k.hs["sync_specs.sample"](w.ctx, {
    auth: { vaultHandle: "#Ledger_Key", style: "bearer" },
    domain: "crm-a.test",
    path: "/people",
  } as never);
  const text = JSON.stringify(out);
  assert.ok(!text.includes("123-45-6789"), "named by its key");
  assert.ok(!text.includes("987-65-4321"), "named by its shape");
  assert.ok(text.includes("[sealed]"));
  assert.ok(text.includes("Imran Ibarra"), "everything else is shown as before");
});

import { maskSealed, SEALED_HELD, SYNC_PASS_TOKEN, secretKeyName } from "../projections.ts";

const SECRET = "123-45-6789";
test("maskSealed masks the leaf, its item's other values and every list item with the same id, in the firm's custom-field shape", () => {
  const row = {
    id: "9",
    attributes: {
      name: "Imran Ibarra",
      social_security: SECRET,
      custom_field_values: { "77": { id: 77, name: "Social Security", value: SECRET, formatted_value: SECRET } },
      custom_fields: [
        { id: 77, name: "Social Security", field_type: "text", value: SECRET, formatted_value: SECRET },
        { id: 78, name: "Nickname", field_type: "text", value: "Im", formatted_value: "Im" },
      ],
    },
  };
  const out = maskSealed({ data: [row] }, [
    "/attributes/custom_field_values/77/formatted_value",
    "/attributes/social_security",
  ]);
  const text = JSON.stringify(out);
  assert.ok(!text.includes(SECRET), text);
  assert.ok(
    text.includes("Imran Ibarra") && text.includes("Nickname") && text.includes('"Im"'),
    "everything else stays",
  );
  assert.ok(text.includes("Social Security"), "the field's name stays");
  // a pulled row keyed by pointers
  const flat = maskSealed(
    { rows: [{ id: "1", data: { "/attributes/social_security": SECRET, "/attributes/name": "A" } }] },
    ["/attributes/social_security"],
  );
  assert.ok(!JSON.stringify(flat).includes(SECRET));
  assert.ok(JSON.stringify(flat).includes('"A"'));
});

test("the name guard knows secret identifiers, and leaves paging tokens and other names alone", () => {
  for (const k of [
    "ssn",
    "SSN",
    "social_security",
    "Social Security Number",
    "tax_id",
    "tin",
    "EIN",
    "account_number",
    "routing-number",
    "driver_license",
    "drivers_licence_number",
    "passport_number",
    "card number",
  ])
    assert.ok(secretKeyName(k), k);
  for (const k of ["next_page_token", "date_of_birth", "dob", "einstein", "tinder", "name", "id", "account_name"])
    assert.ok(!secretKeyName(k), k);
});

test("a compiled sync connector masks sealed values in every output; only the engine's own pass gets them", async () => {
  const w = world();
  const spec = sealedPhone();
  const out = await w.k.hs["sync_specs.apply"](w.ctx, { spec, idempotencyKey: "m1" });
  w.k.state.reply = () => ({
    status: 200,
    body: {
      data: [{ id: 1, attributes: { full_name: "Ada Stone", phone: "+1 555 0101" }, modified: "2026-10-01T10:00:00Z" }],
    },
  });
  const def = JSON.parse(
    w.k.tx.get<{ def: string }>("SELECT def FROM cn_connectors WHERE key = ?", out.connector)!.def,
  );
  assert.deepEqual(def.sealed, ["/attributes/phone"]);
  const read = (input: unknown) =>
    w.k.hs["connectors.read"](w.ctx, {
      key: out.connector,
      action: "list_people",
      connectionId: out.connectionId,
      input,
    });
  const masked = await read({});
  assert.ok(!JSON.stringify(masked).includes(PHONE) && JSON.stringify(masked).includes("[sealed]"));
  assert.ok(JSON.stringify(masked).includes("Ada Stone"));
  const guess = await read({ __unmask: "guess" });
  assert.ok(!JSON.stringify(guess).includes(PHONE), "a wrong token gets nothing");
  // the engine's own pass: the answer is masked too (it crosses the pipeline); the real value stays in this process for the engine to take
  const real = await read({ __unmask: `${SYNC_PASS_TOKEN}:n1` });
  assert.ok(!JSON.stringify(real).includes(PHONE), "even the engine's answer carries the mask");
  assert.equal(SEALED_HELD.get("n1", "1")?.["/attributes/phone"], "+1 555 0101", "the value is kept in the process for the engine");
  SEALED_HELD.done("n1");
  assert.equal(SEALED_HELD.get("n1", "1"), undefined);
  assert.equal(SEALED_HELD.get("other", "1"), undefined, "a wrong nonce gets nothing");
  const run = await w.k.hs["connectors.run"](w.ctx, {
    key: out.connector,
    action: "list_people",
    connectionId: out.connectionId,
    input: {},
  } as never).catch(() => undefined);
  if (run) assert.ok(!JSON.stringify(run).includes(PHONE));
});
