// A chat turn drives the person's real Chrome, end to end below the model (Chrome step 2): a scripted engine makes the same capability calls an agent turn makes (computers.chrome.*, in a thread, for the
// person it works for), through the real computers module, the PersonalChrome port over the Chrome bridge, the native host and the unpacked extension in headless Chromium. The held send leaves a card in the
// chat (through browser.cards.post, as chat.post with no text and no mention); Send on the card sends once; Don't send is forgotten by the extension and the agent is told in the chat.
import test from "node:test";
import assert from "node:assert/strict";
import { findChromium, launch, site } from "../apps/chrome/tests/e2e/rig.ts";
import { createBridgePort } from "../lib/personal-chrome-bridge.ts";
import { bindPersonalChrome } from "../lib/personal-chrome.ts";
import { harness } from "../modules/computers/fixtures/harness.ts";
import { tool } from "../modules/computers/tests/tools.fixture.ts";
import { handlers as browser } from "../modules/browser/impl.ts";
import { world as browserWorld } from "../modules/browser/fixtures/world.ts";

const found = await findChromium();
const SPACE = "spc_computerstest";
const PERSON = "usr_olivia";
const AGENT = "agt_scout";

const MAIL = `<!doctype html><meta charset="utf-8"><title>Mail</title><main><form method="post" action="/send"><label for="to">To</label><input id="to" name="to" value="dana@client.test">
<label for="subject">Subject</label><input id="subject" name="subject" value="Your signed deed"><label for="body">Message</label><textarea id="body" name="body">Hi Dana, the deed is attached.</textarea><button type="submit">Send</button></form></main>`;

test("a chat turn works in the person's Chrome: the held send is a card, Send sends once, Don't send is declined and the agent hears it", { skip: !found && "no Chromium on this machine", timeout: 90_000 }, async () => {
  const srv = await site({ "/": MAIL, "/send": () => "<!doctype html><title>Sent</title><p>Sent</p>" });
  const r = await launch(found!, { agent: true, caps: { "browser.sites.list": () => ({ sites: [{ id: "bsi_1", host: "127.0.0.1", runsIn: "chrome", rights: [{ agentId: AGENT, right: "act" }], at: 1, updatedAt: 1 }] }) } });
  const bw = browserWorld(SPACE);
  const bport = createBridgePort({ bridge: r.bridge, whoami: async () => ({ person: PERSON, spaceId: SPACE }), agentName: async () => "Scout" });
  bindPersonalChrome(bport.port);
  // the daemon hands every event the extension sends to the port as it arrives; here a short poll does the same
  let fed = 0;
  const feed = () => { for (; fed < r.events.length; fed++) bport.onEvent(r.events[fed] as never); };
  const timer = setInterval(feed, 10);
  // the scripted engine: the agent's calls into the computers module, as an agent turn makes them (the thread is where the turn runs)
  const turn = harness({
    principal: { kind: "agent", id: AGENT }, actingFor: PERSON,
    respond: { "browser.cards.post": (input) => browser["browser.cards.post"](bw.as(AGENT, "agent"), input as never) },
  });
  turn.ctx.thread = "thr_lab7";
  const agent = (cap: string, input: Record<string, unknown> = {}) => tool[cap]!(turn.ctx, { computerId: "my-chrome", ...input });
  const sends = () => srv.hits.filter((h) => h.path === "/send").length;
  try {
    await r.worker.evaluate((s: string) => (globalThis as any).chrome.storage.local.set({ activeSpace: s }), SPACE);
    const page = await r.context.newPage();
    await page.goto(srv.url + "/");
    const tabId = await r.worker.evaluate(async (u: string) => ((await (globalThis as any).chrome.tabs.query({})).find((t: any) => String(t.url).startsWith(u)) ?? {}).id, srv.url);
    await r.waitFor(() => r.bridge.connected === 1, 15_000, "the extension's agent channel");
    r.bridge.optIn([SPACE], "personal");
    await r.waitFor(() => r.bridge.opened !== null, 3000, "opt-in");
    await new Promise((x) => setTimeout(x, 300));

    // the turn reads and presses Send: the press is held, and the card lands in the chat with the page's own fields
    await agent("computers.chrome.tabs", { action: "use", tabId: String(tabId) });
    const snap = await agent("computers.chrome.snapshot");
    const ref = /button "Send" \[ref=(e\d+)\]/.exec(snap.tree)![1];
    const held = await agent("computers.chrome.act", { ref, action: "click" });
    assert.match(held.heldId, /^hld_/);
    const posts = bw.called("chat.post").map((c) => c.input as { threadId: string; body: string; mentions: unknown[]; blocks: Array<{ type: string; data: Record<string, any> }> });
    const card = posts.find((p) => p.blocks[0]!.type === "chrome_held");
    assert.ok(card, "a held card was left in the chat");
    assert.deepEqual([card!.threadId, card!.body, card!.mentions], ["thr_lab7", "", []], "in the turn's chat, with no text and no mention");
    assert.equal(card!.blocks[0]!.data["heldId"], held.heldId);
    assert.deepEqual([card!.blocks[0]!.data["card"].to, card!.blocks[0]!.data["card"].subject, card!.blocks[0]!.data["card"].message], ["dana@client.test", "Your signed deed", "Hi Dana, the deed is attached."]);
    assert.equal(sends(), 0, "nothing was sent");

    // Send on the card: sent once; pressing it again says it was already done
    const send = (id: string, key: string) => browser["browser.chrome.act"](bw.as(PERSON), { action: "send", agentId: AGENT, heldId: id, threadId: "thr_lab7", idempotencyKey: key });
    assert.deepEqual(await send(held.heldId, "s1"), { done: true });
    await r.waitFor(() => sends() === 1, 5000, "the send");
    assert.deepEqual(await send(held.heldId, "s2"), { done: false, already: true });
    await new Promise((x) => setTimeout(x, 400));
    assert.equal(sends(), 1, "exactly once");

    // a second held send, and Don't send: the extension forgets it, the agent is told, nothing goes out
    await page.goto(srv.url + "/");
    const snap2 = await agent("computers.chrome.snapshot");
    const held2 = await agent("computers.chrome.act", { ref: /button "Send" \[ref=(e\d+)\]/.exec(snap2.tree)![1], action: "click" });
    assert.match(held2.heldId, /^hld_/);
    await browser["browser.chrome.act"](bw.as(PERSON), { action: "drop", agentId: AGENT, heldId: held2.heldId, threadId: "thr_lab7", summary: "send: Send on 127.0.0.1", idempotencyKey: "d1" });
    const told = bw.called("chat.post").map((c) => c.input as { body: string }).find((p) => /Don't send that/.test(p.body));
    assert.ok(told, "the agent hears it was declined");
    await assert.rejects(agent("computers.chrome.send", { heldId: held2.heldId }), "the agent cannot press what was declined");
    await new Promise((x) => setTimeout(x, 300));
    assert.equal(sends(), 1, "declined: nothing more went out");

    // Edit on the card: the edited values go into the page before the press, and what is sent is what the person edited
    await page.goto(srv.url + "/");
    const snap3 = await agent("computers.chrome.snapshot");
    const held3 = await agent("computers.chrome.act", { ref: /button "Send" \[ref=(e\d+)\]/.exec(snap3.tree)![1], action: "click" });
    assert.deepEqual(await browser["browser.chrome.act"](bw.as(PERSON), { action: "send", agentId: AGENT, heldId: held3.heldId, edits: { subject: "Edited subject", message: "Hi Dana, one change." }, threadId: "thr_lab7", idempotencyKey: "s3" }), { done: true });
    await r.waitFor(() => sends() === 2, 5000, "the edited send");
    const body = decodeURIComponent(srv.hits.filter((h) => h.path === "/send")[1]!.body.replace(/\+/g, " "));
    assert.match(body, /subject=Edited subject/);
    assert.match(body, /body=Hi Dana, one change\./);
    assert.match(body, /to=dana@client\.test/, "what was not edited stays");
  } finally { clearInterval(timer); bindPersonalChrome(null); await r.close(); await srv.close(); }
});
