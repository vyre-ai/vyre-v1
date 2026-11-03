// An agent with no computer of its own working in the person's own Chrome (Chrome step 2): the Chrome tools run there when the person signed in to that Chrome is the one the agent works for, in the
// Space they picked, and has opened it to agents; never for another person's agent, never for an agent that has a computer and did not ask. A held item and the first picture leave their cards in the chat.
import test from "node:test";
import assert from "node:assert/strict";
import { bindPersonalChrome } from "../projections.ts";
import type { PersonalChrome } from "../projections.ts";
import { asPerson, codeOf, DANA, harness, OMAR } from "../fixtures/harness.ts";
import { tool } from "./tools.fixture.ts";

const THUMB = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
function port(o: { person?: string; open?: boolean; answers?: Record<string, Record<string, unknown>> } = {}) {
  const calls: Array<{ tool: string; args: Record<string, unknown>; agent: { id: string }; space: string; thread?: string }> = [];
  const p: PersonalChrome = {
    async available(a) { return o.open !== false && a.person === (o.person ?? DANA); },
    async call(a) { calls.push(a); return o.answers?.[a.tool] ?? { ok: true }; },
    held: async (id) => (id === "hld_ab12" ? { site: "mail.test", kind: "send", summary: "send: Send on mail.test", card: { to: "dana@client.test", subject: "Deed", message: "Hi" } } : null),
    frame: () => ({ site: "mail.test", thumb: THUMB }),
    plan: () => ({ goal: "Draft the email", steps: ["Opened Contacts", "Drafted the email"], done: 2 }), drop() {}, takeOver() {}, watch() {},
  };
  bindPersonalChrome(p);
  return calls;
}
const agentFor = (person: string, thread?: string) => {
  const h = harness({ principal: { kind: "agent", id: "agt_scout" }, actingFor: person, respond: { "browser.cards.post": () => ({ posted: true }) } });
  if (thread) h.ctx.thread = thread;
  return h;
};

test("an agent without a computer works in its person's Chrome, and what the extension answers is what the tool answers", async () => {
  const calls = port({ answers: { chrome_snapshot: { url: "https://mail.test/", title: "Mail", tree: "- page [e1]", truncated: false } } });
  try {
    const h = agentFor(DANA);
    const out = await tool["computers.chrome.snapshot"]!(h.ctx, {});
    assert.equal(out.title, "Mail");
    assert.deepEqual([calls[0]!.tool, calls[0]!.agent.id, calls[0]!.space], ["chrome_snapshot", "agt_scout", "spc_computerstest"]);
    assert.equal((await tool["computers.chrome.snapshot"]!(h.ctx, { computerId: "my-chrome" })).title, "Mail", "or by name");
  } finally { bindPersonalChrome(null); }
});

test("only for the person signed in to that Chrome: another person's agent, a Chrome not opened to agents, and a person calling are refused", async () => {
  try {
    port();
    await assert.rejects(() => tool["computers.chrome.snapshot"]!(agentFor(OMAR).ctx, { computerId: "my-chrome" }), (e) => codeOf(e) === "provider.unavailable");
    port({ open: false });
    await assert.rejects(() => tool["computers.chrome.snapshot"]!(agentFor(DANA).ctx, { computerId: "my-chrome" }), (e) => codeOf(e) === "provider.unavailable");
    await assert.rejects(() => tool["computers.chrome.snapshot"]!(agentFor(DANA).ctx, {}), (e) => codeOf(e) === "validation.not_found", "unasked, it is the old answer: no computer");
    port();
    await assert.rejects(() => tool["computers.chrome.snapshot"]!(harness().ctx, { computerId: "my-chrome" }), (e) => codeOf(e) === "validation.bad_input", "only an agent");
    const noOne = agentFor(DANA); delete (noOne.ctx as { actingFor?: string }).actingFor;
    await assert.rejects(() => tool["computers.chrome.snapshot"]!(noOne.ctx, { computerId: "my-chrome" }), (e) => codeOf(e) === "validation.bad_input", "work for nobody has no Chrome");
  } finally { bindPersonalChrome(null); }
});

test("a held send leaves its card in the chat with the page's own fields, once, and the first picture leaves Using your Chrome", async () => {
  const calls = port({ answers: { chrome_act: { ok: false, heldId: "hld_ab12", why: "held" }, chrome_snapshot: { url: "https://mail.test/", title: "Mail", tree: "x", truncated: false } } });
  try {
    const h = agentFor(DANA, "thr_1");
    const out = await tool["computers.chrome.act"]!(h.ctx, { ref: "e1", action: "click", computerId: "my-chrome" });
    assert.equal(out.heldId, "hld_ab12");
    assert.equal(calls[0]!.thread, "thr_1");
    const posts = h.calls("browser.cards.post");
    const held = posts.map((p) => (p.input["block"] as { type: string; data: Record<string, any> })).find((b) => b.type === "chrome_held")!;
    assert.deepEqual([held.data["heldId"], held.data["card"].to, held.data["state"]], ["hld_ab12", "dana@client.test", "waiting"]);
    const blocks = posts.map((p) => (p.input["block"] as { type: string; data: Record<string, any> }));
    const step = blocks.find((b) => b.type === "chrome_step" && !b.data["steps"])!;
    const plan = blocks.find((b) => b.type === "chrome_step" && b.data["steps"])!;
    assert.deepEqual(plan.data["steps"], [{ text: "Opened Contacts", state: "done" }, { text: "Drafted the email", state: "done" }, { text: "Send waits for you", state: "waiting" }], "the checklist above the held card");
    assert.equal(plan.data["state"], "waiting");
    assert.deepEqual([step.data["site"], step.data["thumb"], step.data["state"]], ["mail.test", THUMB, "using"]);
    await tool["computers.chrome.snapshot"]!(h.ctx, { computerId: "my-chrome" });
    assert.equal(h.calls("browser.cards.post").filter((p) => (p.input["block"] as { type: string; data: Record<string, unknown> }).type === "chrome_step" && !(p.input["block"] as { data: Record<string, unknown> }).data["steps"]).length, 1, "one picture card for a burst");
  } finally { bindPersonalChrome(null); }
});

test("a screenshot comes back as png whichever name the extension used", async () => {
  port({ answers: { chrome_screenshot: { image: "iVBORw0KGgo=", width: 800, height: 600 } } });
  try {
    const out = await tool["computers.chrome.screenshot"]!(agentFor(DANA).ctx, { computerId: "my-chrome" });
    assert.ok(out.fileId, "kept as a file like any screenshot");
  } finally { bindPersonalChrome(null); }
});
