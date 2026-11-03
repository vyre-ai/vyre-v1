// The Chrome cards of a chat through the real handlers: a card is cleaned and posted as text-less, mention-less chat.post; the buttons on it act only for the person whose Chrome it is.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { bindPersonalChrome } from "../../../lib/personal-chrome.ts";
import type { PersonalChrome } from "../../../lib/personal-chrome.ts";
import { world } from "../fixtures/world.ts";

const codeOf = (e: unknown): string | undefined => (e && typeof e === "object" && "error" in e ? (e as { error?: { code?: string } }).error?.code : undefined);
const failed = (p: Promise<unknown>): Promise<string | undefined> => p.then(() => undefined, (e: unknown) => codeOf(e) ?? String(e));

function port(o: { open?: boolean; sendThrows?: string } = {}) {
  const log: string[] = [];
  const sends: Array<Record<string, unknown>> = [];
  bindPersonalChrome({
    async available(a) { return o.open !== false && a.person === "usr_olivia"; },
    async call(a) { sends.push(a); if (o.sendThrows) throw Object.assign(new Error("gone"), { code: o.sendThrows }); return { sent: true }; },
    held: async () => null, frame: () => null,
    drop: (id) => log.push(`drop ${id}`), takeOver: (a) => log.push(`takeover ${a}`), watch: (a) => log.push(`watch ${a}`),
  } satisfies PersonalChrome);
  return { log, sends };
}

test("a card is cleaned to the page's own fields and posted with no text and no mention", async () => {
  const w = world();
  const r = await handlers["browser.cards.post"](w.as("agt_scout", "agent"), { threadId: "thr_1", idempotencyKey: "k1", block: { type: "chrome_held", data: { heldId: "hld_ab12", kind: "send", card: { to: "d@x.test", subject: "S", message: "M", password: "hunter2" }, extra: "x" } } });
  assert.deepEqual(r, { posted: true });
  const post = w.called("chat.post")[0]!.input as { body: string; mentions: unknown[]; blocks: Array<{ type: string; data: Record<string, any> }> };
  assert.deepEqual([post.body, post.mentions], ["", []]);
  assert.equal(post.blocks[0]!.type, "chrome_held");
  assert.ok(!JSON.stringify(post).includes("hunter2") && !JSON.stringify(post).includes("extra"));
  assert.equal(await failed(handlers["browser.cards.post"](w.as("agt_scout", "agent"), { threadId: "thr_1", idempotencyKey: "k2", block: { type: "chrome_held", data: { heldId: "../x" } } })), "validation.bad_input");
  assert.equal(await failed(handlers["browser.cards.post"](w.as("agt_scout", "agent"), { threadId: "thr_1", idempotencyKey: "k3", block: { type: "approval", data: {} } })), "validation.bad_input");
});

test("Send releases through chrome_send as the agent that held it, once: a second press says it was already done", async () => {
  const w = world();
  const p = port();
  try {
    assert.deepEqual(await handlers["browser.chrome.act"](w.as("usr_olivia"), { action: "send", agentId: "agt_scout", heldId: "hld_ab12", threadId: "thr_1", idempotencyKey: "a" }), { done: true });
    assert.deepEqual([p.sends[0]!["tool"], p.sends[0]!["args"], (p.sends[0]!["agent"] as { id: string }).id], ["chrome_send", { heldId: "hld_ab12" }, "agt_scout"]);
    port({ sendThrows: "held_gone" });
    assert.deepEqual(await handlers["browser.chrome.act"](w.as("usr_olivia"), { action: "send", agentId: "agt_scout", heldId: "hld_ab12", idempotencyKey: "b" }), { done: false, already: true });
  } finally { bindPersonalChrome(null); }
});

test("Don't send makes the extension forget it and tells the agent in the chat; Watch and Take over reach the agent's tab", async () => {
  const w = world();
  const p = port();
  try {
    await handlers["browser.chrome.act"](w.as("usr_olivia"), { action: "drop", agentId: "agt_scout", heldId: "hld_ab12", threadId: "thr_1", summary: "send: Send on mail.test", idempotencyKey: "c" });
    const said = w.called("chat.post")[0]!.input as { body: string; threadId: string };
    assert.match(said.body, /Don't send that\./);
    assert.equal(said.threadId, "thr_1");
    await handlers["browser.chrome.act"](w.as("usr_olivia"), { action: "watch", agentId: "agt_scout", idempotencyKey: "d" });
    await handlers["browser.chrome.act"](w.as("usr_olivia"), { action: "takeover", agentId: "agt_scout", idempotencyKey: "e" });
    assert.deepEqual(p.log, ["drop hld_ab12", "watch agt_scout", "takeover agt_scout"]);
  } finally { bindPersonalChrome(null); }
});

test("only the person whose Chrome it is: an agent, another person, and a Chrome not open to agents are refused", async () => {
  const w = world();
  try {
    port();
    assert.equal(await failed(handlers["browser.chrome.act"](w.as("agt_scout", "agent", "usr_olivia"), { action: "send", agentId: "agt_scout", heldId: "hld_ab12", idempotencyKey: "f" })), "permission.no_grant");
    assert.equal(await failed(handlers["browser.chrome.act"](w.as("usr_noah"), { action: "send", agentId: "agt_scout", heldId: "hld_ab12", idempotencyKey: "g" })), "provider.unavailable");
    port({ open: false });
    assert.equal(await failed(handlers["browser.chrome.act"](w.as("usr_olivia"), { action: "watch", agentId: "agt_scout", idempotencyKey: "h" })), "provider.unavailable");
    bindPersonalChrome(null);
    assert.equal(await failed(handlers["browser.chrome.act"](w.as("usr_olivia"), { action: "watch", agentId: "agt_scout", idempotencyKey: "i" })), "provider.unavailable", "no daemon with the extension here");
  } finally { bindPersonalChrome(null); }
});
