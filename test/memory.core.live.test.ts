// Memory core on a booted daemon (owner design 30 Oct 2026): capture is auto by default and shows in the Learned feed with Undo; a Space can require review; delete goes to Trash and restores for a person
// and for an agent; untouched Trash moves to Archive after the Space period and an admin restores it; an erase leaves a contentless trail line.
// Chat, agents, engine, bridge, memory and the hook runner are live; the model vendor stand-in is in memory-live-kit.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { DAY, boot, call, clock, connect, newAgent, say, close, seededDir, waitFor, hostLog } from "./memory-live-kit.ts";
type Fact = { factId: string; text: string; status: string; sourceLink?: string; trashReason?: string };
const current = async (d: Daemon, agentId: string): Promise<Fact[]> => (await call(d, "memory.facts.list", { agentId, status: ["current"], fromMe: true })).data.facts ?? [];

test("memory core live: auto capture, Learned feed and Undo, Trash and restore (person and agent), Archive after the period, erase trail", async () => {
  const d = await boot(seededDir());
  try {
    await connect(d);
    assert.equal((await call(d, "engine.pool.status", {})).status, 200);
    const keeper = await newAgent(d, "Keeper");
    assert.equal(keeper.captureMode, "auto", "a new agent learns on its own by default");

    // chat 1: a preference and a note, neither of which the old low-risk rule would have saved alone
    const first = await say(d, keeper.id, "I prefer purple folders for client invoices. Remember that rent is due on the first.", "k1");
    await close(d, first.threadId);
    const saved = await waitFor(async () => { await d.hooks?.pump?.(); const f = await current(d, keeper.id); return f.length >= 2 ? f : null; }, 20_000, () => hostLog(d));
    assert.ok(saved.some((f) => f.text.includes("purple folders")) && saved.some((f) => f.text.includes("rent is due")), JSON.stringify(saved));

    // the Learned feed: each with its source and who learned it
    const feed = (await call(d, "memory.learned", {})).data;
    assert.ok(feed.items.length >= 2, JSON.stringify(feed));
    const purple = feed.items.find((i: { fact: Fact }) => i.fact.text.includes("purple folders"));
    assert.equal(purple.actor, keeper.id);
    assert.equal(purple.actorKind, "agent");
    assert.equal(purple.sourceKind, "chat");
    assert.equal(purple.sourceLink, `/chats/${first.threadId}`);
    assert.equal(purple.undone, false);

    // Undo: out of recall, still in the feed as undone, found in Trash, and restore brings it back
    const undone = await call(d, "memory.undo", { factId: purple.fact.factId });
    assert.equal(undone.status, 200, JSON.stringify(undone.data));
    assert.equal(undone.data.trashed, true);
    const gone = await say(d, keeper.id, "which folders do I prefer for client invoices?", "k2");
    // exact recall may still quote the person's own earlier words (the message is not a fact and Undo does not touch it); what must be gone is the fact
    const withoutQuotes = gone.reply.split("\n").filter((l: string) => !/^- Quote \[/.test(l)).join("\n");
    assert.doesNotMatch(withoutQuotes, /purple folders/, "an undone fact is not recalled");
    assert.equal((await call(d, "memory.trash.search", { q: "purple folders" })).data.facts[0]?.trashReason, "undone");
    assert.equal((await call(d, "memory.restore", { factId: purple.fact.factId })).status, 200);
    const back = await say(d, keeper.id, "which folders do I prefer for client invoices?", "k3");
    assert.match(back.reply, /purple folders/, "restored, it is recalled again");

    // delete the rent fact; an agent restores it through the tool, as itself
    const rent = saved.find((f) => f.text.includes("rent is due"))!;
    assert.equal((await call(d, "memory.facts.remove", { factIds: [rent.factId] })).data.removed, 1);
    assert.equal((await current(d, keeper.id)).some((f) => f.factId === rent.factId), false);
    const viaAgent = await say(d, keeper.id, `TOOL memory_restore ${JSON.stringify({ factId: rent.factId, idempotencyKey: "rs1" })}`, "k4");
    assert.match(viaAgent.reply, /TOOL RESULT ok/, viaAgent.reply);
    assert.equal((await current(d, keeper.id)).some((f) => f.factId === rent.factId), true, "the agent put it back");
    const trailRows = (await call(d, "memory.trail", { factId: rent.factId })).data.rows as Array<{ action: string; actorKind: string; actor: string }>;
    const restoreLine = trailRows.find((r) => r.action === "restore")!;
    assert.deepEqual([restoreLine.actorKind, restoreLine.actor], ["agent", keeper.id], JSON.stringify(trailRows));

    // delete again; 59 days later nothing moves; reading it starts the days again; 120 days on it is in Archive
    await call(d, "memory.facts.remove", { factIds: [rent.factId] });
    clock.t += 59 * DAY;
    assert.equal((await call(d, "memory.archive_sweep", {})).data.archived, 0);
    await call(d, "memory.fact.get", { factId: rent.factId });
    clock.t += 2 * DAY;
    assert.equal((await call(d, "memory.archive_sweep", {})).data.archived, 0, "touched at day 59");
    clock.t += 59 * DAY;
    assert.equal((await call(d, "memory.archive_sweep", {})).data.archived, 1);
    assert.equal((await call(d, "memory.trash.search", { q: "rent is due" })).data.facts.length, 0, "Archive is out of Trash search");
    const archived = (await call(d, "memory.trash.search", { q: "rent is due", area: "archive" })).data.facts;
    assert.equal(archived[0]?.factId, rent.factId);
    const restored = await call(d, "memory.restore", { factId: rent.factId });
    assert.equal(restored.data.restoredFrom, "archive");
    assert.equal((await current(d, keeper.id)).some((f) => f.factId === rent.factId), true);

    // an erase removes the content and leaves a contentless line
    assert.equal((await call(d, "memory.erase", { factIds: [rent.factId], reason: "asked by the person" })).data.erased, 1);
    assert.equal((await call(d, "memory.fact.get", { factId: rent.factId })).status, 404);
    const lines = (await call(d, "memory.trail", { factId: rent.factId })).data.rows as Array<Record<string, unknown>>;
    const erase = lines.find((l) => l["action"] === "erase")!;
    assert.equal(erase["reason"], "asked by the person");
    assert.ok(!JSON.stringify(lines).includes("rent is due"), "the trail holds no words");
    assert.deepEqual(lines.map((l) => l["action"]).sort(), ["archive", "delete", "delete", "erase", "learn", "restore", "restore"].sort());
  } finally { await d.stop(); }
});


test("memory core live: require review holds what an agent saves for the Space in Proposed", async () => {
  const d = await boot(seededDir());
  try {
    await connect(d);
    assert.equal((await call(d, "engine.pool.status", {})).status, 200);
    const keeper = await newAgent(d, "Keeper");
    const open = await say(d, keeper.id, `TOOL memory_propose ${JSON.stringify({ idempotencyKey: "r1", layer: "space", text: "The office closes at five on Fridays.", sourceKind: "manual", sourceRef: "ops" })}`, "r1");
    assert.match(open.reply, /TOOL RESULT ok/, open.reply);
    assert.match(open.reply, /"merged":true/, "review is off: the agent's fact is saved");
    const set = await call(d, "settings.set_space", { key: "memory.require_review", value: true, idempotencyKey: "mc-review" });
    assert.equal(set.status, 200, JSON.stringify(set.data));
    const held = await say(d, keeper.id, `TOOL memory_propose ${JSON.stringify({ idempotencyKey: "r2", layer: "space", text: "Invoices go out on the last Monday.", sourceKind: "manual", sourceRef: "ops" })}`, "r2");
    assert.match(held.reply, /TOOL RESULT ok/, held.reply);
    assert.match(held.reply, /"merged":false/, "review is on: it waits");
    const waiting = (await call(d, "memory.facts.list", { layer: "space", status: ["proposed"] })).data.facts as Fact[];
    assert.ok(waiting.some((f) => f.text.includes("last Monday")), JSON.stringify(waiting));
    const feed = (await call(d, "memory.learned", {})).data.items as Array<{ fact: Fact }>;
    assert.ok(feed.some((i) => i.fact.status === "proposed" && i.fact.text.includes("last Monday")), "a held fact is in the feed too");
  } finally { await d.stop(); }
});
