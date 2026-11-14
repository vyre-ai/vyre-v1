// chats.presence: the sidebar's dots and rings from devices.presence and engine.now, as the asker.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../handlers/index.ts";
import { contractErrors, harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: any, input: any) => Promise<any>>; // eslint-disable-line @typescript-eslint/no-explicit-any

test("online and away people, and the agents working, with offline people left out", async () => {
  const hn = harness({
    calls: {
      "devices.presence": () => ({
        people: [
          { personId: "usr_a", state: "online" },
          { personId: "usr_b", state: "away", awayUntil: 5 },
          { personId: "usr_c", state: "offline", lastSeenAt: 1 },
        ],
      }),
      "engine.now": () => ({
        working: [
          { agentId: "agt_1", forPerson: "usr_a", where: "space", since: 10, threadId: "thr_x", title: "Secret title" },
          { agentId: "agt_2", forPerson: "usr_b", where: "computer", since: 20 },
        ],
      }),
    },
  });
  const out = await h["chats.presence"]!(hn.ctx, {});
  assert.deepEqual(contractErrors("chats.presence", "out", out), []);
  assert.deepEqual(out.people, [
    { personId: "usr_a", state: "online" },
    { personId: "usr_b", state: "away" },
  ]);
  assert.deepEqual(out.working, [
    { agentId: "agt_1", threadId: "thr_x", since: 10 },
    { agentId: "agt_2", since: 20 },
  ]);
  assert.ok(!JSON.stringify(out).includes("Secret title"), "no title leaves this read");
});

test("what the neighbours refuse or fail to answer leaves that half empty, and the read still answers", async () => {
  const hn = harness({
    calls: {
      "devices.presence": () => {
        throw new Error("not for a guest");
      },
      "engine.now": () => ({ working: [{ agentId: "agt_1", forPerson: "usr_a", where: "space", since: 3 }] }),
    },
  });
  const out = await h["chats.presence"]!(hn.ctx, {});
  assert.deepEqual(out.people, []);
  assert.equal(out.working.length, 1);
  const none = await h["chats.presence"]!(harness().ctx, {});
  assert.deepEqual(none, { people: [], working: [] });
});
