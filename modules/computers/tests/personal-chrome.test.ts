// An agent working in the person's own Chrome (Chrome step 2): the Chrome tools run there only when the call asks for it (inMyChrome), the person said so in this turn ("in my Chrome", "on my computer",
// the Use my Chrome choice), and the person signed in to that Chrome is the one the agent works for, in the Space they picked, with Chrome open to agents. Never by default, never for another
// person's agent. A held item and the first picture leave their cards in the chat.
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
/** The chat's lines as `chat.messages.list` answers them: `said` is what the person wrote last (as them unless `by` names someone else). */
const chat = (said: string, by = DANA) => () => ({ messages: [
  { threadSeq: 1, author: { kind: "person", id: by }, body: "an older line that asked for my Chrome" },
  { threadSeq: 2, author: { kind: "agent", id: "agt_scout" }, body: "Sure" },
  { threadSeq: 3, author: { kind: "person", id: by }, body: said },
], hasMore: false });
const ASK = "Please check the inbox in my Chrome";
const agentFor = (person: string, thread: string | null = "thr_1", said = ASK, by = person) => {
  const h = harness({ principal: { kind: "agent", id: "agt_scout" }, actingFor: person, respond: { "browser.cards.post": () => ({ posted: true }), "chat.messages.list": chat(said, by) } });
  if (thread) h.ctx.thread = thread;
  return h;
};
const MINE = { inMyChrome: true } as const;

test("an agent works in its person's Chrome when asked to, and what the extension answers is what the tool answers", async () => {
  const calls = port({ answers: { chrome_snapshot: { url: "https://mail.test/", title: "Mail", tree: "- page [e1]", truncated: false } } });
  try {
    const h = agentFor(DANA, "thr_first");
    const out = await tool["computers.chrome.snapshot"]!(h.ctx, { ...MINE });
    assert.equal(out.title, "Mail");
    assert.deepEqual([calls[0]!.tool, calls[0]!.agent.id, calls[0]!.space], ["chrome_snapshot", "agt_scout", "spc_computerstest"]);
    assert.equal((await tool["computers.chrome.snapshot"]!(h.ctx, { computerId: "my-chrome" })).title, "Mail", "or by the older name");
  } finally { bindPersonalChrome(null); }
});

test("only for the person signed in to that Chrome: another person's agent, a Chrome not opened to agents, and a person calling are refused", async () => {
  try {
    port();
    await assert.rejects(() => tool["computers.chrome.snapshot"]!(agentFor(OMAR).ctx, { computerId: "my-chrome" }), (e) => codeOf(e) === "provider.unavailable");
    port({ open: false });
    await assert.rejects(() => tool["computers.chrome.snapshot"]!(agentFor(DANA).ctx, { computerId: "my-chrome" }), (e) => codeOf(e) === "provider.unavailable");
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
    const out = await tool["computers.chrome.act"]!(h.ctx, { ref: "e1", action: "click", ...MINE });
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
    await tool["computers.chrome.snapshot"]!(h.ctx, { ...MINE });
    assert.equal(h.calls("browser.cards.post").filter((p) => (p.input["block"] as { type: string; data: Record<string, unknown> }).type === "chrome_step" && !(p.input["block"] as { data: Record<string, unknown> }).data["steps"]).length, 1, "one picture card for a burst");
  } finally { bindPersonalChrome(null); }
});

test("a screenshot comes back as png whichever name the extension used", async () => {
  port({ answers: { chrome_screenshot: { image: "iVBORw0KGgo=", width: 800, height: 600 } } });
  try {
    const out = await tool["computers.chrome.screenshot"]!(agentFor(DANA).ctx, { ...MINE });
    assert.ok(out.fileId, "kept as a file like any screenshot");
  } finally { bindPersonalChrome(null); }
});

// ---- the gate: the person's own Chrome only when they asked in this turn

test("without the ask in this turn the person's Chrome is refused, and nothing reaches it", async () => {
  const calls = port();
  try {
    const refused = async (h: ReturnType<typeof agentFor>, input: Record<string, unknown>) => {
      await assert.rejects(() => tool["computers.chrome.snapshot"]!(h.ctx, input), (e) => codeOf(e) === "validation.bad_input" && /did not ask for their own Chrome/.test(String((e as { message?: string }).message ?? JSON.stringify(e))));
    };
    await refused(agentFor(DANA, "thr_1", "Check the inbox and summarise it"), { ...MINE });
    await refused(agentFor(DANA, "thr_1", "Check the inbox and summarise it"), { computerId: "my-chrome" });
    await refused(agentFor(DANA, "thr_1", "Check the inbox, but not in my Chrome please"), { ...MINE });
    await refused(agentFor(DANA, "thr_1", "Please do not use my Chrome for this"), { ...MINE });
    await refused(agentFor(DANA, "thr_1", "Do it without my Chrome"), { ...MINE });
    await refused(agentFor(DANA, "thr_1", "Answered: Use the Space browser (space)"), { ...MINE });
    await refused(agentFor(DANA, "thr_1", ASK, OMAR), { ...MINE });   // someone else in the chat asked, not the person the agent works for
    await refused(agentFor(DANA, null), { ...MINE });                  // no chat, no turn to have asked in
    assert.equal(calls.length, 0, "the extension was never called");
  } finally { bindPersonalChrome(null); }
});

test("no ask, no flag: an agent with no computer is not sent to the person's Chrome", async () => {
  const calls = port();
  try {
    await assert.rejects(() => tool["computers.chrome.snapshot"]!(agentFor(DANA).ctx, {}), (e) => codeOf(e) === "validation.not_found", "the old answer: this agent has no computer");
    await assert.rejects(() => tool["computers.chrome.open"]!(agentFor(DANA).ctx, { url: "https://mail.test/" }), (e) => codeOf(e) === "validation.not_found");
    assert.equal(calls.length, 0);
  } finally { bindPersonalChrome(null); }
});

test("the ask is the newest line of the person: an earlier ask does not carry over, and every way of asking counts", async () => {
  const calls = port({ answers: { chrome_state: { url: "https://mail.test/", title: "Mail", loading: false } } });
  try {
    const ok = async (said: string) => { const n = calls.length; await tool["computers.chrome.state"]!(agentFor(DANA, "thr_1", said).ctx, { ...MINE }); assert.equal(calls.length, n + 1, said); };
    await ok("Open the Lab 7 sheet in my Chrome");
    await ok("do it on my computer");
    await ok("Use my own Chrome and look at the invoice");
    await ok("Answered: Use my Chrome (mine)");
    await ok("go to the tab I have open for Gmail and archive the old ones");
    const n = calls.length;
    await assert.rejects(() => tool["computers.chrome.state"]!(agentFor(DANA, "thr_1", "Thanks. Now draft the reply").ctx, { ...MINE }), (e) => codeOf(e) === "validation.bad_input", "the line before it asked; this one did not");
    assert.equal(calls.length, n);
  } finally { bindPersonalChrome(null); }
});

test("held sends, Stop and Resume need no new ask: they finish what an ask began", async () => {
  const calls = port({ answers: { chrome_send: { sent: true }, chrome_stop: { stopped: true }, chrome_resume: { resumed: true }, chrome_status: { connected: true, paused: false, held: [] } } });
  try {
    const h = agentFor(DANA, "thr_1", "Thanks, I approved it");
    assert.equal((await tool["computers.chrome.send"]!(h.ctx, { heldId: "hld_ab12", ...MINE })).sent, true);
    assert.equal((await tool["computers.chrome.stop"]!(h.ctx, { ...MINE })).stopped, true);
    assert.equal((await tool["computers.chrome.resume"]!(h.ctx, { ...MINE })).resumed, true);
    assert.equal((await tool["computers.chrome.status"]!(h.ctx, { ...MINE })).connected, true);
    assert.deepEqual(calls.map((c) => c.tool), ["chrome_send", "chrome_stop", "chrome_resume", "chrome_status"]);
  } finally { bindPersonalChrome(null); }
});

test("when the app or the extension is not connected the answer says so plainly and offers the Space browser", async () => {
  try {
    port({ open: false });
    await assert.rejects(() => tool["computers.chrome.snapshot"]!(agentFor(DANA).ctx, { ...MINE }), (e) => {
      const m = String((e as { message?: string }).message ?? "");
      return codeOf(e) === "provider.unavailable" && /not connected/.test(m) && /Space browser/.test(m);
    });
    bindPersonalChrome(null);   // no bridge bound at all: the daemon has no extension
    await assert.rejects(() => tool["computers.chrome.snapshot"]!(agentFor(DANA).ctx, { ...MINE }), (e) => codeOf(e) === "provider.unavailable" && /Space browser/.test(String((e as { message?: string }).message ?? "")));
  } finally { bindPersonalChrome(null); }
});

test("a batch runs in the person's Chrome only when asked, and each step is checked by the same gate", async () => {
  const calls = port({ answers: { chrome_snapshot: { url: "https://mail.test/", title: "Mail", tree: "x", truncated: false } } });
  try {
    const out = await tool["computers.chrome.batch"]!(agentFor(DANA).ctx, { ...MINE, steps: [{ tool: "chrome_snapshot", args: { inMyChrome: false } }] });
    assert.equal(out.results[0].ok, true);
    assert.equal(calls.length, 1, "the step cannot step out of the batch's choice");
    const none = await tool["computers.chrome.batch"]!(agentFor(DANA, "thr_1", "just look").ctx, { ...MINE, steps: [{ tool: "chrome_snapshot", args: {} }] });
    assert.equal(none.results[0].ok, false);
    assert.equal(calls.length, 1);
  } finally { bindPersonalChrome(null); }
});

test("find passes its site to the extension, and needs one", async () => {
  const calls = port({ answers: { chrome_tabs: { tabs: [{ tabId: "8", url: "https://mail.test/inbox", title: "Inbox", active: false }] } } });
  try {
    const h = agentFor(DANA);
    const out = await tool["computers.chrome.tabs"]!(h.ctx, { ...MINE, action: "find", site: " mail.test " });
    assert.equal(out.tabs[0].tabId, "8");
    assert.deepEqual([calls[0]!.tool, calls[0]!.args], ["chrome_tabs", { action: "find", site: "mail.test" }]);
    await assert.rejects(() => tool["computers.chrome.tabs"]!(h.ctx, { ...MINE, action: "find" }), (e) => codeOf(e) === "validation.bad_input");
  } finally { bindPersonalChrome(null); }
});
