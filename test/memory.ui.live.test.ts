// The memory UI's full path on a booted daemon (owner design 30 Oct 2026): a fact learned in a chat shows in the Learned feed with its source and in the facts of the person's page, Undo takes it
// off the page and into Trash, and Restore from Trash puts it back on the page. The Knowledge screens read exactly these capabilities (memory.learned, memory.page.get, memory.undo, memory.trash.search,
// memory.restore, memory.trail); the screens' own behaviour is proved over the sample Space in apps/app/src/places/files/tests.
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, close, connect, newAgent, say, seededDir, waitFor, hostLog } from "./memory-live-kit.ts";

type Fact = { factId: string; text: string; status: string };

test("memory UI live: a fact learned in chat is in Learned and on the person's page, is undone, and is restored from Trash", async () => {
  const d = await boot(seededDir());
  try {
    await connect(d);
    assert.equal((await call(d, "engine.pool.status", {})).status, 200);
    const keeper = await newAgent(d, "Keeper");

    // the person's page exists first, so the fact finds it by name
    const made = await call(d, "memory.page.put", { title: "Ian Brooks", kind: "client", layer: "agent", agentId: keeper.id, notes: "Client contact at Brooks Logistics." });
    assert.equal(made.status, 200, JSON.stringify(made.data));
    const pageId = made.data.page.pageId as string;

    const chat = await say(d, keeper.id, "I prefer that Ian Brooks gets his updates on Fridays.", "ui1");
    await close(d, chat.threadId);
    const item = await waitFor(async () => {
      await d.hooks?.pump?.();
      const feed = (await call(d, "memory.learned", {})).data.items as Array<{ fact: Fact; sourceKind: string; sourceLink?: string }>;
      return feed.find((i) => i.fact.text.includes("Ian Brooks")) ?? null;
    }, 20_000, () => hostLog(d));
    assert.equal(item.sourceKind, "chat");
    assert.equal(item.sourceLink, `/chats/${chat.threadId}`);
    const factId = item.fact.factId;

    const onPage = async (): Promise<boolean> => ((await call(d, "memory.page.get", { pageId })).data.facts as Fact[]).some((f) => f.factId === factId);
    assert.equal(await onPage(), true, "the fact is on Ian Brooks' page");

    const undone = await call(d, "memory.undo", { factId });
    assert.equal(undone.status, 200, JSON.stringify(undone.data));
    assert.equal(await onPage(), false, "undone, it leaves the page");
    const trash = (await call(d, "memory.trash.search", { q: "Ian Brooks" })).data.facts as Array<Fact & { trashReason?: string }>;
    assert.equal(trash.find((f) => f.factId === factId)?.trashReason, "undone");

    assert.equal((await call(d, "memory.restore", { factId })).status, 200);
    assert.equal(await onPage(), true, "restored from Trash, it is back on the page");
    const actions = ((await call(d, "memory.trail", { factId })).data.rows as Array<{ action: string }>).map((r) => r.action);
    assert.deepEqual(actions.slice(0, 2), ["restore", "undo"], JSON.stringify(actions));
  } finally { await d.stop(); }
});
