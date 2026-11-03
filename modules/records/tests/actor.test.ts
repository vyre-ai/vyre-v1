// A record write names who made it, as every other module's events do (owner ruling 3 Nov): the person or agent, the person an agent acts for, the trace and the run. svc_records only for
// a write no call is behind (a rebuild, a sync with no caller).
import test from "node:test";
import assert from "node:assert/strict";
import { openRecordStore, recordWriter } from "../../../kernel/src/store/records.ts";
import { mintRecordId } from "../../../lib/ids.ts";
import { writerOf } from "../impl.ts";

const CONTACT = { name: "contact", label: "Contact", fields: [{ name: "name", kind: "text", required: true }] };
const TRACE = "0123456789abcdef0123456789abcdef";

test("inside a call, the record's events carry the agent, the person it acts for, the trace and the run", async () => {
  const { host, store } = openRecordStore({ path: ":memory:", space: "sp_1" });
  await store.define({ add_types: [CONTACT] });
  const id = mintRecordId();
  const w = writerOf({ principal: { id: "agt_simba" }, actingFor: "usr_olivia", trace: { traceId: TRACE }, run: "run_abc" })!;
  const made = await recordWriter.run(w, () => store.create("contact", id, { name: "Ada" }));
  await recordWriter.run(w, () => store.update("contact", id, { name: "Ada L" }, made.version));
  const evs = host.store.read({ after: 0, limit: 50 }).filter((e) => e.type.startsWith("record."));
  assert.equal(evs.length, 2);
  for (const e of evs) assert.deepEqual([e.actor, e.on_behalf, e.trace_id, e.run_id], ["agt_simba", "usr_olivia", TRACE, "run_abc"]);
  host.close();
});

test("a person's own write names the person, with no one acted for", async () => {
  const { host, store } = openRecordStore({ path: ":memory:", space: "sp_1" });
  await store.define({ add_types: [CONTACT] });
  await recordWriter.run(writerOf({ principal: { id: "usr_noah" }, trace: { traceId: TRACE } })!, () => store.create("contact", mintRecordId(), { name: "Bea" }));
  const e = host.store.read({ after: 0, limit: 50 }).find((x) => x.type === "record.created")!;
  assert.deepEqual([e.actor, e.on_behalf ?? null], ["usr_noah", null]);
  host.close();
});

test("with no call behind it, the store's own actor stands", async () => {
  const { host, store } = openRecordStore({ path: ":memory:", space: "sp_1" });
  await store.define({ add_types: [CONTACT] });
  await store.create("contact", mintRecordId(), { name: "Cal" });
  assert.equal(host.store.read({ after: 0, limit: 50 }).find((x) => x.type === "record.created")!.actor, "svc_records");
  host.close();
});
