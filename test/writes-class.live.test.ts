// F50 (14 Nov 2026), the class: for every thing that counts its saves and an agent can change through a tool, two writes made on one version at the same moment give one that lands and one that is refused, on a booted daemon.
// (Each takes the version through the tool layer for an agent: agent/tests/tools.versions.test.ts.) The kit is test/memory-live-kit.ts.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { boot, call, connect, seededDir } from "./memory-live-kit.ts";

let k = 0;
const c = (d: Parameters<typeof call>[0], cap: string, input: Record<string, unknown>) =>
  call(d, cap, { idempotencyKey: `wc-${cap}-${++k}`, ...input });

test("records, tasks, notes, memory pages and automations: two writes on one version at once, one lands and one is refused", async () => {
  const dir = seededDir();
  const d = await boot(dir);
  const seen: Record<string, number[]> = {};
  try {
    await connect(d);
    const both = async (label: string, mk: (who: string) => Promise<{ status: number; data: any }>) => {
      // eslint-disable-line @typescript-eslint/no-explicit-any
      const rs = await Promise.all([mk("ANN"), mk("BOB")]);
      seen[label] = rs.map((r) => r.status).sort();
      console.log(
        `MEASURE ${label}: ${seen[label]!.join(",")} ${JSON.stringify(rs.find((r) => r.status !== 200)?.data ?? "").slice(0, 160)}`,
      );
      return rs;
    };
    // records
    const rec = (await c(d, "records.create", { type: "contact", fields: { name: "Dana Fox" } })).data.record;
    const r1 = await both("records.update baseVersion=" + rec.version, (who) =>
      c(d, "records.update", { type: "contact", recordId: rec.id, patch: { name: who }, baseVersion: rec.version }),
    );
    assert.equal(r1.filter((r) => r.status === 200).length, 1, "records: exactly one lands");
    // tasks
    const task = (
      await c(d, "tasks.create", { title: "Shared", summary: "o", assigned: { kind: "person", id: "usr_olivia" } })
    ).data.task;
    const t1 = await both("tasks.update expectedVersion=" + task.version, (who) =>
      c(d, "tasks.update", { taskId: task.id, summary: who, expectedVersion: task.version ?? 0 }),
    );
    assert.equal(t1.filter((r) => r.status === 200).length, 1, "tasks: exactly one lands");
    // notes
    const note = (await c(d, "notes.create", { body: "o" })).data.note;
    const n1 = await both("notes.update expectedVersion=" + note.version, (who) =>
      c(d, "notes.update", { noteId: note.noteId, body: who, expectedVersion: note.version }),
    );
    assert.equal(n1.filter((r) => r.status === 200).length, 1, "notes: exactly one lands");
    // memory pages
    const page = (await c(d, "memory.page.put", { title: "Shared page", kind: "topic", layer: "space", notes: "o" }))
      .data.page;
    const p1 = await both("memory.page.put baseVersion=" + page?.version, (who) =>
      c(d, "memory.page.put", { pageId: page.pageId, notes: who, baseVersion: page.version }),
    );
    assert.equal(p1.filter((r) => r.status === 200).length, 1, "pages: exactly one lands");
    // automations
    const def = (n: string) => ({
      triggers: [{ key: "record_change", config: {}, filter: { type: "contact", op: "created" } }],
      nodes: [{ id: "more", key: "records.create", title: n, input: { type: "contact", fields: { name: n } } }],
    });
    const auto = (await c(d, "automations.create", { name: "Flow", definition: def("o") })).data.automation;
    const a1 = await both("automations.update expectedVersion=" + auto.version, (who) =>
      c(d, "automations.update", { automationId: auto.id, definition: def(who), expectedVersion: auto.version }),
    );
    assert.equal(a1.filter((r) => r.status === 200).length, 1, "automations: exactly one lands");
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
