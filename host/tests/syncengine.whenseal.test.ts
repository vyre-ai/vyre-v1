// A field that is sealed only when another field of the row says so (a number whose label reads "Account Number"), next to a plain field that takes the same pointer for every other label.
// The real value is kept by the process and never in the row; the pointer's own value is gone from the row once the sealed value is held; a masked value is never taken as a plain one.
import test from "node:test";
import assert from "node:assert/strict";
import { remoteStore } from "../src/daemon/syncengine.ts";

const LABEL = "/identifier_label";
const VALUE = "/identifier_value";
const RULE = ["account", "policy", "ein", "vehicle identification"];
const SEALED = `=when:${JSON.stringify({ p: VALUE, w: LABEL, m: RULE })}`;
const PLAIN = `=when:${JSON.stringify({ p: VALUE, w: LABEL, m: RULE, n: true })}`;

function store(rows: { id: string; label: unknown; value: unknown }[], real: Record<string, string>, unmasked = true) {
  const ctx = {
    trace: { traceId: "t1" },
    call: async (): Promise<unknown> => ({
      output: {
        results: rows.map((r) => ({
          id: r.id,
          properties: { [LABEL]: r.label, [VALUE]: unmasked ? "[sealed]" : "[sealed]" },
        })),
      },
    }),
  };
  const s = remoteStore(
    ctx as never,
    { connector: "crm_intake", connectionId: "con_1", remote: "assets" },
    { assets: { list: "list_assets" } },
    {
      sealed: [{ remote: SEALED, local: "identifier_sealed" }],
      whens: [SEALED, PLAIN],
      ...(unmasked
        ? { heldOf: (_n: string, id: string) => (real[id] !== undefined ? { [VALUE]: real[id] } : undefined) }
        : {}),
    },
  );
  return s;
}

test("the label decides: a number-kind label seals the value, any other label keeps it plain, and the pointer's own value is not left in the row", async () => {
  const s = store(
    [
      { id: "a1", label: "Account Number (last 4 digits)", value: "x" },
      { id: "a2", label: "Address / Description", value: "x" },
      { id: "a3", label: "EIN", value: "x" },
      { id: "a4", label: "Vehicle Identification Number", value: "x" },
    ],
    { a1: "1234", a2: "12 Sample Street", a3: "99-9999999", a4: "VIN0000SAMPLE" },
  );
  const got = await s.page();
  const byId = Object.fromEntries(got.rows.map((r) => [r.id, r.data]));
  assert.equal(byId["a2"]![PLAIN], "12 Sample Street", "an address is plain");
  assert.equal(byId["a2"]![SEALED], undefined, "and not sealed (removed from the row)");
  for (const id of ["a1", "a3", "a4"]) assert.equal(byId[id]![PLAIN], null, `${id}: the plain field stays empty`);
  // the real values are held by the process, per row
  assert.equal(s.held.get("a1")!.values["identifier_sealed"], "1234");
  assert.equal(s.held.get("a3")!.values["identifier_sealed"], "99-9999999");
  assert.equal(s.held.get("a2")!.values["identifier_sealed"], null);
  // nowhere in any row: neither the raw pointer nor any real secret
  const everything = JSON.stringify(got.rows);
  for (const secret of ["1234", "99-9999999", "VIN0000SAMPLE"]) assert.ok(!everything.includes(secret), secret);
  for (const id of ["a1", "a2", "a3", "a4"])
    assert.equal(byId[id]![VALUE], undefined, `${id}: the pointer's value is out of the row`);
});

test("a row with no label is plain-empty and unsealed, and a masked value is never taken as a plain one", async () => {
  const s = store([{ id: "b1", label: null, value: "x" }], {}, false);
  const got = await s.page();
  const d = got.rows[0]!.data;
  assert.equal(d[PLAIN], null);
  // not unmasked (no real value): the masked marker is not a value
  const s2 = store([{ id: "b2", label: "Address", value: "x" }], {}, false);
  const d2 = (await s2.page()).rows[0]!.data;
  assert.equal(d2[PLAIN], null, "masked, so empty rather than the word [sealed]");
});
