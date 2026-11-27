// records.update_many answers each item on its own and announces what changed in the order given, as records.update one after another does: a record the caller may not edit, one that is gone and one whose
// version moved are refused alone; an item that changes nothing is no write and no event.
import test from "node:test";
import assert from "node:assert/strict";
import { mintRecordId } from "../../../lib/ids.ts";
import { openRecords, setRecordsVault } from "../impl.ts";
import { createUpdateManyHandler, MAX_UPDATE_MANY } from "../handlers/update-many.ts";
import { PERSON } from "../fixtures/seed.ts";

async function run(many: boolean) {
  const rec = openRecords({ space: `sp_umh_${many ? "m" : "o"}`, path: ":memory:" });
  await rec.store.define({ add_types: [PERSON] });
  const ids: string[] = [];
  for (let i = 0; i < 6; i++) {
    const id = mintRecordId();
    ids.push(id);
    await rec.store.create("person", id, { name: `P ${i}` });
  }
  const emitted: string[] = [];
  const denied = ids[2]!;
  const ctx = {
    trace: { traceId: "0123456789abcdef0123456789abcdef" },
    emit: (type: string, subject: string, payload: Record<string, unknown>) =>
      void emitted.push(
        `${type} ${subject.replace(ids[0]!, "p0").replace(ids[1]!, "p1")} ${JSON.stringify(payload["fields"])}`,
      ),
    principal: { kind: "person", id: "usr_dana" },
    authorize: (_a: unknown, r: { id: string | null }) => ({
      effect: r.id === denied ? ("deny" as const) : ("allow" as const),
    }),
  };
  const items = [
    { recordId: ids[0]!, patch: { name: "P 0 new" } },
    { recordId: ids[1]!, patch: { name: "P 1 new", ssn: null } },
    { recordId: ids[2]!, patch: { name: "no" } }, // not allowed
    { recordId: mintRecordId(), patch: { name: "ghost" } }, // gone
    { recordId: ids[4]!, patch: { name: "P 4" } }, // changes nothing
    { recordId: ids[5]!, patch: { name: "P 5 new" }, baseVersion: 9 }, // the version moved
  ];
  const meta = () => ({ label: 0, holds: 0 });
  let out: { recordId: string; record?: { version: number }; error?: { code: string } }[];
  if (many)
    out = (await createUpdateManyHandler({ store: rec.store, meta })(ctx as never, { type: "person", items })).results;
  else {
    out = [];
    for (const it of items) {
      try {
        const d = ctx.authorize(null, { id: it.recordId });
        if (d.effect !== "allow") throw Object.assign(new Error("no"), { code: "validation.not_found" });
        const cur = await rec.store.get("person", it.recordId);
        if (!cur) throw Object.assign(new Error("no"), { code: "validation.not_found" });
        const rec2 = await rec.store.update(
          "person",
          it.recordId,
          it.patch as never,
          (it as { baseVersion?: number }).baseVersion ?? cur.version,
        );
        out.push({ recordId: it.recordId, record: { version: rec2.version } });
        if (rec2.version !== cur.version)
          ctx.emit("record.updated", `record/${rec2.id}`, {
            fields: Object.fromEntries(Object.keys(it.patch).map((k) => [k, rec2.data[k] ?? null])),
          });
      } catch (e) {
        out.push({
          recordId: it.recordId,
          error: {
            code:
              (e as { code?: string }).code === "version_conflict"
                ? "validation.version_conflict"
                : "validation.not_found",
          },
        });
      }
    }
  }
  return {
    results: out.map((r) => (r.record ? `ok v${r.record.version}` : `refused ${r.error!.code}`)),
    emitted,
  };
}

test("update_many answers each item on its own and announces in order, as update one after another does", async () => {
  const one = await run(false);
  const many = await run(true);
  assert.deepEqual(many.results, [
    "ok v2",
    "ok v2",
    "refused validation.not_found",
    "refused validation.not_found",
    "ok v1",
    "refused validation.version_conflict",
  ]);
  assert.deepEqual(many.results, one.results);
  assert.deepEqual(
    many.emitted,
    one.emitted,
    "the same record.updated events in the same order, none for the item that changed nothing",
  );
  assert.equal(many.emitted.length, 2);
});

test("update_many takes at most one group", async () => {
  const rec = openRecords({ space: "sp_umh_max", path: ":memory:" });
  const h = createUpdateManyHandler({ store: rec.store, meta: () => ({ label: 0, holds: 0 }) });
  await assert.rejects(
    h({ trace: { traceId: "0123456789abcdef0123456789abcdef" }, emit: () => undefined } as never, {
      type: "person",
      items: Array.from({ length: MAX_UPDATE_MANY + 1 }, () => ({ recordId: mintRecordId(), patch: {} })),
    }),
  );
});

test("an item that needs approval says so and is not made; it is not a missing record", async () => {
  const rec = openRecords({ space: "sp_umh_hold", path: ":memory:" });
  await rec.store.define({ add_types: [PERSON] });
  const id = mintRecordId();
  await rec.store.create("person", id, { name: "P" });
  const h = createUpdateManyHandler({ store: rec.store, meta: () => ({ label: 0, holds: 0 }) });
  const out = await h(
    {
      trace: { traceId: "0123456789abcdef0123456789abcdef" },
      emit: () => undefined,
      principal: { kind: "person", id: "usr_dana" },
      authorize: () => ({ effect: "hold" as const }),
    } as never,
    { type: "person", items: [{ recordId: id, patch: { name: "Q" } }] },
  );
  assert.equal(out.results[0]!.error?.code, "permission.needs_approval");
  assert.equal((await rec.store.get("person", id))!.data["name"], "P");
});

test("an item whose sealed put failed twice is refused with the not-saved words and no record.updated is announced for it; the others are announced", async () => {
  const kept = new Map<string, string>();
  setRecordsVault({
    put: async (o) => {
      if (o.value === "boom") throw new Error("the Vault refused");
      const ref = o.ref ?? `vit_${o.recordId}_${o.field}`;
      kept.set(ref, o.value);
      return ref;
    },
    reveal: async (ref) => kept.get(ref) ?? "",
    discard: async (ref) => void kept.delete(ref),
  });
  try {
    const rec = openRecords({ space: "sp_umh_atomic", path: ":memory:" });
    await rec.store.define({ add_types: [PERSON] });
    const a = mintRecordId();
    const b = mintRecordId();
    await rec.store.create("person", a, { name: "A", ssn: { sealed: true, value: "old" } } as never);
    await rec.store.create("person", b, { name: "B" });
    const emitted: string[] = [];
    const ctx = {
      trace: { traceId: "0123456789abcdef0123456789abcdef" },
      emit: (type: string, subject: string) => void emitted.push(`${type} ${subject}`),
      principal: { kind: "person", id: "usr_dana" },
      authorize: () => ({ effect: "allow" as const }),
    };
    const out = (
      await createUpdateManyHandler({ store: rec.store, meta: () => ({ label: 0, holds: 0 }) })(ctx as never, {
        type: "person",
        items: [
          { recordId: a, patch: { name: "A renamed", ssn: "boom" } },
          { recordId: b, patch: { name: "B renamed" } },
        ],
      })
    ).results;
    assert.ok(out[0]!.error, "the item answers an error");
    assert.match(out[0]!.error!.message, /the value was not saved; the record keeps its previous value/);
    assert.equal(out[1]!.record !== undefined, true);
    assert.deepEqual(emitted, [`record.updated record/${b}`], "nothing is announced for the item that failed");
    assert.equal((await rec.store.get("person", a))!.data.name, "A");
  } finally {
    setRecordsVault(null as never);
  }
});
