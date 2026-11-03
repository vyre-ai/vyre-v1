// Parallel lanes and loop iterations are child Runs. On a booted daemon, through the gateway: notes the lanes and the loop write, a lane that loses an any-join, a wait that does not block the other lane, and a parent stop that keeps the note after a child's wait from being written. Stopping a parent and retrying a failed loop or parallel step are in runs.children.retry.test.ts; both share runs-children-rig.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { seededDir, bootDaemon, until, note, parallel, automation, runOf, notes, countOf, succeed } from "./runs-children-rig.ts";

test("two parallel lanes write Left note and Right note, then Joined once exists exactly once", async () => {
  const d = await bootDaemon(seededDir(bootCore));
  try {
    const id = await automation(d, "split", {
      triggers: [{ key: "manual" }],
      start: ["par"],
      nodes: [
        parallel("par", "all", [{ label: "Left", to: "a1" }, { label: "Right", to: "b1" }], ["join"]),
        note("a1", "Left note", ["join"]),
        note("b1", "Right note", ["join"]),
        note("join", "Joined once"),
      ],
    });
    const runId = await runOf(d, id, "run-split");
    await succeed(d, runId, 20_000);
    assert.equal(await countOf(d, "Left note"), 1);
    assert.equal(await countOf(d, "Right note"), 1);
    assert.equal(await countOf(d, "Joined once"), 1);
  } finally { await d.stop(); }
});

test("waitFor any writes the fast note and leaves the slow note absent when the parent succeeds", async () => {
  const d = await bootDaemon(seededDir(bootCore));
  try {
    const id = await automation(d, "any", {
      triggers: [{ key: "manual" }],
      start: ["par"],
      nodes: [
        parallel("par", "any", [{ label: "Slow", to: "pause" }, { label: "Fast", to: "fast" }], ["join"]),
        { id: "pause", key: "wait", input: { forDuration: "30s" }, next: ["slow"] },
        note("slow", "Slow note", ["join"]),
        note("fast", "Fast note", ["join"]),
        note("join", "Joined any"),
      ],
    });
    const runId = await runOf(d, id, "run-any");
    await succeed(d, runId, 15_000);
    assert.equal(await countOf(d, "Fast note"), 1);
    assert.equal(await countOf(d, "Slow note"), 0);
    assert.equal(await countOf(d, "Joined any"), 1);
  } finally { await d.stop(); }
});

test("a loop of three items writes Ada, Bea and Cy, then one note after the loop", async () => {
  const d = await bootDaemon(seededDir(bootCore));
  try {
    const id = await automation(d, "each", {
      triggers: [{ key: "manual" }],
      start: ["each"],
      nodes: [
        {
          id: "each", key: "loop",
          input: { items: [{ id: "a", name: "Ada" }, { id: "b", name: "Bea" }, { id: "c", name: "Cy" }], concurrency: 2 },
          branches: [{ label: "body", to: "make" }], next: ["after"],
        },
        note("make", "{{ item.name }}"),
        note("after", "After the loop"),
      ],
    });
    const runId = await runOf(d, id, "run-each");
    await succeed(d, runId, 20_000);
    const titles = (await notes(d)).map((r) => r.fields.title);
    for (const title of ["Ada", "Bea", "Cy", "After the loop"]) assert.equal(titles.filter((t) => t === title).length, 1, titles.join(","));
    // records.query orders by created_at, then id. The three iteration titles keep input order in that list.
    assert.deepEqual(titles.filter((t) => t === "Ada" || t === "Bea" || t === "Cy"), ["Ada", "Bea", "Cy"]);
    assert.ok(titles.indexOf("After the loop") > titles.indexOf("Cy"));
  } finally { await d.stop(); }
});

test("a wait of 2s inside one parallel lane does not block the other lane's note, then the parent joins once", async () => {
  const d = await bootDaemon(seededDir(bootCore));
  try {
    const id = await automation(d, "lane-wait", {
      triggers: [{ key: "manual" }],
      start: ["par"],
      nodes: [
        parallel("par", "all", [{ label: "Left", to: "pause" }, { label: "Right", to: "right" }], ["join"]),
        { id: "pause", key: "wait", input: { forDuration: "2s" }, next: ["left"] },
        note("left", "Left after the wait", ["join"]),
        note("right", "Right during the wait", ["join"]),
        note("join", "Joined once"),
      ],
    });
    const runId = await runOf(d, id, "run-lane-wait");
    await until("the other lane's note before the wait lane writes", 8_000, async () => {
      const right = await countOf(d, "Right during the wait");
      const left = await countOf(d, "Left after the wait");
      if (left > 0) assert.fail("the wait lane wrote its note before the other lane was seen");
      return right === 1 ? true : undefined;
    });
    assert.equal(await countOf(d, "Joined once"), 0, "the parent has not joined while one lane is still waiting");
    await succeed(d, runId, 20_000);
    assert.equal(await countOf(d, "Left after the wait"), 1);
    assert.equal(await countOf(d, "Right during the wait"), 1);
    assert.equal(await countOf(d, "Joined once"), 1);
  } finally { await d.stop(); }
});
