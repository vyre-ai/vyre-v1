// Rewind with two members on a booted daemon (review of 15 Nov): in a chat the owner and a member share with an agent, each person's turn works in that person's own folder. The second member cannot go back to the first
// one's turn, cannot fold the first one's messages through the direct call either, and sees the one line that names who went back.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootHour, invite, join } from "./support/member-hour.ts";
import type { Hour, Person } from "./support/member-hour.ts";
import { call, connect, makeAgent, waitFor } from "./support/live.ts";

const FAKE_CLI = fileURLToPath(new URL("../host/tests/fixtures/fake-cli-driver/fake-cli.mjs", import.meta.url));
const cli = { command: { claude: [process.execPath, FAKE_CLI, "claude"] }, programRead: [path.dirname(FAKE_CLI)] };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

let h: Hour;
let aina: Person;
let agentId = "";
let threadId = "";

const folders = (): string[] => {
  const out: string[] = [];
  const root = path.join(h.dir, "work");
  for (const p of fs.existsSync(root) ? fs.readdirSync(root) : [])
    for (const t of fs.readdirSync(path.join(root, p)))
      for (const a of fs.readdirSync(path.join(root, p, t))) out.push(path.join(root, p, t, a));
  return out;
};
const msgs = async (p: Person): Promise<Any[]> => (await p.call("chat.messages.list", { threadId })).messages as Any[];
async function ask(p: Person, body: string, key: string): Promise<void> {
  const before = (await msgs(p)).length;
  await p.call("chat.post", { threadId, body, mentions: [{ kind: "agent", id: agentId }], idempotencyKey: key });
  await waitFor(async () => {
    const m = await msgs(p);
    return m.length >= before + 2 && m.some((x) => x.author.kind === "agent" && x.threadSeq > before) ? true : null;
  }, 60_000);
}

before(async () => {
  h = await bootHour("rewind-members", { engineCli: cli, engineOpenSession: undefined });
  await connect(h.d);
  agentId = await makeAgent(h.d, "Writer");
  aina = h.person("Aina", "aina", "aina@firm.test", "aina horse battery staple 9");
  await join(h, aina, await invite(h, aina.email), { device: "web" });
  threadId = (await h.owner.call("chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: "rwm-start" }))
    .thread.threadId;
  await h.owner.call("threads.members.add", { threadId, personId: aina.personId });
});
after(async () => {
  await h.stop();
});

test(
  "a second member cannot go back to the first one's turn, nor fold the first one's messages by the direct call; the first sees and the second sees the one line that names who went back",
  { timeout: 240_000 },
  async () => {
    await ask(h.owner, "writefile a.txt owner-one", "rwm-o1");
    await ask(aina, "writefile b.txt aina-one", "rwm-a1");
    await ask(h.owner, "writefile a.txt owner-two", "rwm-o2");
    // a shared chat's agent works in ONE folder, the chat owner's, for every person's message: Aina has no points of her own
    const mine = await waitFor(async () => {
      const r = (await h.owner.call("engine.rewind.points", { threadId })) as Any;
      return r.points.length >= 2 ? r : null;
    }, 15_000).catch(async () => {
      throw new Error(
        `points: ${JSON.stringify(await h.owner.call("engine.rewind.points", { threadId }))} messages: ${JSON.stringify((await msgs(h.owner)).map((m) => [m.threadSeq, m.author.id.slice(0, 8), m.body.slice(0, 30)]))}`,
      );
    });
    const hers = (await aina.call("engine.rewind.points", { threadId })) as Any;
    assert.equal(hers.points.length, 0, "she has no points of her own: nothing of hers to go back to");
    const ownersFirst = mine.points.find((p: Any) => /owner-one/.test(p.after ?? ""))!; // may read "During" on a cold folder: a point finished after the agent began
    assert.ok(ownersFirst, JSON.stringify(mine.points));
    // Aina tries the owner's point, through the chat and straight to the engine: refused, nothing folded, nothing written
    for (const cap of ["chat.rewind", "engine.rewind.to"]) {
      const r = await aina.attempt(cap, {
        threadId,
        pointId: ownersFirst.pointId,
        afterSeq: 0,
        uptoSeq: 99,
        idempotencyKey: `rwm-x-${cap}`,
      });
      assert.equal(r.ok, false, `${cap} is refused for a point that is not hers`);
    }
    assert.equal(
      ((await h.owner.call("engine.rewind.points", { threadId })) as Any).active.length,
      0,
      "nothing was folded",
    );
    const sys = (await msgs(aina)).filter((m) => /^Went back/.test(m.body));
    assert.equal(sys.length, 0);
    // the owner goes back to her own first message
    await h.owner.call("chat.rewind", { threadId, pointId: ownersFirst.pointId, idempotencyKey: "rwm-go" });
    const line = (await msgs(aina)).find((m) => /^Went back/.test(m.body));
    assert.ok(line, "Aina sees one line that it happened");
    assert.match(JSON.stringify(line.blocks), /"by":"usr_/, "the line names who went back");
    const seen = ((await aina.call("engine.rewind.points", { threadId })) as Any).active;
    assert.equal(seen.length, 1, "she sees the range folded");
    assert.equal(seen[0].undoPointId, undefined, "she cannot undo the owner's rewind");
    const folded = ((await h.owner.call("engine.rewind.points", { threadId })) as Any).active[0];
    assert.ok(folded.undoPointId, "the owner can");
  },
);
