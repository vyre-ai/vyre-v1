// "Show Vyre how" and "Watch a page" against fakes: the recorder's steps (a sign-in collapses to one step and no password is ever kept), the review edits, the skill that comes
// out of a recording (SKILL.md that Vyre's own parser accepts, replay.json with the browsing tools, nothing a person marked "ask each time"), the watch worker's reading and
// reporting, the page readers run against a small stand-in for a document, and the parts the side panel and the worker share. The same parts in a real Chromium are in
// ext-show-watch.e2e.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { createRecorder, MAX_STEPS } from "../src/worker/record.js";
import { applyEdits, buildSkill, cleanUrl, inputsOf, keyOf, replayOf, skillName, words } from "../src/worker/skill.js";
import { createWatches, readRegion } from "../src/worker/watch.js";
import { FREQS, agoWords, freqLabel, runsOnFor, watchLine } from "../src/ui/watch-model.js";
import { createPrivacy } from "../src/worker/privacy.js";
import { createStore } from "../src/worker/store.js";
import { parseSkill } from "../../../lib/skill-md.ts";
import { skillPerms } from "../../../lib/skill-import.ts";
import { CAPABILITIES, request } from "../src/worker/protocol.js";

const memory = () => { const d: Record<string, unknown> = {}; return { async get(k: string[]) { return Object.fromEntries(k.filter((x) => x in d).map((x) => [x, d[x]])); }, async set(i: Record<string, unknown>) { Object.assign(d, i); }, async remove(k: string[]) { for (const x of k) delete d[x]; } }; };
const never = async (hosts: string[] = []) => { const store = createStore(memory()); const p = createPrivacy(store); for (const h of hosts) await p.set(h, { mode: "never" }); return p; };

function fakeExt() {
  const sent: any[] = [];
  const injected: any[] = [];
  const created: string[] = [];
  const session = memory();
  let clock = 1_000_000;
  const ext: any = {
    storage: { session },
    tabs: { async sendMessage(id: number, m: any) { sent.push({ id, m }); }, async create(o: any) { created.push(o.url); return { id: 99, ...o }; }, async get(id: number) { return { id, active: true, url: "https://x.test/", windowId: 1 }; } },
    scripting: { async executeScript(o: any) { injected.push(o); return []; } },
    runtime: { getURL: (p: string) => `chrome-extension://abc/${p}` },
  };
  return { ext, sent, injected, created, tick: (ms = 1000) => { clock += ms; return clock; }, now: () => clock };
}
const TAB = { id: 5, url: "https://lu.ma/event/guests", incognito: false, windowId: 1 };

async function recorder(o: { hosts?: string[]; bridge?: any } = {}) {
  const f = fakeExt();
  const calls: any[] = [];
  const bridge = o.bridge ?? { async invoke(c: string, i: any) { calls.push({ c, i }); if (c === "skills.mine.add") return { skill: { skillId: "sko_1", name: i.text.match(/^name: (.*)$/m)[1] } }; return {}; }, async op(op: string, i: any) { calls.push({ op, i }); return { threadId: "thr_9" }; } };
  const r = createRecorder({ ext: f.ext, bridge, privacy: await never(o.hosts), now: f.now, sleep: async () => {}, shot: async () => ({ dataUrl: "data:image/jpeg;base64,QUJD" }) as any });
  return { r, f, calls };
}

// ---------- the skill

test("a step in plain words: an input asked for each time is a name in braces, a fixed one is the value, a secret is always asked for", () => {
  const inputs = [{ key: "contact_name", label: "Contact name", example: "Daniel Okafor", mode: "ask" as const }, { key: "tag", label: "Tag", example: "lab-8", mode: "fixed" as const }];
  const t = { role: "textbox", name: "Name" };
  assert.equal(words({ id: "s1", kind: "type", url: "https://a.test/", host: "a.test", target: t, key: "contact_name", value: "Daniel Okafor", at: 0 }, inputs), "Type {contact name} in \"Name\"");
  assert.equal(words({ id: "s2", kind: "type", url: "https://a.test/", host: "a.test", target: { role: "textbox", name: "Tag" }, key: "tag", value: "lab-8", at: 0 }, inputs), "Type \"lab-8\" in \"Tag\"");
  assert.equal(words({ id: "s3", kind: "click", url: "https://a.test/", host: "a.test", target: { role: "button", name: "Save" }, at: 0 }, inputs), "Click the button \"Save\"");
  assert.equal(words({ id: "s4", kind: "signin", url: "https://app.gohighlevel.com/login", host: "app.gohighlevel.com", at: 0 }, inputs), "Sign in to app.gohighlevel.com with Vault");
  assert.equal(words({ id: "s5", kind: "open", url: "https://lu.ma/event/guests?x=1", host: "lu.ma", at: 0 }, inputs), "Open lu.ma/event/guests");
  assert.equal(words({ id: "s6", kind: "type", url: "https://a.test/", host: "a.test", target: { role: "textbox", name: "Card number" }, value: "", secret: true, at: 0 }, []), "Type {card number} in \"Card number\"");
  assert.equal(keyOf("Contact name!"), "contact_name");
  assert.equal(skillName("Add a Lab registrant to GHL"), "add-a-lab-registrant-to-ghl");
});

test("an address is kept without its fragment, a login in it, or a query value that looks like a secret", () => {
  assert.equal(cleanUrl("https://app.test/new?email=a%40b.co&password=hunter2&token=abc&page=2#frag"), "https://app.test/new?email=a%40b.co&page=2");
  assert.equal(cleanUrl("https://user:pw@app.test/x?sessionId=1&api_key=2&id=7"), "https://app.test/x?id=7");
  assert.equal(cleanUrl("not a url"), "not a url");
});

const REC = () => ({
  id: "rec_1", name: "Add a Lab registrant to GHL", startedAt: 1_000_000, endedAt: 1_100_000,
  steps: [
    { id: "s1", kind: "open", url: "https://lu.ma/event/guests", host: "lu.ma", at: 1 },
    { id: "s2", kind: "click", url: "https://lu.ma/event/guests", host: "lu.ma", target: { role: "link", name: "Daniel Okafor" }, at: 2 },
    { id: "s3", kind: "signin", url: "https://app.gohighlevel.com/login", host: "app.gohighlevel.com", at: 3 },
    { id: "s4", kind: "type", url: "https://app.gohighlevel.com/new", host: "app.gohighlevel.com", target: { role: "textbox", name: "Email" }, value: "dokafor@okaforinjury.com", at: 4 },
    { id: "s5", kind: "click", url: "https://app.gohighlevel.com/new", host: "app.gohighlevel.com", target: { role: "button", name: "Save" }, at: 5 },
  ] as any[], inputs: [] as any[],
});

test("a recording becomes a skill Vyre's own parser accepts: plain steps, replay.json with the browsing tools, no script file, and nothing asked for each time", () => {
  const rec = REC();
  rec.inputs = inputsOf(rec.steps);
  assert.deepEqual(rec.inputs, [{ key: "email", label: "Email", example: "dokafor@okaforinjury.com", mode: "ask" }]);
  rec.steps[4].ask = true;
  const sk = buildSkill(rec as any);
  assert.equal(sk.name, "add-a-lab-registrant-to-ghl");
  const parsed = parseSkill(sk.text);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  if (parsed.ok) assert.deepEqual([parsed.skill.name, /lu\.ma, app\.gohighlevel\.com/.test(parsed.skill.description), /Ask for email/.test(parsed.skill.description)], ["add-a-lab-registrant-to-ghl", true, true]);
  assert.match(sk.text, /3\. Sign in to app\.gohighlevel\.com with Vault/);
  assert.match(sk.text, /4\. Type \{email\} in "Email"/);
  assert.match(sk.text, /5\. Click the button "Save" \(ask the person first and wait for yes\)/);
  assert.ok(!sk.text.includes("dokafor") || /It was "dokafor/.test(sk.text), "the example is named once as an example, not used as a step");
  assert.deepEqual(Object.keys(sk.files), ["replay.json"]);
  const replay = JSON.parse(sk.files["replay.json"]!);
  assert.deepEqual(replay.steps.map((s: any) => s.tool), ["chrome_open", "chrome_click", "vault_signin", "chrome_type", "chrome_click"]);
  assert.deepEqual(replay.steps[1].find, { role: "link", name: "Daniel Okafor" });
  assert.deepEqual([replay.steps[3].input, replay.steps[3].text], ["email", undefined], "asked for each time: the step names the input, not the value");
  assert.equal(replay.steps[4].askFirst, true);
  assert.equal(JSON.stringify(replay).includes("hunter2"), false);
  const perms = skillPerms(sk.text, sk.files);
  assert.deepEqual([perms.scripts, perms.mcpServers, perms.vaultKeys], [[], [], []], "it asks nothing of an admin: no script, no server, no Vault key named");
});

test("a fixed input is typed as written; a card number has no example and is always asked for", () => {
  const rec = REC() as any;
  rec.steps.push({ id: "s6", kind: "type", url: "https://pay.test/", host: "pay.test", target: { role: "textbox", name: "Card number" }, value: "", secret: true, at: 6 });
  rec.inputs = inputsOf(rec.steps);
  const card = rec.inputs.find((i: any) => i.key === "card_number");
  assert.deepEqual([card.example, card.mode], ["", "ask"]);
  const next = applyEdits(rec, { inputs: { email: { mode: "fixed" }, card_number: { mode: "fixed" } } });
  assert.equal(next.inputs.find((i: any) => i.key === "card_number")!.mode, "ask", "a secret cannot be made fixed");
  const replay = replayOf(next);
  assert.deepEqual([replay.steps[3].text, replay.steps[3].input], ["dokafor@okaforinjury.com", undefined]);
  assert.deepEqual([replay.steps[5].input, replay.steps[5].text], ["card_number", undefined]);
});

test("the review's edits: rename, delete a step, mark one to ask first; inputs follow the steps that are left", () => {
  const rec = REC() as any;
  rec.inputs = inputsOf(rec.steps);
  const a = applyEdits(rec, { name: "  Lab registrant  ", remove: ["s4"], ask: { s5: true } });
  assert.deepEqual([a.name, a.steps.map((s: any) => s.id), a.steps[3].ask, a.inputs], ["Lab registrant", ["s1", "s2", "s3", "s5"], true, []]);
  const b = applyEdits(rec, { inputs: { email: { label: "Work email", mode: "fixed", example: "a@b.co" } } });
  assert.deepEqual(b.inputs, [{ key: "email", label: "Work email", example: "a@b.co", mode: "fixed" }]);
  assert.equal(rec.steps.length, 5, "the recording itself is not changed");
});

// ---------- the recorder

test("a recording: an open step, clicks and typing in order with a masked picture each; Stop opens the review with the steps", async () => {
  const { r, f } = await recorder();
  const { id } = await r.start(TAB, { name: "Add a Lab registrant" });
  assert.deepEqual(f.injected[0].files, ["src/content/record.js"]);
  await r.step(5, TAB, { kind: "click", url: TAB.url, target: { role: "link", name: "Daniel Okafor" } });
  await r.step(5, TAB, { kind: "type", url: "https://app.gohighlevel.com/new", target: { role: "textbox", name: "Email" }, value: "d@o.com" });
  await r.step(5, TAB, { kind: "type", url: "https://app.gohighlevel.com/new", target: { role: "textbox", name: "Email" }, value: "dokafor@o.com" });
  const done: any = await r.control("stop");
  assert.equal(done.id, id);
  assert.match(f.created[0]!, /^chrome-extension:\/\/abc\/src\/review\/review\.html\?rec=rec_/);
  const got: any = await r.get(id);
  assert.deepEqual(got.rec.steps.map((s: any) => s.kind), ["open", "click", "type"], "typing again in the same field replaces the value");
  assert.equal(got.rec.steps[2].value, "dokafor@o.com");
  assert.equal(got.rec.steps[1].shot, "data:image/jpeg;base64,QUJD");
  assert.deepEqual(got.words, ["Open lu.ma/event/guests", "Click the link \"Daniel Okafor\"", "Type {email} in \"Email\""]);
  assert.equal(f.sent.at(-1).m.done, true, "the bar is told to go away");
});

test("a login is one step, 'Sign in with Vault': the username typed before it goes, the password is never kept, and the Sign in button is part of it", async () => {
  const { r } = await recorder();
  const { id } = await r.start({ ...TAB, url: "https://app.gohighlevel.com/login" });
  const L = "https://app.gohighlevel.com/login";
  await r.step(5, TAB, { kind: "type", url: L, target: { role: "textbox", name: "Email", type: "email" }, value: "techmanager@mylegalacademy.com" });
  await r.step(5, TAB, { kind: "secret", url: L, what: "password", target: { role: "textbox", name: "Password" } });
  await r.step(5, TAB, { kind: "secret", url: L, what: "password", target: { role: "textbox", name: "Password" }, enter: true });
  await r.step(5, TAB, { kind: "click", url: L, target: { role: "button", name: "Sign in" }, submit: true });
  await r.step(5, TAB, { kind: "click", url: "https://app.gohighlevel.com/contacts", target: { role: "button", name: "Add contact" } });
  await r.control("stop");
  const rec = (await r.get(id) as any).rec;
  assert.deepEqual(rec.steps.map((s: any) => s.kind), ["open", "signin", "click"]);
  assert.equal(JSON.stringify(rec).includes("techmanager"), false, "the username that belonged to the sign-in is not kept either");
  assert.equal(JSON.stringify(rec).includes("password\":"), false);
  assert.deepEqual((await r.get(id) as any).words[1], "Sign in to app.gohighlevel.com with Vault");
});

test("a card number is a step with no value that is asked for each time", async () => {
  const { r } = await recorder();
  const { id } = await r.start(TAB);
  await r.step(5, TAB, { kind: "secret", url: TAB.url, what: "card", target: { role: "textbox", name: "Card number" } });
  await r.step(5, TAB, { kind: "secret", url: TAB.url, what: "card", target: { role: "textbox", name: "Card number" } });
  await r.control("stop");
  const rec = (await r.get(id) as any).rec;
  assert.deepEqual(rec.steps.map((s: any) => [s.kind, s.secret, s.value]), [["open", undefined, undefined], ["type", true, ""]]);
  assert.deepEqual(rec.inputs, [{ key: "card_number", label: "Card number", example: "", mode: "ask" }]);
});

test("paused records nothing; incognito and a never-site cannot be recorded; a page that is never sent mid-way is skipped; a second recording waits for the first", async () => {
  const { r } = await recorder({ hosts: ["bank.test"] });
  await assert.rejects(r.start({ ...TAB, incognito: true }), (e: any) => e.code === "incognito");
  await assert.rejects(r.start({ ...TAB, url: "https://bank.test/" }), (e: any) => e.code === "never_site");
  await r.start(TAB);
  await assert.rejects(r.start(TAB), /already running/);
  await r.control("pause");
  await r.step(5, TAB, { kind: "click", url: TAB.url, target: { role: "button", name: "Nope" } });
  await r.control("resume");
  await r.step(5, { ...TAB, url: "https://bank.test/x" }, { kind: "click", url: "https://bank.test/x", target: { role: "button", name: "Transfer" } });
  await r.step(5, TAB, { kind: "click", url: TAB.url, target: { role: "button", name: "Yes" } });
  await r.step(77, TAB, { kind: "click", url: TAB.url, target: { role: "button", name: "Other tab" } });
  const id = ((await r.control("stop")) as any).id;
  assert.deepEqual((await r.get(id) as any).words, ["Open lu.ma/event/guests", "Click the button \"Yes\""]);
});

test("a change of address nobody caused is a step; one that follows a click is its result; a link opened in a new tab is recorded too", async () => {
  const { r, f } = await recorder();
  const { id } = await r.start(TAB);
  f.tick(5000);
  await r.tabUpdated(5, { url: "https://lu.ma/dashboard" }, TAB);
  await r.step(5, TAB, { kind: "click", url: "https://lu.ma/dashboard", target: { role: "link", name: "Guests" } });
  f.tick(300);
  await r.tabUpdated(5, { url: "https://lu.ma/guests" }, TAB);
  await r.tabCreated({ id: 8, openerTabId: 5 });
  await r.step(8, { ...TAB, id: 8, url: "https://app.gohighlevel.com/" }, { kind: "click", url: "https://app.gohighlevel.com/", target: { role: "button", name: "Add contact" } });
  await r.control("stop");
  assert.deepEqual(((await r.get(id)) as any).words, ["Open lu.ma/event/guests", "Open lu.ma/dashboard", "Click the link \"Guests\"", "Click the button \"Add contact\""]);
});

test("a recording stops growing at the step limit, and survives the worker being stopped between two steps", async () => {
  const { r, f } = await recorder();
  await r.start(TAB);
  for (let i = 0; i < MAX_STEPS + 5; i++) await r.step(5, TAB, { kind: "click", url: TAB.url, target: { role: "button", name: `B${i}` } });
  assert.equal(((await r.state()) as any).count, MAX_STEPS);
  // a new recorder on the same session storage picks the running recording up
  const again = createRecorder({ ext: f.ext, bridge: {} as any, privacy: await never(), now: f.now, sleep: async () => {}, shot: async () => null });
  assert.deepEqual(await again.state(), { running: true, paused: false, count: MAX_STEPS, name: "Task on lu.ma", secret: false });
});

test("Save as skill adds it as the person's own skill through skills.mine.add; Add to my agents, Share and Try it use the skills sharing; a replaced save replaces", async () => {
  const { r, calls } = await recorder();
  const { id } = await r.start(TAB, { name: "Add a Lab registrant" });
  await r.step(5, TAB, { kind: "type", url: TAB.url, target: { role: "textbox", name: "Email" }, value: "d@o.com" });
  await r.control("stop");
  await assert.rejects(r.addToAgents(id), /Save the skill first/);
  const saved: any = await r.save(id, { agents: ["agt_scout"] });
  const add = calls.find((c) => c.c === "skills.mine.add")!.i;
  assert.deepEqual([add.source, add.agents, Object.keys(add.files)], ["chrome:recording", ["agt_scout"], ["replay.json"]]);
  assert.ok(parseSkill(add.text).ok);
  assert.deepEqual(saved.saved, { skillId: "sko_1", name: "add-a-lab-registrant", agents: ["agt_scout"] });
  await r.addToAgents(id);
  assert.deepEqual(calls.find((c) => c.c === "skills.mine.set")!.i, { skillId: "sko_1", enabled: true, agents: ["*"] });
  await r.share(id, { space: true });
  assert.deepEqual(calls.find((c) => c.c === "skills.share")!.i, { skillId: "sko_1", space: true });
  await r.share(id, { stop: true });
  assert.deepEqual(calls.filter((c) => c.c === "skills.share")[1]!.i, { skillId: "sko_1", stop: true });
  const tried: any = await r.tryIt(id, "agt_scout");
  assert.equal(tried.threadId, "thr_9");
  assert.match(calls.find((c) => c.op === "chat.ask")!.i.text, /Run the skill "add-a-lab-registrant"/);
  await r.save(id, { agents: ["agt_scout"] });
  assert.equal(calls.filter((c) => c.c === "skills.mine.add")[1]!.i.replaces, "sko_1", "saving again replaces the skill, it does not make a second one");
  await r.discard(id);
  await assert.rejects(r.get(id), /gone/);
});

test("a recording with every step deleted cannot be saved", async () => {
  const { r } = await recorder();
  const { id } = await r.start(TAB);
  await r.control("stop");
  await r.edit(id, { remove: ["s1"] });
  await assert.rejects(r.save(id), /nothing to save/);
});

// ---------- the pages' readers

function fakeDoc(html: { body?: string; sel?: Record<string, { tag?: string; text: string }> }) {
  const mk = (tag: string, text: string) => ({ tagName: tag, innerText: text, textContent: text });
  (globalThis as any).document = { body: html.body === undefined ? null : mk("BODY", html.body), querySelector: (s: string) => { if (s === "!!") throw new Error("bad"); const e = html.sel?.[s]; return e ? mk(e.tag ?? "DIV", e.text) : null; } };
}

test("reading a page: the part, or the whole page; a field's value is never read; a part that is gone or cannot be found again says so", async () => {
  fakeDoc({ body: "Lab 8   registrations\n 3,412 going", sel: { "#going": { text: " 3,412\n going " }, "#email": { tag: "INPUT", text: "secret@x.com" } } });
  assert.deepEqual(await readRegion({ selector: "#going" }, 50, 1000), { ok: true, text: "3,412 going" });
  assert.deepEqual(await readRegion(null, 50, 1000), { ok: true, text: "Lab 8 registrations 3,412 going" });
  assert.deepEqual(await readRegion({ selector: "#email" }, 50, 1000), { ok: true, text: "" });
  assert.match((await readRegion({ selector: "#gone" }, 300, 1000) as any).error, /not on the page/);
  assert.match((await readRegion({ selector: "!!" }, 50, 1000) as any).error, /Pick it again/);
  assert.deepEqual(await readRegion({ selector: "#going" }, 50, 5), { ok: true, text: "3,412" }, "cut at the longest reading");
  delete (globalThis as any).document;
});

// ---------- watching

function watchWorld(o: { hosts?: string[]; read?: any; list?: any[] } = {}) {
  const calls: { c: string; i: any }[] = [];
  const removed: number[] = [];
  const listeners = new Set<any>();
  const ext: any = {
    tabs: {
      async create(x: any) { return { id: 41, ...x }; }, async remove(id: number) { removed.push(id); }, async get() { return { status: "complete", url: "https://lu.ma/x" }; },
      onUpdated: { addListener: (f: any) => listeners.add(f), removeListener: (f: any) => listeners.delete(f) },
    },
    scripting: { async executeScript(x: any) { calls.push({ c: "script", i: x }); return [{ result: o.read ?? { ok: true, text: "3,412 going" } }]; } },
  };
  const bridge = {
    async invoke(c: string, i: any) {
      calls.push({ c, i });
      if (c === "automations.watches.list") return { watches: o.list ?? [] };
      if (c === "automations.watches.report") return { changed: i.value === "3,500 going", watch: {} };
      if (c === "automations.watches.save") return { watch: { watchId: "wch_1", ...i } };
      return {};
    },
    async op() { return {}; },
  };
  return privacy(o.hosts).then((p) => ({ w: createWatches({ ext, bridge, privacy: p, now: () => 5_000_000 }), calls, removed }));
}
const privacy = (h?: string[]) => never(h);
const W = { watchId: "wch_1", title: "Lab 8", url: "https://lu.ma/mla-ai-lab-8", mode: "region", region: { label: "Guest count", selector: "#going" }, state: "on", runsOn: "chrome", everyMinutes: 30 };

test("a watch in this Chrome: the due ones are read in a background tab that is closed again, and what was read is reported; paused and not-yet-due ones are left alone", async () => {
  const { w, calls, removed } = await watchWorld({ list: [{ ...W }, { ...W, watchId: "wch_2", state: "paused" }, { ...W, watchId: "wch_3", nextDueAt: 9_000_000 }, { ...W, watchId: "wch_4", nextDueAt: 9_000_000, checkNow: true }] });
  const r = await w.look();
  assert.equal(r.checked, 2);
  assert.deepEqual(calls.filter((c) => c.c === "automations.watches.report").map((c) => c.i), [{ watchId: "wch_1", value: "3,412 going" }, { watchId: "wch_4", value: "3,412 going" }]);
  assert.deepEqual(removed, [41, 41], "each background tab is closed");
  assert.deepEqual(calls.find((c) => c.c === "script")!.i.args, [{ selector: "#going" }, 6000, 20000]);
  assert.deepEqual(calls[0]!.i, { runsOn: "chrome" });
});

test("a page that cannot be read is reported with the reason; a never-site is not opened at all", async () => {
  const bad = await watchWorld({ read: { ok: false, error: "The part to watch is not on the page. It may have moved: pick it again." }, list: [{ ...W }] });
  await bad.w.look();
  assert.deepEqual(bad.calls.find((c) => c.c === "automations.watches.report")!.i, { watchId: "wch_1", error: "The part to watch is not on the page. It may have moved: pick it again." });
  const nv = await watchWorld({ hosts: ["lu.ma"], list: [{ ...W }] });
  await nv.w.look();
  assert.equal(nv.calls.some((c) => c.c === "script"), false);
  assert.match(nv.calls.find((c) => c.c === "automations.watches.report")!.i.error, /never sent to Vyre/);
});

test("the Watch sheet saves with the part, the rhythm and where it runs, and a baseline read from the page the person is on; incognito and never-sites are refused", async () => {
  const { w, calls } = await watchWorld();
  const out: any = await w.save({ id: 5, url: "https://lu.ma/mla-ai-lab-8", title: "AI Lab 8", incognito: false }, { mode: "region", region: { label: "Guest count", selector: "#going" }, everyMinutes: 30, agentId: "agt_ops", runsOn: "computer" });
  const save = calls.find((c) => c.c === "automations.watches.save")!.i;
  assert.deepEqual(save, { title: "AI Lab 8", url: "https://lu.ma/mla-ai-lab-8", mode: "region", region: { label: "Guest count", selector: "#going" }, everyMinutes: 30, runsOn: "computer", agentId: "agt_ops", value: "3,412 going" });
  assert.equal(out.watch.watchId, "wch_1");
  await assert.rejects(w.save({ id: 5, url: "https://lu.ma/x", incognito: true }, { mode: "page", everyMinutes: 60, runsOn: "chrome" }), (e: any) => e.code === "incognito");
  const nv = await watchWorld({ hosts: ["lu.ma"] });
  await assert.rejects(nv.w.save({ id: 5, url: "https://lu.ma/x", incognito: false }, { mode: "page", everyMinutes: 60, runsOn: "chrome" }), (e: any) => e.code === "never_site");
  await assert.rejects(nv.w.pick({ id: 5, url: "https://lu.ma/x", incognito: false }), (e: any) => e.code === "never_site");
});

test("Check now: here for a watch that runs here, else the app wakes the agent", async () => {
  const here = await watchWorld({ list: [{ ...W }] });
  assert.equal(((await here.w.checkNow("wch_1")) as any).ok, true);
  assert.equal(here.calls.some((c) => c.c === "automations.watches.check"), false);
  const there = await watchWorld({ list: [{ ...W, runsOn: "computer" }] });
  assert.deepEqual(await there.w.checkNow("wch_1"), { ok: true, changed: false, woke: true });
  assert.deepEqual(there.calls.find((c) => c.c === "automations.watches.check")!.i, { watchId: "wch_1" });
});

test("picking a part: the answer from the page comes back once, trimmed", async () => {
  const f = fakeExt();
  const w = createWatches({ ext: f.ext, bridge: {} as any, privacy: await never() });
  const p = w.pick({ id: 5, url: "https://lu.ma/x", incognito: false });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(f.injected[0].files, ["src/content/pick.js"]);
  assert.equal(w.picked(5, { region: { selector: "#going", label: "Guest count", text: "3,412 going" } }), true);
  assert.deepEqual(await p, { selector: "#going", label: "Guest count", text: "3,412 going" });
  assert.equal(w.picked(5, { region: null }), false, "nothing is waiting any more");
});

// ---------- the parts both halves share

test("rhythms, where a watch runs, and the line a watch gets in the list", () => {
  assert.deepEqual(FREQS.map((f) => f.label), ["Every 15 minutes", "Every 30 minutes", "Every hour", "Every 2 hours", "Every 6 hours", "Every day"]);
  assert.deepEqual([freqLabel(30), freqLabel(180), freqLabel(2880), freqLabel(7)], ["Every 30 minutes", "Every 3 hours", "Every 2 days", "Every 7 minutes"]);
  assert.deepEqual([runsOnFor(true, null), runsOnFor(false, null), runsOnFor(true, "chrome"), runsOnFor(false, "computer")], ["computer", "chrome", "chrome", "chrome"]);
  assert.equal(agoWords(40 * 60_000), "40 min ago");
  const now = 10_000_000_000;
  assert.equal(watchLine({ state: "on", everyMinutes: 30, lastChange: { at: now - 40 * 60_000 } }, now), "Every 30 minutes · Changed 40 min ago");
  assert.equal(watchLine({ state: "on", everyMinutes: 1440, lastCheckedAt: now - 9 * 86_400_000 }, now), "Every day · No change since 9 days ago");
  assert.equal(watchLine({ state: "paused", everyMinutes: 60 }, now), "Paused");
  assert.equal(watchLine({ state: "error", everyMinutes: 60, error: "timed out" }, now), "Can't read it: timed out");
});

test("the extension asks only for the capabilities the app declares for this", () => {
  for (const c of ["skills.mine.add", "skills.mine.set", "skills.share", "automations.watches.list", "automations.watches.save", "automations.watches.remove", "automations.watches.check", "automations.watches.report"]) assert.ok(c in CAPABILITIES, c);
  assert.throws(() => request("r", "invoke", "automations.watches.delete"));
});
