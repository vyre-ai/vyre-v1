// A type's title field changes: its records are found under their new titles without anyone editing them (search.titles marks the type, search.retitle titles its documents again a page at a time).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour, waitFor } from "./support/member-hour.ts";
import type { Hour } from "./support/member-hour.ts";

let h: Hour;
before(async () => {
  h = await bootHour("retitle");
});
after(async () => {
  await h?.stop();
});

type Hit = { kind: string; id: string; title: string };
const find = async (q: string): Promise<Hit[]> =>
  ((await h.owner.call("search.query", { q })).hits as Hit[]).filter((x) => x.kind === "record");

test("records are found by their new title after the type's title field changes, and not before", async () => {
  const made = await h.owner.call("schema.apply", {
    idempotencyKey: "rt-type",
    ops: [
      {
        op: "type.create",
        type: "retitle_item",
        def: {
          title: "Item",
          plural: "Items",
          icon: "table",
          titleField: "name",
          fields: [
            { key: "name", type: "text", title: "Name", required: true },
            { key: "zalias", type: "text", title: "Zalias" },
          ],
        },
      },
    ],
  });
  assert.ok(made, JSON.stringify(made));
  const rec = await h.owner.call("records.create", {
    type: "retitle_item",
    fields: { name: "Zephyrine", zalias: "Quillfeather" },
    idempotencyKey: "rt-rec",
  });
  const id = (rec.record as { id: string }).id;
  const before1 = await waitFor(
    async () => {
      const hits = (await find("Zephyrine")).filter((x) => x.id === id);
      return hits.length ? hits : null;
    },
    20_000,
    "the record is indexed under its name",
  );
  assert.equal(before1[0]!.title, "Zephyrine");
  // the title field becomes the zalias
  await h.owner.call("schema.apply", {
    idempotencyKey: "rt-change",
    ops: [{ op: "type.update", type: "retitle_item", def: { titleField: "zalias" } }],
  });
  await waitFor(
    async () => {
      await h.d.hooks!.pump();
      await h.d.hooks!.runPeriodic("search.retitle").catch(() => undefined);
      await new Promise((r) => setTimeout(r, 2_000)); // search.query is rate limited: look a few times, not as fast as possible
      const hits = (await find("Quillfeather")).filter((x) => x.id === id);
      return hits.length && hits[0]!.title === "Quillfeather" ? hits : null;
    },
    40_000,
    "the record is found under its new title",
  );
});

test("records indexed before the update, whose type's title field changed meanwhile, are titled again at the first start after it", async () => {
  const made = await h.owner.call("schema.apply", {
    idempotencyKey: "rt2-type",
    ops: [
      {
        op: "type.create",
        type: "retitle_old",
        def: {
          title: "Old",
          plural: "Olds",
          icon: "table",
          titleField: "name",
          fields: [
            { key: "name", type: "text", title: "Name", required: true },
            { key: "zalias", type: "text", title: "Zalias" },
          ],
        },
      },
    ],
  });
  assert.ok(made, JSON.stringify(made));
  const rec = await h.owner.call("records.create", {
    type: "retitle_old",
    fields: { name: "Marigold", zalias: "Tessellate" },
    idempotencyKey: "rt2-rec",
  });
  const id = (rec.record as { id: string }).id;
  await waitFor(
    async () => ((await find("Marigold")).some((x) => x.id === id && x.title === "Marigold") ? true : null),
    20_000,
    "the record is indexed under its name",
  );
  // the state before the update: no recorded title field, no marks, the one-time queue not yet run
  h.d.db!.run("DELETE FROM search_meta WHERE k LIKE 'tf:%' OR k LIKE 'retitle:%' OR k = 'retitled_all'");
  await h.owner.call("schema.apply", {
    idempotencyKey: "rt2-change",
    ops: [{ op: "type.update", type: "retitle_old", def: { titleField: "zalias" } }],
  });
  await h.d.hooks!.pump();
  await waitFor(
    async () => {
      await h.d.hooks!.pump();
      await h.d.hooks!.runPeriodic("search.retitle").catch(() => undefined);
      await new Promise((r) => setTimeout(r, 2_000));
      const hits = (await find("Tessellate")).filter((x) => x.id === id);
      return hits.length && hits[0]!.title === "Tessellate" ? hits : null;
    },
    40_000,
    "the old record is found under its new title",
  );
  const recorded = h.d.db!.all("SELECT v FROM search_meta WHERE k = 'tf:retitle_old'")[0] as { v?: string } | undefined;
  assert.equal(
    recorded?.v,
    "zalias",
    `the field the documents were titled by is recorded (${JSON.stringify(h.d.db!.all("SELECT k, v FROM search_meta"))})`,
  );
});

test("a title field that goes A, B, A while the pages run ends with every document titled by A", async () => {
  const made = await h.owner.call("schema.apply", {
    idempotencyKey: "rt3-type",
    ops: [
      {
        op: "type.create",
        type: "retitle_back",
        def: {
          title: "Back",
          plural: "Backs",
          icon: "table",
          titleField: "name",
          fields: [
            { key: "name", type: "text", title: "Name", required: true },
            { key: "zalias", type: "text", title: "Zalias" },
          ],
        },
      },
    ],
  });
  assert.ok(made, JSON.stringify(made));
  const rows = Array.from({ length: 250 }, (_, i) => ({ name: `Name ${i}`, zalias: `Alias ${i}` }));
  for (let from = 0; from < rows.length; from += 125) {
    const r = await h.owner.call("records.bulk_upsert", {
      type: "retitle_back",
      match: ["name"],
      createOnly: true,
      rows: rows.slice(from, from + 125),
      idempotencyKey: `rt3-rows-${from}`,
    });
    assert.ok(r, JSON.stringify(r));
  }
  const titles = (): string[] =>
    (h.d.db!.all("SELECT title FROM search_docs WHERE record_type = 'retitle_back'") as { title: string }[]).map(
      (x) => x.title,
    );
  await waitFor(
    async () => {
      await h.d.hooks!.pump();
      const t = titles();
      return t.length === 250 && t.every((x) => x.startsWith("Name ")) ? true : null;
    },
    60_000,
    "the 250 records are indexed under their names",
  );
  const change = async (titleField: string, key: string): Promise<void> => {
    await h.owner.call("schema.apply", {
      idempotencyKey: key,
      ops: [{ op: "type.update", type: "retitle_back", def: { titleField } }],
    });
    await h.d.hooks!.pump();
  };
  await change("zalias", "rt3-b");
  await h.d.hooks!.runPeriodic("search.retitle"); // one page of two: the type is part way through
  assert.ok(
    titles().some((x) => x.startsWith("Alias ")) && titles().some((x) => x.startsWith("Name ")),
    "part way: some documents are titled by the new field",
  );
  await change("name", "rt3-a"); // back to the first
  for (let i = 0; i < 10; i++) await h.d.hooks!.runPeriodic("search.retitle");
  assert.ok(
    titles().every((x) => x.startsWith("Name ")),
    "every document is titled by the field the type has now",
  );
  const recorded = h.d.db!.all("SELECT v FROM search_meta WHERE k = 'tf:retitle_back'")[0] as
    | { v?: string }
    | undefined;
  assert.equal(recorded?.v, "name");
  assert.equal(
    (h.d.db!.all("SELECT k FROM search_meta WHERE k LIKE 'retitle:retitle_back'") as unknown[]).length,
    0,
    "the re-titling ended: a document put in again is not met twice",
  );
});
