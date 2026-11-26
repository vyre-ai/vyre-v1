// Meier, rc.42 (26 Nov 2026): dv_event had 4,267 records and the owner saw 986. Records an older build wrote without ever announcing them (a sync stopped by an update) are no resource, so no one sees them. A start
// announces them: the owner's walk holds every record. Real server-role daemon, stopped, its record file changed as the old build left it, and started again by Hour.restart().
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { bootHour } from "./support/member-hour.ts";
import type { Hour } from "./support/member-hour.ts";

const sink: string[] = [];
let h: Hour;
before(async () => {
  h = await bootHour("announcerepair", {
    keepDir: true,
    seams: {
      webhookAllow: () => ["hooks.example.com"],
      postFetch: async (_url: string, init: { body: string }) => {
        sink.push(init.body);
        return { status: 200, headers: { get: () => null }, text: async () => "ok" };
      },
    },
  });
});
after(async () => {
  await h?.stop();
  if (h?.dir) fs.rmSync(h.dir, { recursive: true, force: true });
});

const spaceDb = (): string => {
  const walk = (d: string): string[] =>
    fs
      .readdirSync(d, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
  return walk(h.dir).find((f) => /space\.db$/.test(f))!;
};
const walkCount = async (): Promise<number> => {
  let n = 0;
  for (let cursor: string | undefined; ; ) {
    const page = (await h.owner.call("records.query", {
      type: "contact",
      limit: 500,
      ...(cursor ? { cursor } : {}),
    })) as {
      rows: unknown[];
      next?: string;
    };
    n += page.rows.length;
    cursor = page.next;
    if (!cursor) return n;
  }
};

test(
  "records an old build left with no announcement are announced at the start and the owner sees all of them",
  { timeout: 240_000 },
  async () => {
    await h.owner.call("records.bulk_upsert", {
      type: "contact",
      match: ["email"],
      createOnly: true,
      idempotencyKey: "ar-1",
      rows: Array.from({ length: 50 }, (_, i) => ({ name: `Kept ${i}`, email: `k${i}@ar.test` })),
    });
    assert.equal(await walkCount(), 50);
    // a webhook on records and a project that links a contact by a rule: neither may fire for a record the repair announces
    await h.owner.call("webhooks.create", {
      name: "All records",
      url: "https://hooks.example.com/all",
      eventTypes: ["record.*"],
      idempotencyKey: "ar-hook",
    });
    const project = (await h.owner.call("projects.create", { type: "project", title: "Repair watch" })) as {
      projectId: string;
    };
    await h.owner.call("projects.links.rules.set", {
      projectId: project.projectId,
      rules: [{ kind: "record_filter", recordType: "contact", field: "phone", equals: "+1 555 0100" }],
    });
    const linked = async (): Promise<string> =>
      JSON.stringify(await h.owner.call("projects.links.list", { projectId: project.projectId }));
    // an Automation that runs when a record is created: it must not run for the records the repair announces (a control record made afterwards proves it works)
    await h.owner.call("schema.apply", {
      idempotencyKey: "ar-log",
      ops: [
        {
          op: "type.create",
          type: "autolog",
          def: {
            title: "Log",
            plural: "Logs",
            icon: "table",
            titleField: "name",
            fields: [{ key: "name", type: "text", title: "Name" }],
          },
        },
      ],
    });
    const made = (await h.owner.call("automations.create", {
      idempotencyKey: "ar-aut",
      name: "On a new contact",
      definition: {
        triggers: [{ key: "record_change", filter: { type: "contact", op: "created" } }],
        nodes: [{ id: "log", key: "records.create", input: { type: "autolog", fields: { name: "fired" } } }],
      },
    })) as { automation: { id: string } };
    await h.owner.call("automations.set_enabled", { automationId: made.automation.id, enabled: true });
    const runs = async (): Promise<number> =>
      (
        (await h.owner.call("runs.list", {
          scope: "subject",
          subject: { type: "automation", id: made.automation.id },
          limit: 50,
        })) as { runs: unknown[] }
      ).runs.length;
    sink.length = 0;
    const LOST = 40;
    await h.restart(() => {
      // as the old build left it: rows in the record table, no event in either log, so no resource
      const db = new DatabaseSync(spaceDb());
      try {
        const at = Date.now() - 3_600_000;
        const one = db.prepare("SELECT data FROM rt_contact LIMIT 1").get() as { data: string };
        const ins = db.prepare(
          "INSERT INTO rt_contact (id, version, created_at, updated_at, deleted_at, data) VALUES (?, 1, ?, ?, NULL, ?)",
        );
        for (let i = 0; i < LOST; i++)
          ins.run(
            `rec_lost${String(i).padStart(4, "0")}`,
            at,
            at,
            JSON.stringify({
              ...JSON.parse(one.data.replace(/Kept \d+/, `Lost ${i}`).replace(/k\d+@/, `l${i}@`)),
              phone: "+1 555 0100",
            }),
          );
      } finally {
        db.close();
      }
    });
    let seen = 0;
    for (let t = 0; t < 15 && seen < 50 + LOST; t++) {
      seen = await walkCount();
      if (seen < 50 + LOST) await new Promise((r) => setTimeout(r, 1000));
    }
    assert.equal(seen, 50 + LOST, "the owner sees the records the old build left, and every other one");
    await new Promise((r) => setTimeout(r, 3000)); // the consumers have had their turn
    const listed = (await h.owner.call("runs.list", {
      scope: "subject",
      subject: { type: "automation", id: made.automation.id },
      limit: 50,
    })) as { runs: unknown[] };
    assert.equal(
      listed.runs.length,
      0,
      `no Automation ran for a record the repair announced: ${JSON.stringify(listed.runs).slice(0, 700)}`,
    );
    assert.ok(!sink.join("\n").includes("rec_lost"), "no webhook was sent for a record the repair announced");
    assert.ok(!(await linked()).includes("rec_lost"), "no project rule linked a record the repair announced");
    const control = (await h.owner.call("records.create", {
      idempotencyKey: "ar-ctl",
      type: "contact",
      fields: { name: "Control", email: "ctl@ar.test", phone: "+1 555 0100" },
    })) as { record: { id: string } };
    for (
      let t = 0;
      t < 15 && !(sink.join("\n").includes(control.record.id) && (await linked()).includes(control.record.id));
      t++
    )
      await new Promise((r) => setTimeout(r, 1000));
    assert.ok(sink.join("\n").includes(control.record.id), "the webhook does fire for a record made now");
    assert.ok((await linked()).includes(control.record.id), "the project rule does link a record made now");
    let fired = 0;
    for (let t = 0; t < 15 && fired === 0; t++) {
      fired = await runs();
      if (fired === 0) await new Promise((r) => setTimeout(r, 1000));
    }
    assert.ok(fired >= 1, "the Automation does run for a record made now");
  },
);
