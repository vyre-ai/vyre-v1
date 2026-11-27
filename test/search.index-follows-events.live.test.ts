// The search index follows every write that changes the text of a record: after the pump goes quiet, a record is found by its new text, not by its old text, and a deleted or dropped record is gone.
// One table, one case for each way a record's text can change. The drop of a field and the sealing of a field are written by schema.apply straight to the records store, which announces nothing to the
// Space log the index reads (only the record's own log): the index has to follow them from schema.changed.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { bootHour } from "./support/member-hour.ts";
import type { Hour } from "./support/member-hour.ts";

let h: Hour;
before(async () => {
  h = await bootHour("indexfollows");
});
after(async () => {
  await h?.stop();
});

type Hit = { kind: string; id: string; title: string };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The ids of the records search finds for a word (search.query is rate limited: a refusal waits and asks again). */
async function found(word: string): Promise<Set<string>> {
  for (let i = 0; i < 30; i++) {
    try {
      const out = (await h.owner.call("search.query", { q: word, limit: 50 })) as { hits: Hit[] };
      return new Set(out.hits.filter((x) => x.kind === "record").map((x) => x.id));
    } catch (e) {
      if (!/rate|limit|slow/i.test(String((e as Error).message ?? e)) && i > 3) throw e;
      await sleep(1_000);
    }
  }
  throw new Error("search.query kept refusing");
}

/** The consumers run until the log has nothing more for them. */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await h.d.hooks?.pump?.();
    await sleep(250);
  }
}

/** How many index entries the Space holds for a record id (the index is a table of the modules database). */
function entries(id: string): number {
  const db = new DatabaseSync(h.d.paths.modules, { readOnly: true });
  try {
    return Number((db.prepare("SELECT count(*) AS c FROM search_docs WHERE id = ?").get(id) as { c: number }).c);
  } finally {
    db.close();
  }
}

let n = 0;
async function makeType(extra: Array<Record<string, unknown>> = []): Promise<string> {
  const type = `idxf${++n}`;
  await h.owner.call("schema.apply", {
    idempotencyKey: `mk-${type}`,
    ops: [
      {
        op: "type.create",
        type,
        def: {
          title: "Item",
          plural: "Items",
          icon: "table",
          titleField: "name",
          fields: [
            { key: "name", type: "text", title: "Name" },
            { key: "note", type: "text", title: "Note" },
            ...extra,
          ],
        },
      },
    ],
  });
  return type;
}
const create = async (type: string, fields: Record<string, unknown>): Promise<string> =>
  ((await h.owner.call("records.create", { type, fields, idempotencyKey: `c-${++n}` })).record as { id: string }).id;
async function applyDestructive(ops: Array<Record<string, unknown>>, key: string): Promise<void> {
  const diff = (await h.owner.call("schema.diff", { ops })) as {
    previewToken: string;
    items: Array<{ itemKey: string; destructive: boolean }>;
  };
  await h.owner.call("schema.apply", {
    idempotencyKey: key,
    ops,
    previewToken: diff.previewToken,
    confirm: diff.items.filter((i) => i.destructive).map((i) => i.itemKey),
  });
}

async function expect(finds: Array<[string, string]>, hides: Array<[string, string]>): Promise<void> {
  await settle();
  for (const [word, id] of finds) assert.ok((await found(word)).has(id), `"${word}" finds ${id}`);
  for (const [word, id] of hides) assert.ok(!(await found(word)).has(id), `"${word}" no longer finds ${id}`);
}

/** What a case says after its act: the words that find the record, and the words that must not. */
interface Case {
  name: string;
  /** Does the act and settles; says what must hold at the end ([word, record id]). A case may check in the middle with `expect`. */
  run(): Promise<{ finds: Array<[string, string]>; hides: Array<[string, string]> }>;
}

const cases: Case[] = [
  {
    name: "records.create: found by its text",
    async run() {
      const t = await makeType();
      const id = await create(t, { name: "Crea", note: "zqcreate" });
      return { finds: [["zqcreate", id]], hides: [] };
    },
  },
  {
    name: "records.update: found by the new text, not the old",
    async run() {
      const t = await makeType();
      const id = await create(t, { name: "Upda", note: "zqupdold" });
      await settle();
      await h.owner.call("records.update", { type: t, recordId: id, patch: { note: "zqupdnew" } });
      return { finds: [["zqupdnew", id]], hides: [["zqupdold", id]] };
    },
  },
  {
    name: "records.delete: gone",
    async run() {
      const t = await makeType();
      const id = await create(t, { name: "Dele", note: "zqdelete" });
      await settle();
      await h.owner.call("records.delete", { type: t, recordId: id });
      return { finds: [], hides: [["zqdelete", id]] };
    },
  },
  {
    name: "records.restore: found again",
    async run() {
      const t = await makeType();
      const id = await create(t, { name: "Rest", note: "zqrestore" });
      await settle();
      await h.owner.call("records.delete", { type: t, recordId: id });
      await settle();
      await h.owner.call("records.restore", { type: t, recordId: id });
      return { finds: [["zqrestore", id]], hides: [] };
    },
  },
  {
    name: "records.restore_version: the earlier text is back, the later one gone",
    async run() {
      const t = await makeType();
      const id = await create(t, { name: "Vers", note: "zqverone" });
      await h.owner.call("records.update", { type: t, recordId: id, patch: { note: "zqvertwo" } });
      await settle();
      const versions = (await h.owner.call("records.versions", { type: t, recordId: id })).versions as Array<{
        versionId: string;
        version?: number;
      }>;
      const first = versions.find((v) => v.version === 1) ?? versions[versions.length - 1]!;
      await h.owner.call("records.restore_version", { type: t, recordId: id, versionId: first.versionId });
      return { finds: [["zqverone", id]], hides: [["zqvertwo", id]] };
    },
  },
  {
    name: "records.merge: the merged-away record is gone, the survivor stays",
    async run() {
      const t = await makeType();
      const a = await create(t, { name: "Survivor", note: "zqmergea" });
      const b = await create(t, { name: "Absorbed", note: "zqmergeb" });
      await settle();
      await h.owner.call("records.merge", {
        type: t,
        survivorId: a,
        mergedIds: [b],
        picks: {},
        idempotencyKey: `mg-${++n}`,
      });
      return { finds: [["zqmergea", a]], hides: [["zqmergeb", b]] };
    },
  },
  {
    name: "records.bulk_upsert: a new row is found, an updated row is found by its new text and not its old",
    async run() {
      const t = await makeType();
      const old = await create(t, { name: "Bulkold", note: "zqbulkold" });
      await settle();
      const out = (await h.owner.call("records.bulk_upsert", {
        type: t,
        match: ["name"],
        idempotencyKey: `bu-${++n}`,
        rows: [
          { name: "Bulkold", note: "zqbulknew" },
          { name: "Bulkfresh", note: "zqbulkfresh" },
        ],
      })) as { created: number; updated: number };
      assert.deepEqual([out.created, out.updated], [1, 1]);
      const fresh = (
        (await h.owner.call("records.query", { type: t, limit: 10 })).rows as Array<{
          id: string;
          fields: Record<string, unknown>;
        }>
      ).find((r) => r.fields["name"] === "Bulkfresh")!.id;
      return {
        finds: [
          ["zqbulknew", old],
          ["zqbulkfresh", fresh],
        ],
        hides: [["zqbulkold", old]],
      };
    },
  },
  {
    name: "records.update_many: found by the new text, not the old",
    async run() {
      const t = await makeType();
      const id = await create(t, { name: "Many", note: "zqmanyold" });
      await settle();
      await h.owner.call("records.update_many", {
        idempotencyKey: `um-${++n}`,
        type: t,
        items: [{ recordId: id, patch: { note: "zqmanynew" } }],
      });
      return { finds: [["zqmanynew", id]], hides: [["zqmanyold", id]] };
    },
  },
  {
    name: "import.commit: imported rows are found, an updated row by its new text and not its old",
    async run() {
      const t = await makeType();
      const old = await create(t, { name: "Impold", note: "zqimpold" });
      await settle();
      const staged = (await h.owner.call("import.parse_csv", {
        text: "Name,Note\nImpold,zqimpnew\nImpfresh,zqimpfresh\n",
      })) as { importId: string };
      const mapping = [
        { column: "Name", field: "name" },
        { column: "Note", field: "note" },
      ];
      const pv = (await h.owner.call("import.preview", {
        importId: staged.importId,
        type: t,
        mapping,
        match: ["name"],
        onMatch: "update",
      })) as { previewToken: string };
      await h.owner.call("import.commit", {
        importId: staged.importId,
        previewToken: pv.previewToken,
        idempotencyKey: `im-${++n}`,
      });
      await settle();
      const fresh = (
        (await h.owner.call("records.query", { type: t, limit: 10 })).rows as Array<{
          id: string;
          fields: Record<string, unknown>;
        }>
      ).find((r) => r.fields["name"] === "Impfresh")!.id;
      return {
        finds: [
          ["zqimpnew", old],
          ["zqimpfresh", fresh],
        ],
        hides: [["zqimpold", old]],
      };
    },
  },
  {
    name: "records.relate: a link holds an id, no word, so the record is found as before",
    async run() {
      const t = await makeType();
      const a = await create(t, { name: "Rela", note: "zqrelate" });
      const b = await create(t, { name: "Relb", note: "zqrelateb" });
      await settle();
      await h.owner.call("schema.apply", {
        idempotencyKey: `rl-${++n}`,
        ops: [{ op: "relation.add", type: t, field: "friend", def: { to: t, inverse: "friends_of" } }],
      });
      await h.owner.call("records.relate", { type: t, recordId: a, field: "friend", toId: b });
      return {
        finds: [
          ["zqrelate", a],
          ["zqrelateb", b],
        ],
        hides: [],
      };
    },
  },
  {
    name: "field.rename: the text is still found under the new field name, once",
    async run() {
      const t = await makeType();
      const id = await create(t, { name: "Renm", note: "zqrenold" });
      await settle();
      await h.owner.call("schema.apply", {
        idempotencyKey: `rn-${++n}`,
        ops: [{ op: "field.rename", type: t, field: "note", newKey: "remark" }],
      });
      await h.owner.call("records.update", { type: t, recordId: id, patch: { remark: "zqrennew" } });
      return { finds: [["zqrennew", id]], hides: [["zqrenold", id]] };
    },
  },
  {
    name: "field.drop: the text of the dropped field is not found, the record is found by its other field",
    async run() {
      const t = await makeType();
      const id = await create(t, { name: "Dropkeep", note: "zqdropped" });
      await settle();
      await applyDestructive([{ op: "field.drop", type: t, field: "note" }], `dr-${++n}`);
      return { finds: [["Dropkeep", id]], hides: [["zqdropped", id]] };
    },
  },
  {
    name: "field.retype to sealed: the plain text the field held is not found",
    async run() {
      const t = await makeType();
      const id = await create(t, { name: "Sealkeep", note: "zqsealed" });
      await settle();
      await applyDestructive([{ op: "field.retype", type: t, field: "note", toType: "sealed" }], `sl-${++n}`);
      return { finds: [["Sealkeep", id]], hides: [["zqsealed", id]] };
    },
  },
  {
    name: "type.drop: none of its records are found",
    async run() {
      const t = await makeType();
      const id = await create(t, { name: "Typegone", note: "zqtypedrop" });
      await settle();
      await applyDestructive([{ op: "type.drop", type: t }], `td-${++n}`);
      await expect([], [["zqtypedrop", id]]);
      assert.equal(entries(id), 0, "the index entry of a record of the dropped type is removed with the type");
      return { finds: [], hides: [["zqtypedrop", id]] };
    },
  },
  {
    name: "schema.restore_field: the text of a restored field is found again",
    async run() {
      const t = await makeType();
      const id = await create(t, { name: "Restfield", note: "zqrestfield" });
      await settle();
      await applyDestructive([{ op: "field.drop", type: t, field: "note" }], `rf-${++n}`);
      await expect([["Restfield", id]], [["zqrestfield", id]]);
      await h.owner.call("schema.restore_field", { type: t, field: "note" });
      return { finds: [["zqrestfield", id]], hides: [] };
    },
  },
];

for (const c of cases)
  test(c.name, async () => {
    const out = await c.run();
    await expect(out.finds, out.hides);
  });
