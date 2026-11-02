// Group setup checks a usable account first: the person an agent could not answer is named once, in one line, and nobody else is.
import test from "node:test";
import assert from "node:assert/strict";
import { NO_ACCOUNT_LINE, checkGroupAccount } from "../group-account.ts";
import type { AgentPost } from "../handlers/bridge.ts";

function world(o: { members?: string[]; agents?: string[]; usable?: (agentId: string, person: string) => boolean; failResolve?: boolean } = {}) {
  const posts: Array<{ agentId: string; post: AgentPost }> = [];
  const call = async (cap: string, input: unknown, as?: string): Promise<unknown> => {
    const i = input as { agentId: string; askerId: string };
    if (cap === "engine.account.resolve") assert.equal(as, i.askerId, "asked as the person: the host's own service cannot see an agent");
    if (cap === "threads.get") return { thread: { starter: "usr_dana", members: (o.members ?? ["usr_dana", "usr_sara"]).map((id) => ({ kind: "person", id })), agents: (o.agents ?? ["agt_a"]).map((agentId) => ({ agentId })) } };
    if (cap === "access.principals.list") return { principals: [{ id: "usr_sara", name: "Sara Khan" }] };
    if (cap === "engine.account.resolve") {
      if (o.failResolve) throw new Error("no answer");
      return (o.usable ?? ((_a, p) => p === "usr_dana"))(i.agentId, i.askerId) ? { allowed: true, accountRef: "#Key" } : { allowed: false, accountRef: null };
    }
    throw new Error(`unexpected ${cap}`);
  };
  return { posts, d: { call, postAs: async (agentId: string, post: AgentPost) => { posts.push({ agentId, post }); return {}; } } };
}
const lineOf = (p: AgentPost): unknown => (p.blocks[0] as { data: { text: string } }).data.text;

test("a person who joins a group no agent could answer for is named in one line", async () => {
  const w = world();
  assert.deepEqual(await checkGroupAccount(w.d, "thr_1", ["usr_sara"]), ["usr_sara"]);
  assert.equal(w.posts.length, 1);
  assert.equal(lineOf(w.posts[0]!.post), NO_ACCOUNT_LINE("Sara"));
  assert.match(w.posts[0]!.post.clientId, /^msg_brg[0-9a-z]+$/, "a bridge id, so the line starts no turn");
});

test("the line has one id per person and chat, so a replay says it once", async () => {
  const w = world();
  await checkGroupAccount(w.d, "thr_1", ["usr_sara"]);
  await checkGroupAccount(w.d, "thr_1", ["usr_sara"]);
  assert.equal(w.posts[0]!.post.clientId, w.posts[1]!.post.clientId);
});

test("one agent that can run is enough: a shared key on it, or a person's own account", async () => {
  const w = world({ agents: ["agt_a", "agt_b"], usable: (a) => a === "agt_b" });
  assert.deepEqual(await checkGroupAccount(w.d, "thr_1", ["usr_sara"]), []);
  assert.equal(w.posts.length, 0);
});

test("an agent joining checks everyone in the group", async () => {
  const w = world({ members: ["usr_dana", "usr_sara", "usr_leo"] });
  assert.deepEqual(await checkGroupAccount(w.d, "thr_1"), ["usr_sara", "usr_leo"]);
});

test("no line where there is no group, no agent, or no answer: a false warning is worse than none", async () => {
  for (const o of [{ members: ["usr_sara"] }, { agents: [] }, { failResolve: true }]) {
    const w = world(o);
    assert.deepEqual(await checkGroupAccount(w.d, "thr_1", ["usr_sara"]), []);
    assert.equal(w.posts.length, 0);
  }
});
