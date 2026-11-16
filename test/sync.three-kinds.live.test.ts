// One id pointer that can point at three kinds of record over one number range, pulled through the real relation linker: each note links to exactly the right target.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { call, hostLog, waitFor } from "./support/eco-live.ts";
import {
  APP_KEY,
  DASHED,
  DIGITS,
  SPACED,
  pulled,
  pump,
  rowsOf,
  scan,
  spec,
  world,
  dumpDb,
} from "./support/sync-live.ts";
test("one id pointer, three kinds of record over one number range: each note links to exactly the right target", async () => {
  const w = await world(true);
  try {
    assert.equal(w.item.status, 200, JSON.stringify(w.item.data));
    const applied = await call(w.d, "sync_specs.apply", { spec: spec(), idempotencyKey: "apply-3" });
    assert.equal(applied.status, 200, JSON.stringify(applied.data));
    await pulled(w.d, ["matter", "contact", "company", "note"]);
    const idOf = async (type: string, name: string): Promise<string> =>
      (await rowsOf(w.d, type)).find((r) => r.fields["name"] === name)!.id;
    const ids = {
      "Matter 1": await idOf("matter", "Matter 1"),
      "Matter 2": await idOf("matter", "Matter 2"),
      "Contact 1": await idOf("contact", "Contact 1"),
      "Company 2": await idOf("company", "Company 2"),
    };
    const linked = (r: { fields: Record<string, unknown> }): string[] =>
      ["matter_of", "contact_of", "company_of"]
        .flatMap((k) => {
          const v = r.fields[k];
          return Array.isArray(v) ? v : v ? [v] : [];
        })
        .map((x) =>
          typeof x === "string"
            ? x
            : String((x as { urn?: string }).urn)
                .split("/")
                .pop()!,
        );
    const notes = await rowsOf(w.d, "note");
    const by = (text: string) => notes.find((n) => n.fields["text"] === text)!;
    assert.deepEqual(linked(by("note a")), [ids["Matter 1"]], "prospect 1 is Matter 1, never Contact 1");
    assert.deepEqual(linked(by("note b")), [ids["Contact 1"]], "contact 1 is Contact 1, never Matter 1");
    assert.deepEqual(linked(by("note c")), [ids["Company 2"]]);
    assert.deepEqual(linked(by("note d")), [ids["Matter 2"]], "the kind is compared without case or spaces");
    assert.deepEqual(linked(by("note e")), [], "an unknown kind links to nothing");
  } finally {
    await w.close();
  }
});
