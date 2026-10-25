// A stand-in for the records and schema modules, for tests: the capabilities sources calls through ctx.call, answered from a kernel RecordStore.
import { mintRecordId } from "../../../lib/ids.ts";
import type { Filter, Store } from "../../../kernel/src/store/types.ts";

export function fakeCall(store: Store, log: { cap: string; input: unknown }[] = []): (cap: string, input: unknown) => Promise<unknown> {
  const row = (r: { id: string; data: Readonly<Record<string, unknown>> }) => ({ id: r.id, fields: { ...r.data } });
  return async (cap, input) => {
    log.push({ cap, input });
    const i = input as Record<string, any>;
    switch (cap) {
      case "schema.types.get": {
        const t = (await store.types()).find((x) => x.name === i.type);
        if (!t) throw Object.assign(new Error(`no type ${i.type}`), { error: { code: "validation.not_found", message: `no type ${i.type}` } });
        return { type: { key: t.name, fields: t.fields.map((f) => ({ key: f.name, ...(f.required ? { required: true } : {}) })) } };
      }
      case "records.query": {
        const p = await store.query(i.type, { ...(i.filter ? { filter: i.filter as Filter } : {}), page: { limit: i.limit ?? 50 } });
        return { rows: p.rows.map(row) };
      }
      case "records.create": {
        const rec = await store.create(i.type, mintRecordId(), i.fields);
        return { record: { id: rec.id, fields: { ...rec.data } } };
      }
      case "records.update": {
        const cur = await store.get(i.type, i.recordId);
        if (!cur) throw new Error(`no ${i.type} ${i.recordId}`);
        const rec = await store.update(i.type, i.recordId, i.patch, cur.version);
        return { record: { id: rec.id, fields: { ...rec.data } } };
      }
      case "records.bulk_upsert": {
        let created = 0, updated = 0, skipped = 0;
        for (const r of i.rows as Record<string, unknown>[]) {
          const filter: Filter = { and: (i.match as string[]).map((m) => ({ field: m, op: "eq" as const, value: r[m] })) };
          const hits = await store.query(i.type, { filter, page: { limit: 2 } });
          if (hits.rows.length > 1) throw Object.assign(new Error("two records match"), { error: { code: "validation.duplicate", message: "two records match" } });
          const hit = hits.rows[0];
          if (!hit) { await store.create(i.type, mintRecordId(), r); created++; continue; }
          const diff = Object.fromEntries(Object.entries(r).filter(([k, v]) => JSON.stringify(hit.data[k]) !== JSON.stringify(v)));
          if (!Object.keys(diff).length) { skipped++; continue; }
          await store.update(i.type, hit.id, diff, hit.version);
          updated++;
        }
        return { created, updated, skipped };
      }
      default: throw new Error(`the test double does not answer ${cap}`);
    }
  };
}
