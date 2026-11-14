// F52: private chats and private agents in search. The Space's own service is never allowed into a person's private chat, which is how the index stays free of it; the test proves what a person has and loses
// today, and that nobody who cannot open the chat finds its words: the owner of the chat finds them (chat.search, as that person), another member and the Space's owner do not (chat.search, search.query).
// The service's own refusals are not repeated on every turn of the chat. (A guest cannot be made in this rig; a guest has no more reach than a member here, and is the same check as the second member.)
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour, say, twoMembers, waitFor } from "./support/member-hour.ts";
import type { Hour, Person } from "./support/member-hour.ts";

let h: Hour;
let a: Person;
let b: Person;
before(async () => {
  h = await bootHour("searchpriv");
  ({ a, b } = await twoMembers(h));
});
after(async () => {
  await h?.stop();
});

const hits = async (p: Person, cap: "chat.search" | "search.query", q: string): Promise<number> =>
  ((await p.call(cap, { q })).hits as unknown[]).length;

test("a private chat's words are found by its person alone, and the service is not refused on each turn", async () => {
  const threadId = (await a.call("chat.start", { kind: "chat", agentIds: [h.agentId] })).thread.threadId as string;
  const refusalsOf = (): number => {
    h.d.sink.flush();
    return (
      h.d.sink.db
        .prepare(
          "SELECT attrs FROM logs WHERE msg = 'invoke' AND cap IN ('threads.get', 'agents.get') AND attrs LIKE '%svc_host%' AND attrs NOT LIKE '%\"status\":\"ok\"%'",
        )
        .all() as unknown[]
    ).length;
  };
  for (const n of [1, 2, 3, 4]) await say(h, a, threadId, `zebrafoxtrot${n}`);
  await new Promise((r) => setTimeout(r, 2500));
  const mine = await waitFor(
    async () => ((await hits(a, "chat.search", "zebrafoxtrot1")) > 0 ? true : null),
    15_000,
    "Aina finds her own words",
  );
  assert.ok(mine);
  for (const p of [b, h.owner]) {
    assert.equal(await hits(p, "chat.search", "zebrafoxtrot1"), 0, `${p.label} does not find them in chat search`);
    assert.equal(await hits(p, "search.query", "zebrafoxtrot1"), 0, `${p.label} does not find them in search`);
  }
  assert.equal(
    await hits(a, "search.query", "zebrafoxtrot1"),
    1,
    "Aina finds her private chat in search (the command bar), once",
  );
  assert.ok(refusalsOf() <= 2, `the service was refused ${refusalsOf()} times over four turns of one private chat`);
});

test("a person finds the agents they can see by name, and no one else's private ones: a Space agent by every member, an Assistant by its person alone", async () => {
  const agentId = (await h.owner.call("agents.create", { name: "Quillfeather", role: "Reads the harbor leases." }))
    .agent.agentId as string;
  const titles = async (p: Person, q: string): Promise<string[]> =>
    ((await p.call("search.query", { q })).hits as Array<{ kind: string; id: string; title: string }>)
      .filter((x) => x.kind === "agent")
      .map((x) => x.title);
  // an agent shared with the whole Space (made so by default) is found by every member, once
  for (const p of [h.owner, a, b])
    assert.deepEqual(await titles(p, "quillfeather"), ["Quillfeather"], `${p.label} finds the Space agent once`);
  assert.deepEqual(await titles(h.owner, "reads the harbor"), ["Quillfeather"], "and by its role");
  // an Assistant is private to its person (the service may not read it, so it is never in the shared index): found by its person, by no one else
  const mine = await titles(h.owner, "assistant");
  const bilals = await titles(b, "assistant");
  assert.equal(mine.length, 1, `the owner finds their own Assistant: ${JSON.stringify(mine)}`);
  assert.equal(bilals.length, 1, `Bilal finds his own Assistant: ${JSON.stringify(bilals)}`);
  assert.notDeepEqual(mine, bilals, "and not each other's");
  assert.ok(!bilals.some((t) => mine.includes(t)), "Bilal does not find the owner's Assistant");
  assert.ok(!mine.some((t) => bilals.includes(t)), "the owner does not find Bilal's");
  assert.ok(agentId);
});
