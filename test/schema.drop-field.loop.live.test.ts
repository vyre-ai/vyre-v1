// Dropping a field that holds a value on a Meier-sized type (9,500 records) must not hold the event loop: the apply patches each row and the search entries of those rows leave the index in slices of 200 with the loop
// given back between slices. The longest stretch the loop went without running a 2 ms timer is measured during the apply, and must stay under 100 ms. Real server-role daemon.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour } from "./support/member-hour.ts";
import type { Hour } from "./support/member-hour.ts";

const N = 9_500;
let h: Hour;
before(async () => {
  h = await bootHour("dropfieldloop");
});
after(async () => {
  await h?.stop();
});

/** The longest time the loop went without running a 2 ms timer. */
function watchLoop(): { stop(): Promise<number> } {
  let last = performance.now(),
    max = 0;
  const t = setInterval(() => {
    const at = performance.now();
    max = Math.max(max, at - last - 2);
    last = at;
  }, 2);
  return {
    stop: async () => {
      await new Promise<void>((r) => setTimeout(r, 10));
      clearInterval(t);
      return Math.round(max);
    },
  };
}

test("dropping a field that holds a value on 9,500 records holds the loop for under 100 ms at a stretch, and takes the search text of every record out", async () => {
  const type = "matter9500";
  await h.owner.call("schema.apply", {
    idempotencyKey: "dfl-type",
    ops: [
      {
        op: "type.create",
        type,
        def: {
          title: "Matter",
          plural: "Matters",
          icon: "table",
          titleField: "name",
          fields: ["name", "note"].map((key) => ({ key, type: "text", title: key })),
        },
      },
    ],
  });
  for (let at = 0; at < N; at += 500) {
    await h.owner.call("records.bulk_upsert", {
      idempotencyKey: `dfl-rows-${at}`,
      type,
      match: ["name"],
      createOnly: true,
      runAutomations: false,
      rows: Array.from({ length: 500 }, (_, i) => ({ name: `Matter ${at + i}`, note: `zqnote${at + i} tagged` })),
    });
  }
  // the index folds all of it first, so the drop has 9,500 search entries to take out
  for (let i = 0; i < 60; i++) {
    await h.d.hooks?.pump?.();
    const hit = (await h.owner.call("search.query", { q: "zqnote9499" })) as { hits: unknown[] };
    if (hit.hits.length) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const before = (await h.owner.call("search.query", { q: "zqnote9499" })) as { hits: unknown[] };
  assert.ok(
    JSON.stringify(before.hits).includes("zqnote9499"),
    "control: the index holds the note text before the drop",
  );

  const diff = (await h.owner.call("schema.diff", { ops: [{ op: "field.drop", type, field: "note" }] })) as {
    previewToken: string;
    items: Array<{ itemKey: string; destructive: boolean }>;
  };
  const watch = watchLoop();
  const t0 = performance.now();
  await h.owner.call("schema.apply", {
    idempotencyKey: "dfl-drop",
    ops: [{ op: "field.drop", type, field: "note" }],
    previewToken: diff.previewToken,
    confirm: diff.items.filter((i) => i.destructive).map((i) => i.itemKey),
  });
  const took = Math.round(performance.now() - t0);
  const longest = await watch.stop();
  console.log(`drop of a field on ${N} records: apply took ${took} ms, longest loop block ${longest} ms`);
  const gone = (await h.owner.call("search.query", { q: "zqnote9499" })) as { hits: unknown[] };
  assert.equal(
    JSON.stringify(gone.hits).includes("zqnote"),
    false,
    `the dropped text is no longer found: ${JSON.stringify(gone.hits).slice(0, 400)}`,
  );
  assert.ok(longest < 100, `the longest stretch the loop was held during the drop was ${longest} ms (limit 100)`);
});

test("with the index consumer running normally, dropping a field leaves every record findable by another field and shows no text of the dropped one", async () => {
  const type = "matter300";
  const M = 300;
  await h.owner.call("schema.apply", {
    idempotencyKey: "dfn-type",
    ops: [
      {
        op: "type.create",
        type,
        def: {
          title: "Unit",
          plural: "Units",
          icon: "table",
          titleField: "name",
          fields: ["name", "note"].map((key) => ({ key, type: "text", title: key })),
        },
      },
    ],
  });
  await h.owner.call("records.bulk_upsert", {
    idempotencyKey: "dfn-rows",
    type,
    match: ["name"],
    createOnly: true,
    runAutomations: false,
    rows: Array.from({ length: M }, (_, i) => ({ name: `Unitx${i}x`, note: `zqnorm${i} tagged` })),
  });
  for (let i = 0; i < 60; i++) {
    await h.d.hooks?.pump?.();
    const hit = (await h.owner.call("search.query", { q: "zqnorm299" })) as { hits: unknown[] };
    if (hit.hits.length) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(
    ((await h.owner.call("search.query", { q: "zqnorm299" })) as { hits: unknown[] }).hits.length >= 1,
    "control: the index holds the note text before the drop",
  );
  const findAll = async (): Promise<Set<string>> => {
    const found = new Set<string>();
    let cursor: string | undefined;
    for (let i = 0; i < 20; i++) {
      const out = (await h.owner.call("search.query", {
        q: "Unitx",
        recordType: type,
        limit: 100,
        ...(cursor ? { cursor } : {}),
      })) as { hits: Array<{ id: string }>; next?: string };
      for (const hit of out.hits) found.add(hit.id);
      cursor = out.next;
      if (!cursor) break;
    }
    return found;
  };
  for (let i = 0; i < 40 && (await findAll()).size < M; i++) {
    await h.d.hooks?.pump?.();
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.equal((await findAll()).size, M, "control: before the drop search finds every record by its name");
  const ids = ((await h.owner.call("records.query", { type, limit: 500 })) as { rows: Array<{ id: string }> }).rows.map(
    (r) => r.id,
  );
  assert.equal(ids.length, M);
  const diff = (await h.owner.call("schema.diff", { ops: [{ op: "field.drop", type, field: "note" }] })) as {
    previewToken: string;
    items: Array<{ itemKey: string; destructive: boolean }>;
  };
  await h.owner.call("schema.apply", {
    idempotencyKey: "dfn-drop",
    ops: [{ op: "field.drop", type, field: "note" }],
    previewToken: diff.previewToken,
    confirm: diff.items.filter((i) => i.destructive).map((i) => i.itemKey),
  });
  // the consumer goes quiet: pump until the cursor stops moving, a few rounds
  const progress: number[] = [];
  for (let i = 0; i < 40; i++) {
    await h.d.hooks?.pump?.();
    await new Promise((r) => setTimeout(r, 500));
    progress.push((await findAll()).size);
    if (progress.length > 3 && progress.slice(-3).every((n) => n === progress.at(-1))) break;
  }
  console.log(`found by name after the drop, every 0.5 s: ${progress.join(",")}`);
  const found = await findAll();
  const missing = ids.filter((id) => !found.has(id));
  assert.equal(missing.length, 0, `${missing.length} of ${M} records are missing from search after the drop`);
  const text = JSON.stringify(await h.owner.call("search.query", { q: "zqnorm1" }));
  assert.equal(text.includes("zqnorm"), false, "no text of the dropped field is found");
});
