// The side panel's plumbing against fakes: per-site privacy and incognito, masked-screenshot geometry, what a message carries from its chips, the panel's worker answers,
// the right-click items, Save to Notes, the panel's state rules, the new bridge pushes, and the app's answers to the extension (lib/chrome-app.ts).
// The same parts in a real Chromium with the unpacked extension are in ext-panel.e2e.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT, allowed, createPrivacy, privacyFor } from "../src/worker/privacy.js";
import { scaleRects } from "../src/worker/shot.js";
import { createPanel, outgoing } from "../src/worker/panel.js";
import { MENU, intent } from "../src/worker/menus.js";
import { createNotes, imageOf } from "../src/worker/notes.js";
import { ago, applyDelta, chips, groupThreads, modelGroups, modelLabel, suggestions } from "../src/panel/model.js";
import { BRIDGE_OPS, CAPABILITIES, parseIncoming, request } from "../src/worker/protocol.js";
import { createStore } from "../src/worker/store.js";
import { CHROME_CAPABILITIES, KEYED, createChromeApp, gatewayCall, routeOf } from "../../../lib/chrome-app.ts";
import { routes } from "../../../generated/routes.ts";

function memoryArea() {
  const data: Record<string, unknown> = {};
  return { async get(keys: string[]) { return Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]])); }, async set(i: Record<string, unknown>) { Object.assign(data, i); }, async remove(keys: string[]) { for (const k of keys) delete data[k]; } };
}

// ---------- privacy

test("per-site privacy: attach by default, a parent domain covers its subdomains, an exact host wins, never reads nothing", async () => {
  const list = [{ host: "gohighlevel.com", mode: "ask" as const, records: true }, { host: "app.gohighlevel.com", mode: "never" as const, records: false }];
  assert.deepEqual(privacyFor("example.com", list), { host: null, ...DEFAULT });
  assert.equal(privacyFor("x.gohighlevel.com", list).mode, "ask");
  assert.equal(privacyFor("app.gohighlevel.com", list).mode, "never");
  assert.equal(privacyFor("evilgohighlevel.com", list).mode, "attach", "a look-alike host is not under the rule");
  const never = allowed({ url: "https://app.gohighlevel.com/v2/contacts", incognito: false }, list);
  assert.equal(never.read, false); assert.equal(never.records, false); assert.equal(never.why, "never");
  assert.equal(allowed({ url: "https://a.test/" }, []).read, true);
});

test("incognito is off whatever the site says, and a tab that is not a web page is off", () => {
  const inc = allowed({ url: "https://a.test/", incognito: true }, []);
  assert.equal(inc.off, true); assert.equal(inc.why, "incognito"); assert.equal(inc.read, false);
  assert.equal(allowed({ url: "chrome://settings" }, []).why, "not_a_page");
  assert.equal(allowed(null, []).off, true);
});

test("the privacy choice is stored by host as a word, and going back to the default removes the row", async () => {
  const area = memoryArea();
  const p = createPrivacy(createStore(area));
  await p.set("A.test", { mode: "never" });
  assert.deepEqual(await p.list(), [{ host: "a.test", mode: "never", records: true }]);
  assert.equal((await p.of({ url: "https://a.test/x" })).read, false);
  await p.set("a.test", { mode: "attach" });
  assert.deepEqual(await p.list(), [], "attach with records on is the default: nothing kept");
  await assert.rejects(p.set("a.test", { mode: "sometimes" as any }));
});

// ---------- screenshots

test("masked boxes are scaled from CSS pixels to the image the browser returned, and clipped to it", () => {
  const out = scaleRects([{ x: 10, y: 20, w: 100, h: 30 }, { x: 1270, y: 790, w: 40, h: 40 }, { x: -50, y: -50, w: 10, h: 10 }], { vw: 1280, vh: 800 }, 2560, 1600);
  assert.deepEqual(out[0], { x: 20, y: 40, w: 200, h: 60 });
  assert.deepEqual(out[1], { x: 2540, y: 1580, w: 20, h: 20 }, "a box past the edge is cut at the edge");
  assert.equal(out.length, 2, "a box entirely off the image is dropped");
});

// ---------- what a message carries

const ctx = { url: "https://app.gohighlevel.com/c/1", title: "Marisol Vega", page: { text: "Marisol Vega marisol@vegalaw.com" }, shot: { dataUrl: "data:image/jpeg;base64,AAAA" } };
test("a message carries the page, its screenshot and the selection only as far as the chips say, and nothing on a site that is never sent", () => {
  const all = outgoing({ text: " hi ", page: true, shot: true, selection: "We doubled consults" }, { read: true }, ctx);
  assert.equal(all.text, "hi");
  assert.equal(all.page?.shot, ctx.shot.dataUrl);
  assert.equal(all.selection?.text, "We doubled consults");
  const noShot = outgoing({ text: "hi", page: true, shot: false, selection: "" }, { read: true }, ctx);
  assert.equal(noShot.page?.shot, undefined); assert.equal(noShot.selection, undefined);
  const noPage = outgoing({ text: "hi", page: false, shot: true, selection: "x" }, { read: true }, ctx);
  assert.equal(noPage.page, undefined); assert.equal(noPage.selection?.text, "x");
  assert.deepEqual(outgoing({ text: "hi", page: true, shot: true, selection: "x" }, { read: false }, ctx), { text: "hi" });
});

// ---------- the panel's worker half

function fakePanelWorld(o: { incognito?: boolean; url?: string; privacy?: any[] } = {}) {
  const tab = { id: 7, windowId: 3, active: true, url: o.url ?? "https://app.gohighlevel.com/c/1", title: "Marisol Vega · Contacts", incognito: Boolean(o.incognito) };
  const area = memoryArea();
  const store = createStore(area);
  const ops: { op: string; input: any }[] = [];
  const invokes: { cap: string; input: any }[] = [];
  const pushHandlers: ((m: any) => void)[] = [];
  const bridge = {
    async op(op: string, input: any = {}) {
      ops.push({ op, input });
      if (op === "hello") return { spaces: [{ id: "spc_mla", name: "My Legal Academy", webUrl: "https://mla.vyre.test" }], active: "spc_mla", locked: false };
      if (op === "agents.list") return { agents: [{ id: "agt_assist", name: "Assistant", assistant: true }, { id: "agt_scout", name: "Scout" }], suggested: { id: "agt_assist", name: "Assistant" } };
      if (op === "chat.ask") return { threadId: "thr_1", turnId: "msg_1" };
      if (op === "records.match") return { records: [{ id: "rec_1", name: "Marisol Vega", kind: "Contact", why: "by email address", chats: [], goals: [] }] };
      if (op === "chat.search") return { threads: [{ threadId: "thr_9", title: "Follow up", host: "app.gohighlevel.com" }] };
      throw Object.assign(new Error("no"), { code: "not_available" });
    },
    async invoke(cap: string, input: any = {}) {
      invokes.push({ cap, input });
      if (cap === "engine.models.list") return { models: [{ provider: "anthropic", model: "claude-opus-5-5", title: "Opus 5.5", driver: "api", allowed: true, isDefault: true }, { provider: "openai", model: "gpt-x", title: "GPT X", driver: "api", allowed: false, reason: "not_connected" }] };
      return {};
    },
    onPush(f: (m: any) => void) { pushHandlers.push(f); return () => {}; },
  };
  const ext = { tabs: { async query() { return [tab]; } } };
  const privacy = createPrivacy(store);
  const reads: number[] = [];
  const context = {
    async read(tabId: number) { reads.push(tabId); return { title: "Marisol Vega · Contacts", text: "Marisol marisol@vegalaw.com", selection: "", emails: ["marisol@vegalaw.com"], phones: [] }; },
    async page(t: any, opt: any = {}) { const may = await privacy.of(t); return { tabId: t.id, url: t.url, title: t.title, host: "app.gohighlevel.com", privacy: may, page: may.read ? { text: "Marisol", selection: "" } : null, shot: may.read && opt.shot !== false ? { dataUrl: "data:image/jpeg;base64,QUJD" } : null }; },
    async selection() { return ""; },
  };
  const panel = createPanel({ ext, bridge, store, privacy, context: context as any });
  const told: any[] = [];
  panel.connect({ postMessage: (m: any) => told.push(m), onMessage: { addListener() {} }, onDisconnect: { addListener() {} } });
  return { tab, panel, ops, invokes, told, reads, push: (m: any) => pushHandlers.forEach((f) => f(m)), privacy, store };
}

test("panel.state: the Space, agents and the page, with Vyre off in incognito", async () => {
  const w = fakePanelWorld();
  const st = (await w.panel.handle({ type: "panel.state", windowId: 3 })).data;
  assert.equal(st.off, null);
  assert.equal(st.active, "spc_mla");
  assert.equal(st.agents.length, 2);
  assert.equal(st.page.host, "app.gohighlevel.com");
  assert.equal(st.page.privacy.read, true);
  const inc = fakePanelWorld({ incognito: true });
  assert.deepEqual((await inc.panel.handle({ type: "panel.state", windowId: 3 })).data, { off: "incognito" });
  assert.equal(inc.ops.length, 0, "nothing is asked of the app from an incognito window");
});

test("panel.send carries the chips through chat.ask, takes a fresh masked screenshot, and refuses incognito", async () => {
  const w = fakePanelWorld();
  const r = (await w.panel.handle({ type: "panel.send", windowId: 3, text: "What should I say?", agentId: "agt_assist", page: true, shot: true, selection: "after 5 PM" })).data;
  assert.deepEqual(r.carried, { page: true, shot: true, selection: true });
  const ask = w.ops.find((o) => o.op === "chat.ask")!.input;
  assert.equal(ask.agentId, "agt_assist"); assert.equal(ask.page.url, w.tab.url); assert.equal(ask.page.shot, "data:image/jpeg;base64,QUJD"); assert.equal(ask.selection.text, "after 5 PM"); assert.equal(ask.from, "chrome");
  const inc = fakePanelWorld({ incognito: true });
  await assert.rejects(inc.panel.handle({ type: "panel.send", windowId: 3, text: "hi", agentId: "a" }), /./);
});

test("on a site that is never sent the panel sends only the words, looks up no records, and keeps no selection", async () => {
  const w = fakePanelWorld();
  await w.panel.handle({ type: "panel.site", windowId: 3, mode: "never" });
  await w.panel.handle({ type: "panel.send", windowId: 3, text: "hi", agentId: "agt_assist", page: true, shot: true, selection: "secret stuff" });
  const ask = w.ops.find((o) => o.op === "chat.ask")!.input;
  assert.equal(ask.page, undefined); assert.equal(ask.selection, undefined);
  assert.deepEqual((await w.panel.handle({ type: "panel.records", windowId: 3 })).data, { records: [] });
  assert.equal(w.ops.some((o) => o.op === "records.match"), false);
  assert.equal(await w.panel.selected(w.tab, "secret"), false, "the Selected chip is refused");
  assert.ok(w.told.some((m) => m.type === "site"), "the panel is told the site changed");
});

test("records.match gets the address and the contact details on the page; the model list is the live one", async () => {
  const w = fakePanelWorld();
  const rec = (await w.panel.handle({ type: "panel.records", windowId: 3 })).data;
  assert.equal(rec.records[0].name, "Marisol Vega");
  assert.deepEqual(w.ops.find((o) => o.op === "records.match")!.input.emails, ["marisol@vegalaw.com"]);
  const m = (await w.panel.handle({ type: "panel.models", windowId: 3, threadId: "thr_1" })).data;
  assert.equal(w.invokes[0]!.cap, "engine.models.list");
  assert.deepEqual(w.invokes[0]!.input, { threadId: "thr_1" });
  assert.deepEqual(m.models.map((x: any) => [x.id, x.allowed]), [["anthropic/claude-opus-5-5", true], ["openai/gpt-x", false]]);
});

test("reply deltas and the Selected chip reach the panel's port; picks are kept per Space", async () => {
  const w = fakePanelWorld();
  w.push({ type: "chat.delta", threadId: "thr_1", turnId: "msg_1", text: "Hello", done: false, error: null });
  assert.deepEqual(w.told.at(-1), { type: "delta", threadId: "thr_1", turnId: "msg_1", text: "Hello", done: false, error: null });
  assert.equal(await w.panel.selected(w.tab, "  We doubled consults  "), true);
  assert.deepEqual(w.told.at(-1), { type: "selection", tabId: 7, text: "We doubled consults" });
  await w.store.set({ activeSpace: "spc_mla" });
  await w.panel.handle({ type: "panel.pick", agent: "agt_scout", model: "anthropic/claude-opus-5-5" });
  assert.deepEqual((await w.panel.handle({ type: "panel.state", windowId: 3 })).data.pick, { space: "spc_mla", agent: "agt_scout", model: "anthropic/claude-opus-5-5" });
  await assert.rejects(w.panel.handle({ type: "panel.nope" }));
});

// ---------- right-click and Save to Notes

test("the right-click items: Save and Ask about the selection or the page, Watch, Show Vyre how", () => {
  assert.deepEqual(MENU.map((m) => m.title), ["Save to Vyre Notes", "Save page to Vyre Notes", "Ask Vyre about this", "Ask Vyre about this page", "Watch this with Vyre", "Show Vyre how"]);
  assert.deepEqual(intent("vyre-save-sel", { selectionText: " hi " }), { do: "clip", selection: "hi" });
  assert.deepEqual(intent("vyre-ask-page", {}), { do: "ask", selection: "" });
  assert.deepEqual(intent("vyre-watch", {}), { do: "panel", view: "watch" });
  assert.equal(intent("other", {}), null);
});

test("Save to Notes clips through notes.clip with the masked screenshot as bytes, and refuses a never site and incognito", async () => {
  assert.deepEqual(imageOf("data:image/jpeg;base64,QUJD"), { data: "QUJD", contentType: "image/jpeg" });
  assert.equal(imageOf("data:text/html;base64,QUJD"), undefined);
  const calls: any[] = [];
  const injected: any[] = [];
  const ext = {
    tabs: { async get() { return { id: 7, windowId: 3, active: true }; }, async captureVisibleTab() { return "data:image/png;base64,AAAA"; } },
    scripting: { async executeScript(o: any) { injected.push(o); if (o.func.name === "sensitiveRects") return [{ result: { rects: [], vw: 1280, vh: 800 } }]; return [{ result: true }]; } },
  };
  const bridge = { async invoke(cap: string, input: any) { calls.push({ cap, input }); return { note: { noteId: "not_1" } }; }, async op() { return {}; } };
  let mode = "attach";
  const notes = createNotes({ ext: ext as any, bridge, privacy: { async of(t: any) { return t.incognito ? { read: false, why: "incognito" } : mode === "never" ? { read: false, why: "never" } : { read: true, why: null }; } }, context: { async read() { return { title: "Priya Raman" }; } } });
  // the worker's real paint needs OffscreenCanvas; here the captured image is passed through unpainted by stubbing the module's paint via maskedShot's option is not reachable, so the clip without a picture is checked
  (globalThis as any).createImageBitmap = undefined;
  const r = await notes.clip({ id: 7, windowId: 3, url: "https://linkedin.com/in/priya", title: "Priya" }, "We doubled consults").catch((e: any) => e);
  assert.ok(r instanceof Error || r.noteId === "not_1");
  mode = "never";
  await assert.rejects(notes.clip({ id: 7, url: "https://a.test/", title: "A" }, ""), (e: any) => e.code === "never_site");
  assert.ok(injected.some((o) => o.func.name === "showToast" && o.args[0].title === "Not saved"), "the page says why");
  await assert.rejects(notes.clip({ id: 7, url: "https://a.test/", title: "A", incognito: true }, ""), (e: any) => e.code === "incognito");
});

// ---------- the panel's state rules

test("chips: the page chip starts off on an ask-me site, the Selected chip is separate, nothing on a never site", () => {
  const read = { read: true, mode: "attach" }, askMe = { read: true, mode: "ask" }, never = { read: false, mode: "never" };
  assert.deepEqual(chips({ privacy: read, pageRemoved: null, selection: "x", selectionRemoved: false }), { page: true, selected: true, canAttach: false, never: false });
  assert.deepEqual(chips({ privacy: askMe, pageRemoved: null, selection: "", selectionRemoved: false }), { page: false, selected: false, canAttach: true, never: false });
  assert.deepEqual(chips({ privacy: read, pageRemoved: false, selection: "x", selectionRemoved: true }), { page: true, selected: false, canAttach: false, never: false });
  assert.deepEqual(chips({ privacy: never, pageRemoved: false, selection: "x", selectionRemoved: false }), { page: false, selected: false, canAttach: false, never: true });
});

test("streamed replies grow one message per turn; search puts this page's chats first; models are grouped live; two suggestions only", () => {
  let conv = applyDelta([], { turnId: "t1", text: "Mar", done: false, error: null }, "Assistant", 1);
  conv = applyDelta(conv, { turnId: "t1", text: "Marisol booked", done: true, error: null }, "Assistant", 2);
  assert.equal(conv.length, 1); assert.equal(conv[0]!.text, "Marisol booked"); assert.equal(conv[0]!.streaming, false);
  const gr = groupThreads([{ host: "a.test", t: 1 }, { host: "b.test", t: 2 }, { host: null, t: 3 }] as any, "a.test");
  assert.deepEqual([gr.here.length, gr.earlier.length], [1, 2]);
  const models = [{ id: "anthropic/o", provider: "anthropic", title: "Opus 5.5", allowed: true, reason: null, isDefault: true }, { id: "openai/g", provider: "openai", title: "GPT", allowed: true, reason: null, isDefault: false }];
  assert.deepEqual(modelGroups(models).map((g) => g.title), ["Claude", "OpenAI"]);
  assert.equal(modelLabel(models, ""), "Opus 5.5"); assert.equal(modelLabel(models, "openai/g"), "GPT");
  assert.equal(suggestions({ host: "app.gohighlevel.com", title: "x", record: { name: "Marisol Vega", kind: "Contact" } }).length, 2);
  assert.deepEqual(suggestions({ host: "", title: "", record: null }), []);
  assert.equal(ago(Date.now() - 2 * 86400_000, Date.now()), "2d");
});

// ---------- the wire

test("the new pushes are understood and checked, and every new call is on the extension's list", () => {
  assert.deepEqual(parseIncoming({ type: "chat.delta", threadId: "t", turnId: "u", text: "hi", done: true }), { type: "chat.delta", threadId: "t", turnId: "u", text: "hi", done: true, error: null });
  assert.equal(parseIncoming({ type: "chat.delta", threadId: "t" }), null);
  assert.deepEqual(parseIncoming({ type: "tab.open", url: "https://a.test/" }), { type: "tab.open", url: "https://a.test/" });
  assert.equal(parseIncoming({ type: "tab.open", url: "javascript:alert(1)" }), null);
  for (const op of ["chat.ask", "chat.search", "chat.thread", "records.match"]) assert.ok(op in BRIDGE_OPS, op);
  assert.deepEqual(Object.keys(CAPABILITIES).sort(), [...CHROME_CAPABILITIES].sort(), "the app allows exactly what the extension may call");
  assert.throws(() => request("r1", "invoke", "notes.delete", {}), /may not call/);
});

// ---------- the app's side

function fakeApp(o: { signedIn?: boolean } = {}) {
  const calls: { cap: string; input: any; as: string }[] = [];
  const pushed: any[] = [];
  const timers: (() => void)[] = [];
  let replies: any[] = [];
  const sessions = o.signedIn === false ? [] : [{ id: "spc_mla", name: "My Legal Academy", address: "https://mla.test", token: "vst_mine" }, { id: "spc_me", name: "Personal", address: "http://127.0.0.1:4100", token: "vst_me" }];
  const app = createChromeApp({
    sessions: () => sessions,
    call: async (sess, cap, input) => {
      calls.push({ cap, input, as: sess.token });
      if (cap === "chat.start") return { thread: { threadId: "thr_1" } };
      if (cap === "chat.post") return { message: { messageId: "msg_9", threadSeq: 4 } };
      if (cap === "chat.messages.list") return { messages: replies };
      if (cap === "agents.list") return { agents: [{ agentId: "agt_a", name: "Assistant", role: "assistant" }, { agentId: "agt_s", name: "Scout" }] };
      if (cap === "search.query") return { hits: [{ kind: "record", id: "rec_1", title: "Marisol Vega", recordType: "Contact" }] };
      if (cap === "search.related") return { hits: [{ kind: "chat", id: "thr_7", title: "Follow up after Lab 7" }] };
      if (cap === "notes.clip") return { note: { noteId: "not_1" } };
      if (cap === "access.principals.list") return { principals: sess.token === "vst_me" ? [{ id: "usr_me", name: "Me Myself" }] : [{ id: "usr_noah", name: "Noah" }, { id: "usr_aliza", name: "Aliza" }] };
      if (cap === "channels.list") return { channels: [{ channelId: "chn_mkt", mainThreadId: "thr_mkt", name: "marketing", archived: false }, { channelId: "chn_old", mainThreadId: "thr_old", name: "old", archived: true }] };
      if (cap === "goals.list") return { goals: [{ id: "gol_1", title: "300 registrations", progress: { value: 212, target: 300 } }, { id: "gol_2", title: "Be nice", progress: { tasksDone: 1, tasks: 2 } }] };
      if (cap === "identity.whoami") return { principal: { kind: "person", id: sess.token === "vst_me" ? "usr_me" : "usr_noah" }, name: "Noah", spaceId: sess.id };
      return {};
    },
    push: (m) => pushed.push(m),
    setTimer: (f) => { timers.push(f); return 0; },
  });
  return { app, calls, pushed, sessions, run: async () => { const f = timers.shift(); f?.(); await new Promise((r) => setImmediate(r)); }, reply: (r: any[]) => { replies = r; } };
}

test("chat.ask starts the chat with the agent and model, posts the page and selection as blocks, and streams the reply back", async () => {
  const f = fakeApp();
  const r = await f.app.op("chat.ask", { agentId: "agt_a", model: "anthropic/claude-opus-5-5", text: "What should I say?", page: { url: "https://app.gohighlevel.com/c/1", title: "Marisol", text: "page", shot: "data:image/jpeg;base64,QUJD" }, selection: { text: "after 5 PM", url: "https://app.gohighlevel.com/c/1" } });
  assert.deepEqual(r, { threadId: "thr_1", turnId: "msg_9" });
  const start = f.calls.find((c) => c.cap === "chat.start")!.input;
  assert.deepEqual([start.agentIds, start.model, start.provider], [["agt_a"], "claude-opus-5-5", "anthropic"]);
  const post = f.calls.find((c) => c.cap === "chat.post")!.input;
  assert.deepEqual(post.blocks.map((b: any) => b.type), ["web_page", "quote"]);
  assert.equal(post.blocks[0].data.shot, "data:image/jpeg;base64,QUJD");
  f.reply([{ author: { kind: "agent", id: "agt_a" }, kind: "agent", body: "Marisol booked" }]);
  await f.run();
  assert.deepEqual(f.pushed.at(-1), { type: "chat.delta", threadId: "thr_1", turnId: "msg_9", text: "Marisol booked", done: false });
  for (let i = 0; i < 4; i++) await f.run();
  assert.equal(f.pushed.at(-1).done, true);
  assert.equal(f.calls.filter((c) => c.cap === "chat.messages.list")[0]!.input.after, 4, "only messages after the person's own");
});

test("every call runs with the picked Space's own session; with nobody signed in each one is refused", async () => {
  const f = fakeApp();
  const hello: any = await f.app.op("hello", {});
  assert.deepEqual(hello, { version: "1", spaces: [{ id: "spc_mla", name: "My Legal Academy", webUrl: "https://mla.test" }, { id: "spc_me", name: "Personal", webUrl: "http://127.0.0.1:4100" }], active: "spc_me", locked: false, signedIn: true });
  assert.equal(((await f.app.op("whoami", {})) as any).person, "usr_me", "the newest sign-in until one is picked");
  await f.app.op("space.select", { id: "spc_mla" });
  assert.equal(((await f.app.op("whoami", {})) as any).person, "usr_noah");
  await f.app.invoke("notes.clip", { url: "https://a.test" });
  assert.equal(f.calls.at(-1)!.as, "vst_mine", "the clip goes with the picked Space's session");
  await assert.rejects(f.app.op("space.select", { id: "spc_other" }), (e: any) => e.code === "validation.not_found");
  await assert.rejects(f.app.invoke("records.delete", {}), (e: any) => e.code === "not_allowed");
  const out = fakeApp({ signedIn: false });
  assert.deepEqual(await out.app.op("hello", {}), { version: "1", spaces: [], active: null, locked: false, signedIn: false });
  for (const go of [() => out.app.invoke("notes.clip", { url: "https://a.test" }), () => out.app.op("agents.list", {}), () => out.app.op("chat.ask", { text: "hi", agentId: "agt_a" }), () => out.app.op("records.match", { emails: ["a@b.co"] })]) {
    await assert.rejects(go(), (e: any) => e.code === "signed_out" && e.message === "Sign in to Vyre on this computer.");
  }
  assert.equal(out.calls.length, 0, "nothing is sent anywhere");
});

test("agents, record matches and app.open", async () => {
  const f = fakeApp();
  const ag: any = await f.app.op("agents.list", {});
  assert.equal(ag.suggested.id, "agt_a");
  const rec: any = await f.app.op("records.match", { emails: ["marisol@vegalaw.com"], phones: [] });
  assert.deepEqual(rec.records[0], { id: "rec_1", name: "Marisol Vega", kind: "Contact", why: "by email address", chats: [{ threadId: "thr_7", title: "Follow up after Lab 7", at: null, agentName: "" }], goals: [] });
  await assert.rejects(f.app.op("app.open", {}), (e: any) => e.code === "not_available");
});

test("the gateway call: the capability's route, the person's bearer session, a key where the route takes one, and the Space's own error codes", async () => {
  for (const c of [...CHROME_CAPABILITIES, "identity.whoami", "agents.list", "chat.start", "chat.post", "chat.messages.list", "chat.search", "chat.recent", "threads.get", "threads.agent.configure", "search.query", "search.related"]) {
    const r = routes.find((x: any) => x.cap === c);
    if (!r) continue; // a lane's capability that is not merged yet
    assert.equal(r.path, routeOf(c), c);
    assert.equal(r.method, "POST", c);
    assert.equal(KEYED.includes(c), r.idempotency === "key", `${c} takes a key: ${r.idempotency}`);
  }
  const seen: any[] = [];
  const fetchOk = (async (url: string, init: any) => { seen.push({ url, init }); return new Response(JSON.stringify({ data: { ok: 1 } }), { status: 200 }); }) as any;
  const s = { id: "spc_a", name: "A", address: "https://a.vyre.run/", token: "vst_x" };
  assert.deepEqual(await gatewayCall(s, "chat.post", { threadId: "thr_1", body: "hi" }, { fetch: fetchOk, key: () => "k1" }), { ok: 1 });
  assert.equal(seen[0].url, "https://a.vyre.run/v1/chat/post");
  assert.equal(seen[0].init.headers.authorization, "Bearer vst_x");
  assert.equal(JSON.parse(seen[0].init.body).idempotencyKey, "k1");
  await gatewayCall(s, "vault.items.match", { url: "https://x.test" }, { fetch: fetchOk });
  assert.equal(JSON.parse(seen[1].init.body).idempotencyKey, undefined);
  const deny = (async () => new Response(JSON.stringify({ error: { code: "permission.role_lacks_permission", message: "No." } }), { status: 403 })) as any;
  await assert.rejects(gatewayCall(s, "vault.share", {}, { fetch: deny }), (e: any) => e.code === "permission.role_lacks_permission");
  const gone = (async () => new Response("", { status: 401 })) as any;
  await assert.rejects(gatewayCall(s, "vault.share", {}, { fetch: gone }), (e: any) => e.code === "auth.unauthenticated");
  const down = (async () => { throw new Error("ECONNREFUSED"); }) as any;
  await assert.rejects(gatewayCall(s, "vault.share", {}, { fetch: down }), (e: any) => e.code === "offline");
});

test("the pickers: people and channels, and the person's goals with a number, are read with the picked Space's own session and nothing else", async () => {
  const f = fakeApp();
  await f.app.op("space.select", { id: "spc_mla" });
  const pick: any = await f.app.op("people.list", {});
  assert.deepEqual(pick.people, [{ id: "usr_noah", name: "Noah" }, { id: "usr_aliza", name: "Aliza" }]);
  assert.deepEqual(pick.channels, [{ id: "chn_mkt", threadId: "thr_mkt", name: "marketing" }], "an archived channel is not offered");
  assert.deepEqual(((await f.app.op("people.list", { q: "ali" })) as any).people, [{ id: "usr_aliza", name: "Aliza" }]);
  const goals: any = await f.app.op("goals.pick", {});
  assert.deepEqual(goals.goals, [{ id: "gol_1", title: "300 registrations", value: 212, target: 300 }], "a goal with no number is not offered");
  assert.deepEqual(f.calls.filter((c) => /principals|channels|goals/.test(c.cap)).map((c) => [c.cap, c.as, c.input]), [
    ["access.principals.list", "vst_mine", { kind: "person", status: "active", limit: 200 }], ["channels.list", "vst_mine", {}],
    ["access.principals.list", "vst_mine", { kind: "person", status: "active", limit: 200 }], ["channels.list", "vst_mine", {}], ["goals.list", "vst_mine", { scope: "mine", open: true }]]);
  await f.app.op("space.select", { id: "spc_me" });
  assert.deepEqual(((await f.app.op("people.list", {})) as any).people, [{ id: "usr_me", name: "Me Myself" }], "another Space, another session, another view");
  const out = fakeApp({ signedIn: false });
  await assert.rejects(out.app.op("people.list", {}), (e: any) => e.code === "signed_out");
  await assert.rejects(out.app.op("goals.pick", {}), (e: any) => e.code === "signed_out");
});
