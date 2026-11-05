// The two cards an agent in the person's own Chrome leaves in a chat: the held send with To, From, Subject and Message and Allow, Edit, Deny; and "Using your Chrome" with a masked picture,
// Watch and Take over. They read only their own data, a picture only as the extension's own data image, and they draw in a message through the same path as any card.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ChromeStepCard, HeldSendCard, heldCardOf, stepCardOf, stepWords, verbOf } from "./chrome-cards.tsx";
import { MessageView } from "./MessageView.tsx";
import { timeline } from "./model.ts";
import type { Message } from "./model.ts";

const ok = { send: async () => ({ sent: true }), drop: async () => undefined, watch: async () => undefined, takeOver: async () => undefined };
const THUMB = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
const HELD = { heldId: "hld_a1b2c3", agent: "Scout", site: "mail.google.com", kind: "send", card: { to: "dana@client.test", from: "olivia@firm.test", subject: "Your signed deed", message: "Hi Dana, the signed deed is attached." }, state: "waiting" };
const flat = (h: string): string => h.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");

test("a held block reads To, From, Subject and Message from the extension's card, and nothing that is not a held id", () => {
  assert.deepEqual(heldCardOf(HELD), { heldId: "hld_a1b2c3", agent: "Scout", site: "mail.google.com", kind: "send", to: "dana@client.test", from: "olivia@firm.test", subject: "Your signed deed", message: "Hi Dana, the signed deed is attached.", summary: "", state: "waiting" });
  assert.equal(heldCardOf({ ...HELD, heldId: "../x" }), null);
  assert.equal(heldCardOf({}), null);
  assert.equal(heldCardOf({ ...HELD, state: "odd" })?.state, "waiting");
  assert.equal(heldCardOf({ ...HELD, state: "sent" })?.state, "sent");
});

test("the card names the act: Send, Post, Pay or Delete; the buttons are Allow and Deny whatever the act", () => {
  assert.deepEqual(verbOf("send"), { do: "Send", what: "send this" });
  assert.equal(verbOf("post").do, "Post");
  assert.equal(verbOf("payment").do, "Pay");
  assert.equal(verbOf("delete").do, "Delete");
  assert.equal(verbOf("form").do, "Go ahead");
});

test("the held card draws the four fields and three buttons; once answered it says what happened and has no buttons", () => {
  const open = renderToStaticMarkup(<HeldSendCard id="b1" data={HELD} agentId="agt_scout" actions={ok} />);
  const t = flat(open);
  assert.match(t, /Scout wants to send this to dana@client\.test/);
  assert.match(t, /Where mail\.google\.com, in your Chrome/);
  assert.match(t, /Scout stopped before Send/);
  for (const w of ["From", "olivia@firm.test", "Subject", "Your signed deed", "Hi Dana, the signed deed is attached."]) assert.ok(t.includes(w), w);
  for (const id of ["send", "edit", "drop"]) assert.match(open, new RegExp(`chrome-held-b1-${id}`));
  assert.match(t, /Allow Edit Deny/);
  assert.doesNotMatch(t, /Don't send/);
  const sent = renderToStaticMarkup(<HeldSendCard id="b1" data={{ ...HELD, state: "sent" }} agentId="agt_scout" />);
  assert.match(flat(sent), /Sent/);
  assert.ok(!/chrome-held-b1-send/.test(sent));
  assert.match(flat(renderToStaticMarkup(<HeldSendCard id="b2" data={{ ...HELD, state: "dropped" }} agentId="agt_scout" />)), /Not sent/);
  assert.match(flat(renderToStaticMarkup(<HeldSendCard id="b3" data={{ ...HELD, kind: "payment", card: {}, summary: "payment: Pay now on shop.test" }} agentId="agt_scout" />)), /Pay now on shop\.test/);
  assert.ok(!/<script|onerror/i.test(renderToStaticMarkup(<HeldSendCard id="b4" data={{ ...HELD, card: { message: "<script>x</script>" } }} agentId="a" />)), "text is text");
});

test("the step card says Using your Chrome with the site, shows only the extension's own picture, and offers Watch and Take over while it works", () => {
  assert.equal(stepCardOf({ site: "" }), null);
  assert.equal(stepCardOf({ site: "a.test", thumb: "https://tracker.test/x.png" })?.thumb, null);
  assert.equal(stepCardOf({ site: "a.test", thumb: THUMB })?.thumb, THUMB);
  assert.equal(stepWords({ agent: "Scout", site: "a.test", thumb: null, state: "using", saw: [], open: false, goal: "", steps: [] }), "Using your Chrome · a.test");
  assert.equal(stepWords({ agent: "Scout", site: "a.test", thumb: null, state: "waiting", saw: [], open: false, goal: "", steps: [] }), "Waiting for you · a.test");
  assert.equal(stepWords({ agent: "Scout", site: "a.test", thumb: null, state: "stopped", saw: [], open: false, goal: "", steps: [] }), "Stopped in your Chrome · a.test");
  const live = renderToStaticMarkup(<ChromeStepCard id="s1" data={{ agent: "Scout", site: "app.gohighlevel.com", thumb: THUMB, state: "using" }} agentId="agt_scout" actions={ok} />);
  assert.match(flat(live), /Using your Chrome · app\.gohighlevel\.com/);
  assert.match(live, /chrome-step-s1-thumb/);
  assert.match(live, /chrome-step-watch-s1/);
  assert.match(live, /chrome-step-takeover-s1/);
  const withSaw = renderToStaticMarkup(<ChromeStepCard id="s3" data={{ agent: "Scout", site: "a.test", state: "using", saw: ["#Acme_Portal.password", "hunter2", "#Acme_Portal.username"] }} agentId="agt_scout" />);
  assert.match(flat(withSaw), /Show what Scout saw/);
  assert.deepEqual(stepCardOf({ site: "a.test", saw: ["#Acme_Portal.password", "hunter2"] })?.saw, ["#Acme_Portal.password"], "only handles, never a value");
  const open = renderToStaticMarkup(<ChromeStepCard id="s4" data={{ agent: "Scout", site: "a.test", state: "using", saw: ["#Acme_Portal.password"], open: true }} agentId="agt_scout" />);
  assert.match(flat(open), /Hide what Scout saw.*#Acme_Portal\.password.*Names only/);
  assert.ok(!flat(withSaw).includes("#Acme_Portal.password"), "closed: the handles are not on the page");
  const listed = renderToStaticMarkup(<ChromeStepCard id="s5" data={{ agent: "Scout", site: "app.gohighlevel.com", state: "waiting", steps: [{ text: "Opened Contacts", state: "done" }, { text: "Drafted the email", state: "done" }, { text: "Send waits for you", state: "waiting" }, { text: "x".repeat(300), state: "odd" }, { text: "" }] }} agentId="agt_scout" />);
  assert.match(flat(listed), /Opened Contacts.*Drafted the email.*Send waits for you/);
  assert.match(flat(listed), /Tab group &quot;Vyre · Scout&quot; in your Chrome/);
  assert.deepEqual(stepCardOf({ site: "a.test", steps: [{ text: "a", state: "done" }, { text: "" }, { text: "b", state: "odd" }] })!.steps, [{ text: "a", state: "done" }, { text: "b", state: "todo" }]);
  const done = renderToStaticMarkup(<ChromeStepCard id="s2" data={{ agent: "Scout", site: "a.test", thumb: null, state: "done" }} agentId="agt_scout" />);
  assert.ok(!/chrome-step-watch|takeover/.test(done), "nothing to watch or take over once it is done");
  assert.match(done, />A</, "no picture: the site's initial");
});

test("in a message from the agent, both blocks draw as their own cards and the buttons call what the chat gave them", () => {
  const calls: string[] = [];
  const m: Message = {
    messageId: "msg_c1", threadId: "thr_c", threadSeq: 1, author: { kind: "agent", id: "agt_scout" }, kind: "agent", body: "I wrote the email.",
    blocks: [{ id: "blk_s", type: "chrome_step", v: 1, state: "live", data: { agent: "Scout", site: "mail.google.com", thumb: THUMB, state: "waiting" } }, { id: "blk_h", type: "chrome_held", v: 1, state: "waiting", data: HELD }] as never,
    depth: 0, attachments: [], reactions: [], pinned: false, createdAt: Date.UTC(2025, 9, 9, 9, 0),
  } as unknown as Message;
  const nameOf = (id: string): string => (id === "agt_scout" ? "Scout" : "Olivia");
  const actions = { nameOf, chrome: ok, copy: () => undefined, openThread: () => undefined, setPinned: () => undefined, react: () => undefined, remove: () => undefined, openAgent: () => undefined, showMenu: () => undefined } as never;
  const items = timeline([m], { meId: "usr_olivia", nameOf, kindOf: (id: string) => (id.startsWith("agt_") ? "agent" : "person"), clock: { now: Date.UTC(2025, 9, 9, 10, 0), zone: "UTC" } as never });
  const html = items.map((it) => renderToStaticMarkup(<MessageView item={it} actions={actions} meId="usr_olivia" />)).join("");
  assert.match(html, /chrome-step-blk_s/);
  assert.match(html, /chrome-held-blk_h/);
  assert.match(flat(html), /Scout wants to send this/);
  assert.match(flat(html), /Waiting for you · mail\.google\.com/);
});
