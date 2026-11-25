// The records store updates several records at once (updateMany: one commit) and seals what is sealed, as update does for one: the same values reach the Vault under the same references, the rows hold the same
// references, nothing plain is in a row or an event, and an item that is refused (a version that moved, a write-once field) is refused alone.
import test from "node:test";
import assert from "node:assert/strict";
import { mintRecordId } from "../../../lib/ids.ts";
import { openRecords, setRecordsVault } from "../impl.ts";
import { PERSON } from "../fixtures/seed.ts";

async function run(grouped: boolean) {
  const kept = new Map<string, string>();
  let n = 0;
  setRecordsVault({
    put: async (o) => {
      const ref = o.ref ?? `vit_${o.recordId}_${o.field}`;
      kept.set(ref, o.value);
      n++;
      return ref;
    },
    reveal: async (ref) => kept.get(ref) ?? "",
    discard: async (ref) => void kept.delete(ref),
  });
  try {
    const rec = openRecords({ space: `sp_um_${grouped ? "g" : "o"}`, path: ":memory:" });
    await rec.store.define({ add_types: [PERSON] });
    const store = grouped ? rec.store : { ...rec.store, updateMany: undefined };
    const ids: string[] = [];
    for (let i = 0; i < 9; i++) {
      const id = mintRecordId();
      ids.push(id);
      await rec.store.create("person", id, { name: `P ${i}` });
    }
    const items = [
      ...ids.slice(0, 6).map((id, i) => ({ id, patch: { ssn: { sealed: true, value: `ssn-${i}` } }, base_version: 1 })),
      { id: ids[6]!, patch: { ssn: "" }, base_version: 1 }, // an empty value is no value
      { id: ids[7]!, patch: { ssn: { sealed: true, value: "late" } }, base_version: 7 }, // refused: the version moved
      { id: ids[8]!, patch: { name: "P 8 renamed", ssn: "plain-8" }, base_version: 1 },
    ];
    const out = store.updateMany
      ? await store.updateMany("person", items as never)
      : await Promise.all(
          items.map((it) =>
            store.update("person", it.id, it.patch as never, it.base_version).then(
              (record) => ({ ok: true as const, record }),
              (error: unknown) => ({ ok: false as const, error }),
            ),
          ),
        );
    const names = new Map(ids.map((id, i) => [id, `P ${i}`]));
    const rows = rec.host.tx
      .all<{ id: string; version: number; data: string }>("SELECT id, version, data FROM rt_person")
      .map((r) => `${r.version} ${r.data.replaceAll(r.id, "id")}`)
      .sort();
    const everything =
      rec.host.store
        .read({ limit: 5000 })
        .map((e) => new TextDecoder().decode(e.payload))
        .join("\n") + rows.join("\n");
    return {
      results: out.map((r) => (r.ok ? `ok v${r.record.version}` : `refused ${(r.error as { code?: string }).code}`)),
      rows,
      vault: [...kept].map(([k, v]) => `${k.replace(/rec_[0-9a-f]+/, (m) => names.get(m) ?? m)}=${v}`).sort(),
      events: rec.host.tx
        .all<{ t: string }>("SELECT json_extract(event, '$.type') AS t FROM events ORDER BY seq")
        .map((r) => r.t),
      leaked: /ssn-\d|plain-8|late/.test(everything),
      puts: n,
      live: kept.size,
    };
  } finally {
    setRecordsVault(null as never);
  }
}

test("updateMany seals and updates the way update does for each item, and refuses an item alone", async () => {
  const one = await run(false);
  const many = await run(true);
  assert.deepEqual(many.results, one.results);
  assert.equal(many.results[7], "refused version_conflict");
  assert.deepEqual(many.rows.length, one.rows.length);
  assert.equal(many.puts, one.puts, "the same number of values reached the Vault");
  assert.equal(
    many.live,
    7,
    "a value put for the item the store refused (a version that moved) was taken back: one live value for each record updated",
  );
  assert.deepEqual(many.events, one.events, "the same events in the same order");
  assert.equal(many.leaked, false, "nothing plain is in a row or an event");
  assert.equal(one.leaked, false);
});

test("a group whose commit fails leaves no value in the Vault, and the one-at-a-time retry leaves exactly one for each record", async () => {
  const kept = new Map<string, string>();
  let puts = 0;
  setRecordsVault({
    put: async (o) => {
      const ref = o.ref ?? `vit_${o.recordId}_${o.field}_${++puts}`;
      kept.set(ref, o.value);
      return ref;
    },
    reveal: async (ref) => kept.get(ref) ?? "",
    discard: async (ref) => void kept.delete(ref),
  });
  try {
    const rec = openRecords({ space: "sp_um_fail", path: ":memory:" });
    await rec.store.define({ add_types: [PERSON] });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = mintRecordId();
      ids.push(id);
      await rec.store.create("person", id, { name: `P ${i}` });
    }
    const log = rec.host.store as unknown as { appendBatch: (b: unknown[]) => unknown };
    const was = log.appendBatch.bind(log);
    let failNext = true;
    log.appendBatch = (b) => {
      if (failNext) {
        failNext = false;
        throw new Error("the commit failed");
      }
      return was(b);
    };
    const items = ids.map((id, i) => ({ id, patch: { ssn: { sealed: true, value: `ssn-${i}` } }, base_version: 1 }));
    await assert.rejects(
      rec.store.updateMany!("person", items as never),
      (e: { code?: string }) => e.code === "unavailable",
    );
    assert.equal(kept.size, 0, "a group that failed whole left nothing in the Vault");
    // the caller tries again one record at a time
    for (const it of items) await rec.store.update("person", it.id, it.patch as never, it.base_version);
    assert.equal(kept.size, 5, "exactly one live value for each record");
  } finally {
    setRecordsVault(null as never);
  }
});

test("a put that fails on the second sealed field of an item takes back the first one", async () => {
  const kept = new Map<string, string>();
  let puts = 0;
  setRecordsVault({
    put: async (o) => {
      if (o.value === "boom") throw new Error("the Vault refused");
      const ref = o.ref ?? `vit_${o.recordId}_${o.field}_${++puts}`;
      kept.set(ref, o.value);
      return ref;
    },
    reveal: async (ref) => kept.get(ref) ?? "",
    discard: async (ref) => void kept.delete(ref),
  });
  try {
    const rec = openRecords({ space: "sp_um_two", path: ":memory:" });
    const TWO = { ...PERSON, name: "pair", fields: [...PERSON.fields, { name: "dob", kind: "sealed", label: "Born" }] };
    await rec.store.define({ add_types: [TWO] as never });
    const a = mintRecordId();
    const b = mintRecordId();
    await rec.store.create("pair", a, { name: "A" });
    await rec.store.create("pair", b, { name: "B" });
    const out = await rec.store.updateMany!("pair", [
      {
        id: a,
        patch: { ssn: { sealed: true, value: "one" }, dob: { sealed: true, value: "boom" } } as never,
        base_version: 1,
      },
      {
        id: b,
        patch: { ssn: { sealed: true, value: "two" }, dob: { sealed: true, value: "ok" } } as never,
        base_version: 1,
      },
    ]);
    assert.deepEqual(
      out.map((r) => r.ok),
      [false, true],
    );
    assert.equal(
      kept.size,
      2,
      "only the record that was updated holds values (its two); the first field of the failed item was taken back",
    );
  } finally {
    setRecordsVault(null as never);
  }
});

// A vault stand-in that keeps values by reference, overwrites in place under a given ref, can fail a put on a chosen value, and can show a value back to Records (peek) so an overwrite can be undone.
function keptVault(): { kept: Map<string, string>; install: () => void } {
  const kept = new Map<string, string>();
  let puts = 0;
  return {
    kept,
    install: () =>
      setRecordsVault({
        put: async (o) => {
          if (o.value === "boom") throw new Error("the Vault refused");
          const ref = o.ref ?? `vit_${o.recordId}_${o.field}_${++puts}`;
          kept.set(ref, o.value);
          return ref;
        },
        reveal: async (ref) => kept.get(ref) ?? "",
        peek: async (ref) => kept.get(ref),
        discard: async (ref) => void kept.delete(ref),
      }),
  };
}
const TWO_SEALED = {
  ...PERSON,
  name: "pair",
  fields: [...PERSON.fields, { name: "dob", kind: "sealed", label: "Born" }],
};

test("a sealed value overwritten in place and then refused by the record write leaves the old value under the old ref", async () => {
  const v = keptVault();
  v.install();
  try {
    const rec = openRecords({ space: "sp_um_inplace", path: ":memory:" });
    await rec.store.define({ add_types: [TWO_SEALED] as never });
    const id = mintRecordId();
    await rec.store.create("pair", id, { name: "A", ssn: { sealed: true, value: "old-ssn" } } as never);
    const ref = [...v.kept.keys()][0]!;
    const out = await rec.store.updateMany!("pair", [
      { id, patch: { ssn: { sealed: true, value: "new-ssn" } } as never, base_version: 99 },
    ]);
    assert.equal(out[0]!.ok, false);
    assert.equal(v.kept.get(ref), "old-ssn", "the old ref still reads the old value");
    assert.equal(v.kept.size, 1, "no new sealed value is left orphaned");
  } finally {
    setRecordsVault(null as never);
  }
});

test("an item with two sealed fields that already hold values: the second put failing takes the first one back to its old value", async () => {
  const v = keptVault();
  v.install();
  try {
    const rec = openRecords({ space: "sp_um_half_inplace", path: ":memory:" });
    await rec.store.define({ add_types: [TWO_SEALED] as never });
    const id = mintRecordId();
    await rec.store.create("pair", id, {
      name: "A",
      ssn: { sealed: true, value: "old-ssn" },
      dob: { sealed: true, value: "old-dob" },
    } as never);
    const before = [...v.kept].sort().join("|");
    const out = await rec.store.updateMany!("pair", [
      {
        id,
        patch: { ssn: { sealed: true, value: "new-ssn" }, dob: { sealed: true, value: "boom" } } as never,
        base_version: 1,
      },
    ]);
    assert.equal(out[0]!.ok, false);
    assert.equal([...v.kept].sort().join("|"), before, "both refs read what they read before the call");
  } finally {
    setRecordsVault(null as never);
  }
});

test("update (one record) takes back every put of an item whose second put fails, and of an item the record write refuses", async () => {
  const v = keptVault();
  v.install();
  try {
    const rec = openRecords({ space: "sp_um_one", path: ":memory:" });
    await rec.store.define({ add_types: [TWO_SEALED] as never });
    const id = mintRecordId();
    await rec.store.create("pair", id, { name: "A" });
    await assert.rejects(
      rec.store.update(
        "pair",
        id,
        { ssn: { sealed: true, value: "one" }, dob: { sealed: true, value: "boom" } } as never,
        1,
      ),
    );
    assert.equal(v.kept.size, 0, "the first put of a half-sealed update was taken back");
    await assert.rejects(rec.store.update("pair", id, { ssn: { sealed: true, value: "one" } } as never, 99));
    assert.equal(v.kept.size, 0, "a put for an update the record write refused was taken back");
  } finally {
    setRecordsVault(null as never);
  }
});

test("create takes back the first put when the second sealed put fails", async () => {
  const v = keptVault();
  v.install();
  try {
    const rec = openRecords({ space: "sp_um_create", path: ":memory:" });
    await rec.store.define({ add_types: [TWO_SEALED] as never });
    await assert.rejects(
      rec.store.create("pair", mintRecordId(), {
        name: "A",
        ssn: { sealed: true, value: "one" },
        dob: { sealed: true, value: "boom" },
      } as never),
    );
    assert.equal(v.kept.size, 0);
  } finally {
    setRecordsVault(null as never);
  }
});
