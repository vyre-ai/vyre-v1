// F51 for the engine's own subagents (finding from reviewer r-asker): in a shared channel the owner asks an agent, which starts two subagents of its own (the blocks the CLI driver yields, through the real bridge and
// the real engine). The person asked sees the whole row; the second member sees that two helpers ran, their state and clock, and never a task line, a step or an answer: not in engine.crew.status, not in the
// reply's saved blocks, not in any live frame their socket gets. The mutant "skip the asker check" is run by hand and must fail this file (see the commit message).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { bootHour, twoMembers, waitFor } from "./support/member-hour.ts";
import type { Hour, Person } from "./support/member-hour.ts";

let h: Hour;
let b: Person;
before(async () => {
  h = await bootHour("subreach");
  ({ b } = await twoMembers(h));
});
after(async () => {
  await h?.stop();
});

/** A person's live socket, collecting every frame their device is sent. */
async function listen(p: Person): Promise<{ frames: string[]; close(): void }> {
  const frames: string[] = [];
  const ws = new WebSocket(`${h.d.url.replace(/^http/, "ws")}/sync/v1/ws`, {
    headers: { authorization: `Bearer ${p.token}` },
  } as never);
  ws.addEventListener("message", (m) => frames.push(String(m.data)));
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new Error("could not connect")));
  });
  ws.send(
    JSON.stringify({
      t: "hello",
      hello: {
        deviceId: `dev_${p.personId}`,
        deviceClass: "web",
        appVersion: "1.2.3",
        registryHash: "unknown",
        cursor: 0,
        epoch: 0,
        replica: { entities: {} },
      },
    }),
  );
  await new Promise((r) => setTimeout(r, 400));
  return { frames, close: () => ws.close() };
}

const SECRETS = /SECRETLEASE|ANSWERSECRET|lease-2026|harbor invoice|Reading/i;
type Member = {
  kind: string;
  title: string;
  state: string;
  step?: string;
  steps?: string[];
  found?: string;
  answer?: string;
};

test("the asker reads the whole subagent row; another member of the channel reads that helpers ran, and nothing they said", async () => {
  // a group chat: the owner's chat with the agent, with Bilal added
  const threadId = (await h.owner.call("chat.start", { kind: "chat", agentIds: [h.agentId] })).thread
    .threadId as string;
  await h.owner.call("threads.members.add", { threadId, personId: b.personId });
  // b's live frames: what the socket of the second member is sent while the turn runs
  const theirSocket = await listen(b);
  const asker = await listen(h.owner);
  await h.owner.call("chat.post", {
    threadId,
    body: "two subagents please",
    mentions: [{ kind: "agent", id: h.agentId }],
  });
  const crew = async (p: Person): Promise<Member[]> =>
    (await p.call("engine.crew.status", { threadId })).members as Member[];
  const mine = await waitFor(
    async () => {
      const m = await crew(h.owner);
      return m.filter((x) => x.kind === "subagent").length === 2 ? m : null;
    },
    15_000,
    "both rows",
  );
  const done = await waitFor(
    async () => {
      const m = await crew(h.owner);
      return m.every((x) => x.state === "done") ? m : null;
    },
    20_000,
    "both done",
  );
  assert.deepEqual(done.map((m) => m.title).sort(), ["Check the harbor invoice", "Read the SECRETLEASE file"]);
  assert.match(done.map((m) => m.answer ?? "").join(" "), /ANSWERSECRET/, "the asker reads the answer");
  assert.ok(mine.length === 2);

  // one source for "who asked": the turn's recorded asker is the person who wrote, and the subagent rows carry exactly it (the chat's askedBy is filled from the same turn asker at post time)
  const mdb = new DatabaseSync(h.d.paths.modules, { readOnly: true });
  try {
    const turnAskers = (
      mdb.prepare("SELECT DISTINCT asker FROM engine_turns WHERE thread_id = ?").all(threadId) as Array<{
        asker: string;
      }>
    ).map((r) => r.asker);
    const rowAskers = (
      mdb.prepare("SELECT DISTINCT asker FROM engine_own_subagent WHERE thread_id = ?").all(threadId) as Array<{
        asker: string;
      }>
    ).map((r) => r.asker);
    assert.deepEqual(turnAskers, [h.owner.personId], "the turn was asked by the owner");
    assert.deepEqual(rowAskers, turnAskers, "the rows carry the turn's recorded asker, no other");
  } finally {
    mdb.close();
  }

  const theirs = await crew(b);
  assert.deepEqual(
    theirs.map((m) => [m.kind, m.title, m.state]),
    [
      ["subagent", "Helper 1", "done"],
      ["subagent", "Helper 2", "done"],
    ],
  );
  assert.doesNotMatch(JSON.stringify(theirs), SECRETS, "the second member's read carries no task line, step or answer");
  // the saved reply is read by everyone: the Agent calls are in it, their task lines and answers are not
  const msgs = (await b.call("chat.messages.list", { threadId })).messages as Array<{
    body: string;
    blocks?: unknown[];
  }>;
  assert.doesNotMatch(JSON.stringify(msgs), SECRETS, "the saved reply carries no task line or answer");
  theirSocket.close();
  asker.close();
  const turnFrames = (f: string[]): string => f.filter((x) => x.includes('"t":"turn"')).join("\n");
  assert.match(turnFrames(asker.frames), /SECRETLEASE/, "the asker's own live frames carry the task line");
  assert.ok(turnFrames(theirSocket.frames).includes("Agent"), "the second member does get the turn's frames");
  assert.doesNotMatch(
    theirSocket.frames.join("\n"),
    SECRETS,
    "no live frame to the second member carries a task line, step or answer",
  );
});
