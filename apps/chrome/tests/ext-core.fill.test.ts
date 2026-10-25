// The extension end to end without a browser: the real service worker, the real content scripts, a fake DOM and a fake Vyre app behind
// the native messaging port. Covers: the fill command the worker sends, the value reaching the right field exactly once, no value in
// any storage area, log line or request, Never Fill, http refusal, Fill and Sign In, codes (TOTP via the filler), and save-a-login.
import test, { before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

const PASSWORD = "Tr0ub4dor&3-sentinel";
const USERNAME = "dana@acme.test";
const CODE = "482913";

// ---------- a fake DOM, just enough for the content scripts ----------

class FakeForm {
  inputs: FakeInput[] = [];
  submitted = 0;
  requestSubmit() { this.submitted++; }
  querySelectorAll() { return this.inputs; }
  querySelector() { return null; }
}

class FakeInput {
  attrs: Record<string, string>;
  form: FakeForm | null = null;
  disabled = false;
  readOnly = false;
  visible = true;
  focused = false;
  events: string[] = [];
  sets: string[] = [];
  private v = "";
  constructor(attrs: Record<string, string>) { this.attrs = attrs; }
  getAttribute(n: string) { return n in this.attrs ? this.attrs[n] : null; }
  getClientRects() { return this.visible ? [{}] : []; }
  get value() { return this.v; }
  set value(x: string) { this.v = x; this.sets.push("native"); }
  focus() { this.focused = true; }
  dispatchEvent(e: { type: string }) { this.events.push(e.type); return true; }
  closest() { return null; }
}

class FakeDocument {
  inputs: FakeInput[] = [];
  listeners: Record<string, ((e: unknown) => void)[]> = {};
  querySelectorAll(sel: string) { return sel === "input" ? this.inputs : []; }
  addEventListener(type: string, fn: (e: unknown) => void) { (this.listeners[type] ??= []).push(fn); }
  fire(type: string, e: Record<string, unknown>) { for (const fn of this.listeners[type] ?? []) fn(e); }
  page(...inputs: FakeInput[]) { this.inputs = inputs; }
}

function loginPage(doc: FakeDocument, extra: Record<string, string> = {}) {
  const form = new FakeForm();
  const user = new FakeInput({ type: "email", name: "email", autocomplete: "username", ...extra });
  const pass = new FakeInput({ type: "password", name: "password", autocomplete: "current-password" });
  user.form = pass.form = form;
  form.inputs = [user, pass];
  doc.page(user, pass);
  return { form, user, pass };
}

// ---------- a fake browser and a fake Vyre app ----------

type Msg = Record<string, any>;

class FakeApp {
  received: Msg[] = [];
  locked = false;
  pushedValues = 0;
  rules: { host: string; neverFill: boolean; neverSave: boolean }[] = [];
  login = { state: "new" as "new" | "known" | "changed", itemId: "vit_acme", name: "Acme Portal" };
  puts: Msg[] = [];
  private listeners: ((m: Msg) => void)[] = [];
  private disconnect: (() => void)[] = [];
  onMessage = { addListener: (f: (m: Msg) => void) => { this.listeners.push(f); } };
  onDisconnect = { addListener: (f: () => void) => { this.disconnect.push(f); } };
  private send(m: Msg) { queueMicrotask(() => { for (const l of this.listeners) l(m); }); }
  postMessage(m: Msg) {
    this.received.push(JSON.parse(JSON.stringify(m)));
    const reply = (output: unknown) => this.send({ id: m["id"], ok: true, output });
    if (m["type"] === "bridge") {
      if (m["op"] === "hello") return reply({ spaces: [{ id: "spc_a", name: "Acme Law", webUrl: "https://acme.vyre.run" }, { id: "spc_p", name: "Personal", webUrl: "http://localhost:8420" }], active: "spc_a", locked: this.locked });
      if (m["op"] === "login.check") return reply(this.login);
      if (m["op"] === "agents.list") return reply({ agents: [{ id: "agt_intake", name: "Intake" }], suggested: { id: "agt_intake", name: "Intake" } });
      return reply({});
    }
    const input = m["input"] as Msg;
    switch (m["capability"]) {
      case "vault.items.match":
        return reply({ items: [{ item: { id: "vit_acme", name: "Acme Portal", kind: "login", handle: "#Acme_Portal", fieldKeys: ["username", "password", "totp"] }, usernameField: "username" }] });
      case "vault.use": return reply({ handle: "#Acme_Portal", itemId: input["item"], fields: ["username", "password", "totp"] });
      case "vault.fill": {
        const field = String(input["handle"]).split(".")[1];
        const value = field === "username" ? USERNAME : field === "password" ? PASSWORD : CODE;
        this.pushedValues++;
        this.send({ type: "fill", ref: (input["target"] as Msg)["ref"], value });
        return reply({ filled: true, field, where: "device" });
      }
      case "vault.site_rules.list": return reply({ sites: this.rules.map((r) => ({ ...r, at: 0 })) });
      case "vault.site_rules.set": {
        this.rules = [...this.rules.filter((r) => r.host !== input["host"]), { host: String(input["host"]), neverFill: Boolean(input["neverFill"]), neverSave: Boolean(input["neverSave"]) }];
        return reply(input);
      }
      case "vault.folders.list": return reply({ folders: [{ id: "vfo_mine", name: "Mine", yourLevel: "manage" }] });
      case "vault.item.put": this.puts.push(input); return reply({ item: { id: "vit_new" } });
      case "vault.item.update": this.puts.push(input); return reply({ item: { id: String(input["itemId"]) } });
      case "vault.share": return reply({ granted: true });
      default: return reply({});
    }
  }
  disconnectPort() { for (const f of this.disconnect) f(); }
}

function area() {
  const data: Record<string, unknown> = {};
  const writes: string[] = [];
  return {
    data, writes,
    api: {
      async get(keys: string[]) { const out: Record<string, unknown> = {}; for (const k of keys) if (k in data) out[k] = data[k]; return out; },
      async set(items: Record<string, unknown>) { Object.assign(data, items); writes.push(JSON.stringify(items)); },
      async remove(keys: string[]) { for (const k of keys) delete data[k]; },
    },
  };
}

function makeBrowser(app: FakeApp, tab: { id: number; url: string; title?: string }) {
  const local = area(), session = area(), sync = area();
  const badges: { text: string }[] = [];
  const created: { url: string }[] = [];
  const shown: Record<string, any>[] = [];
  const ext = {
    runtime: { id: "ext_vyre", lastError: undefined, connectNative: () => app },
    storage: { local: local.api, session: session.api, sync: sync.api },
    tabs: { query: async () => [tab], get: async () => tab, create: async (o: { url: string }) => { created.push(o); } },
    action: { setBadgeText: async (o: { text: string }) => { badges.push(o); }, setBadgeBackgroundColor: async () => {} },
    scripting: {
      async executeScript(o: { target: { tabId: number; allFrames?: boolean; frameIds?: number[] }; func: (...a: any[]) => any; args: any[] }) {
        const result = o.func(...o.args);
        return [{ frameId: o.target.frameIds ? o.target.frameIds[0] : 0, result }];
      },
    },
  };
  return { ext, areas: { local, session, sync }, badges, created, shown };
}

// ---------- shared setup ----------

const doc = new FakeDocument();
const logged: string[] = [];
const realConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
let ns: any;
let realPrompt: any;
const sent: Msg[] = [];

before(async () => {
  (globalThis as any).document = doc;
  (globalThis as any).chrome = { runtime: { sendMessage: (m: Msg) => { sent.push(m); } } };
  await import("../src/content/finder.js");
  await import("../src/content/autofill.js");
  await import("../src/content/capture.js");
  await import("../src/content/prompt.js");
  ns = (globalThis as any).__vyreExt;
  realPrompt = ns.prompt;
});

beforeEach(() => {
  logged.length = 0;
  sent.length = 0;
  for (const k of Object.keys(realConsole) as (keyof typeof realConsole)[]) (console as any)[k] = (...a: unknown[]) => { logged.push(a.map(String).join(" ")); };
});

afterEach(() => {
  Object.assign(console, realConsole);
  ns.prompt = realPrompt;
});

async function worker(app: FakeApp, url = "https://login.acme.test/signin") {
  const { createWorker } = await import("../src/worker/index.js");
  const b = makeBrowser(app, { id: 7, url, title: "Acme sign in" });
  return { w: createWorker(b.ext), ...b };
}

const sender = { id: "ext_vyre" };
const popup = (w: any, msg: Msg) => w.onMessage(msg, sender);

function assertNoValueAnywhere(b: { areas: Record<string, { writes: string[]; data: object }> }, app: FakeApp, values: string[]) {
  const hay = [JSON.stringify(Object.values(b.areas).map((a) => a.data)), ...Object.values(b.areas).flatMap((a) => a.writes), ...logged];
  for (const v of values) {
    for (const h of hay) assert.ok(!h.includes(v), `a stored or logged string contains a secret value`);
  }
  const toApp = JSON.stringify(app.received);
  for (const v of values) assert.ok(!toApp.includes(v), "the worker sent a secret value to the app");
}

// ---------- fill ----------

test("popup state lists logins for the page by item name, and the badge counts them", async () => {
  const app = new FakeApp();
  loginPage(doc);
  const { w, badges } = await worker(app);
  const r = await popup(w, { type: "popup.state" });
  assert.equal(r.data.status, "online");
  assert.equal(r.data.page.host, "login.acme.test");
  assert.deepEqual(r.data.rows.map((x: any) => x.name), ["Acme Portal"]);
  assert.ok(!JSON.stringify(r.data).includes(USERNAME), "the popup is never given a username");
  assert.equal(badges.at(-1)?.text, "1");
  // only the page's origin went out to find matches, not its path
  const match = app.received.find((m) => m["capability"] === "vault.items.match")!;
  assert.deepEqual(match["input"], { url: "https://login.acme.test" });
});

test("fill sends the fill command for each field and the value lands in the field once, never at rest", async () => {
  const app = new FakeApp();
  const { user, pass } = loginPage(doc);
  const b = await worker(app);
  const r = await popup(b.w, { type: "popup.fill", itemId: "vit_acme", usernameField: "username", kind: "login", signIn: false });
  assert.deepEqual(r.data, { filled: ["username", "password"], signedIn: false });
  assert.equal(user.value, USERNAME);
  assert.equal(pass.value, PASSWORD);
  assert.deepEqual(pass.events, ["input", "change"], "page frameworks are told, once");
  assert.equal(pass.sets.length, 1);

  const fills = app.received.filter((m) => m["capability"] === "vault.fill");
  assert.equal(fills.length, 2);
  assert.deepEqual(fills.map((m) => m["input"].handle), ["#Acme_Portal.username", "#Acme_Portal.password"]);
  for (const f of fills) {
    assert.equal(f["input"].target.kind, "browser");
    assert.match(f["input"].target.ref, /^w\d+-[0-9a-f]{24}$/);
  }
  const used = app.received.find((m) => m["capability"] === "vault.use")!;
  assert.deepEqual(used["input"], { item: "vit_acme", purpose: "fill login.acme.test" });
  assert.equal(b.w.fill.pendingRefs, 0, "every ref is spent");
  assertNoValueAnywhere(b, app, [PASSWORD, USERNAME, CODE]);
});

test("a value pushed for an unknown or spent ref goes nowhere", async () => {
  const app = new FakeApp();
  const { pass } = loginPage(doc);
  const b = await worker(app);
  await popup(b.w, { type: "popup.fill", itemId: "vit_acme", kind: "login" });
  pass.sets.length = 0;
  pass.events.length = 0;
  await b.w.fill.deliver({ type: "fill", ref: "w1-000000000000000000000000", value: "intruder" });
  assert.equal(pass.sets.length, 0);
  assert.equal(pass.value, PASSWORD);
});

test("a ref that expired before the filler answered is dropped", async () => {
  const { createFill } = await import("../src/worker/fill.js");
  let clock = 1000;
  const pushes: ((m: Msg) => void)[] = [];
  const applied: unknown[] = [];
  let mintedRef = "";
  let release: (v: unknown) => void = () => {};
  const f = createFill({
    bridge: {
      onPush: (h: (m: Msg) => void) => { pushes.push(h); return () => {}; },
      invoke: async (c: string, i: Msg) => {
        if (c === "vault.use") return { handle: "#X", fields: ["password"] };
        mintedRef = i["target"].ref;
        return new Promise((r) => { release = r; });
      },
    },
    scripting: {
      executeScript: async (o: any) => {
        if (o.func.name === "applyInPage") applied.push(o.args);
        return [{ frameId: 0, result: o.func.name === "prepareInPage" ? { fields: [{ ref: "p1", role: "password" }], signup: false } : true }];
      },
    },
    rules: { forHost: async () => null },
    now: () => clock,
    waitMs: 20,
  });
  const job = f.fill({ tabId: 1, url: "https://acme.test/", itemId: "vit_x" });
  await new Promise((r) => setTimeout(r, 0));
  assert.match(mintedRef, /^w\d+-/);
  clock += 60_000;
  await f.deliver({ type: "fill", ref: mintedRef, value: "late-value" });
  assert.equal(applied.length, 0, "an expired ref fills nothing");
  release({ filled: true });
  assert.deepEqual((await job).filled, [], "and the field is not reported as filled");
});

test("Never Fill on This Site stops the fill and the list; the rule covers subdomains", async () => {
  const app = new FakeApp();
  app.rules = [{ host: "acme.test", neverFill: true, neverSave: false }];
  loginPage(doc);
  const b = await worker(app);
  const state = await popup(b.w, { type: "popup.state" });
  assert.equal(state.data.blocked, "never_fill");
  assert.deepEqual(state.data.rows, []);
  const r = await popup(b.w, { type: "popup.fill", itemId: "vit_acme", kind: "login" });
  assert.equal(r.error.code, "never_fill");
  assert.equal(app.received.filter((m) => m["capability"] === "vault.fill").length, 0, "no fill command is ever sent");
});

test("the menu's Never Fill sets the site rule through the Vault and keeps Never Save as it was", async () => {
  const app = new FakeApp();
  app.rules = [{ host: "login.acme.test", neverFill: false, neverSave: true }];
  loginPage(doc);
  const b = await worker(app);
  const r = await popup(b.w, { type: "popup.neverFill", on: true });
  assert.deepEqual(r.data, { host: "login.acme.test", neverFill: true });
  const set = app.received.find((m) => m["capability"] === "vault.site_rules.set")!;
  assert.deepEqual(set["input"], { host: "login.acme.test", neverFill: true, neverSave: true });
});

test("an http page is never filled, but localhost is", async () => {
  const app = new FakeApp();
  loginPage(doc);
  const http = await worker(app, "http://login.acme.test/signin");
  const r = await popup(http.w, { type: "popup.fill", itemId: "vit_acme", kind: "login" });
  assert.equal(r.error.code, "insecure");
  assert.equal(app.received.filter((m) => m["capability"] === "vault.fill").length, 0);

  const local = await worker(new FakeApp(), "http://localhost:3000/login");
  const ok = await popup(local.w, { type: "popup.fill", itemId: "vit_acme", kind: "login" });
  assert.deepEqual(ok.data.filled, ["username", "password"]);
});

test("Fill and Sign In presses sign in after the password is in", async () => {
  const app = new FakeApp();
  const { form, pass } = loginPage(doc);
  const b = await worker(app);
  const r = await popup(b.w, { type: "popup.fill", itemId: "vit_acme", usernameField: "username", kind: "login", signIn: true });
  assert.equal(r.data.signedIn, true);
  assert.equal(form.submitted, 1);
  assert.equal(pass.value, PASSWORD);
});

test("a page with no sign-in field says so and sends no fill command", async () => {
  const app = new FakeApp();
  doc.page(new FakeInput({ type: "search", name: "q" }));
  const b = await worker(app);
  const r = await popup(b.w, { type: "popup.fill", itemId: "vit_acme", kind: "login" });
  assert.equal(r.error.code, "no_field");
  assert.equal(app.received.filter((m) => m["capability"] === "vault.fill").length, 0);
});

test("a one-time code field gets the code the filler computes", async () => {
  const app = new FakeApp();
  const code = new FakeInput({ type: "text", autocomplete: "one-time-code", name: "code" });
  doc.page(code);
  const b = await worker(app);
  const r = await popup(b.w, { type: "popup.fill", itemId: "vit_acme", kind: "otp" });
  assert.deepEqual(r.data.filled, ["otp"]);
  assert.equal(code.value, CODE);
  const fill = app.received.find((m) => m["capability"] === "vault.fill")!;
  assert.equal(fill["input"].handle, "#Acme_Portal.totp");
  assertNoValueAnywhere(b, app, [CODE]);
});

test("a locked Vault shows the words, not an error code", async () => {
  const app = new FakeApp();
  app.locked = true;
  loginPage(doc);
  const b = await worker(app);
  const r = await popup(b.w, { type: "popup.state" });
  assert.equal(r.data.error.code, "locked");
  assert.match(r.data.error.message, /locked/i);
  assert.equal(r.data.rows.length, 0);
});

test("only the extension's own pages may send popup messages, and only content scripts page messages", async () => {
  const app = new FakeApp();
  loginPage(doc);
  const b = await worker(app);
  assert.equal((await b.w.onMessage({ type: "popup.state" }, { id: "someone_else" })).error.code, "not_allowed");
  assert.equal((await b.w.onMessage({ type: "popup.fill", itemId: "x" }, { id: "ext_vyre", tab: { id: 1 } })).error.code, "not_allowed", "a page cannot drive a fill");
  assert.equal((await b.w.onMessage({ type: "vyre.save", password: "x" }, { id: "ext_vyre" })).error.code, "not_allowed", "the popup cannot save for a page");
  assert.equal((await b.w.onMessage({ type: "nonsense" }, { id: "ext_vyre" })).error.code, "not_allowed");
  assert.equal(app.received.length, 0, "refused messages never reach the app");
});

test("switching Space tells the app and forgets cached rules", async () => {
  const app = new FakeApp();
  loginPage(doc);
  const b = await worker(app);
  await popup(b.w, { type: "popup.state" });
  const r = await popup(b.w, { type: "popup.selectSpace", id: "spc_p" });
  assert.deepEqual(r.data, { active: "spc_p" });
  const op = app.received.find((m) => m["op"] === "space.select")!;
  assert.deepEqual(op["input"], { id: "spc_p" });
  assert.equal(b.areas.local.data["activeSpace"], "spc_p");
});

test("with no app, the popup says so and the web app opens for the Space", async () => {
  const app = new FakeApp();
  loginPage(doc);
  const b = await worker(app);
  await popup(b.w, { type: "popup.state" }); // learns the Spaces
  const down = makeBrowser(app, { id: 7, url: "https://login.acme.test/" });
  (down.ext.runtime as any).connectNative = () => { throw new Error("Specified native messaging host not found."); };
  Object.assign(down.areas.local.data, b.areas.local.data);
  const { createWorker } = await import("../src/worker/index.js");
  const w2 = createWorker(down.ext);
  const r = await w2.onMessage({ type: "popup.state" }, sender);
  assert.equal(r.data.status, "no_host");
  assert.equal(r.data.spaces.length, 2, "the Spaces the extension last saw are still offered");
  const open = await w2.onMessage({ type: "popup.openWeb" }, sender);
  assert.deepEqual(open.data, { opened: "web" });
  assert.deepEqual(down.created, [{ url: "https://acme.vyre.run" }]);
});

// ---------- save a login ----------

test("a trusted sign-in submit reports the login; a script's submit is ignored", () => {
  const p = loginPage(doc);
  p.user.value = USERNAME;
  p.pass.value = PASSWORD;
  doc.fire("submit", { isTrusted: false, target: p.form });
  assert.equal(sent.length, 0);
  doc.fire("submit", { isTrusted: true, target: p.form });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], { type: "vyre.submit", username: USERNAME, password: PASSWORD, kind: "signin" });
  assert.ok(!("origin" in sent[0]!), "the message carries no address; the browser says where it came from");
});

test("two password fields make it a sign-up", () => {
  const form = new FakeForm();
  const email = new FakeInput({ type: "email", name: "email" });
  const a = new FakeInput({ type: "password", autocomplete: "new-password" });
  const c = new FakeInput({ type: "password", autocomplete: "new-password" });
  email.form = a.form = c.form = form;
  form.inputs = [email, a, c];
  doc.page(email, a, c);
  email.value = USERNAME;
  a.value = PASSWORD;
  doc.fire("submit", { isTrusted: true, target: form });
  assert.equal(sent[0]?.["kind"], "signup");
});

test("a new login is offered once the page settles, and Save puts it in the person's own folder", async () => {
  const app = new FakeApp();
  const p = loginPage(doc);
  const b = await worker(app);
  const shown: Record<string, any>[] = [];
  ns.prompt = { show: (card: Record<string, any>) => { shown.push({ ...card }); return true; }, hide() {} };

  const r = await b.w.onMessage({ type: "vyre.submit", username: USERNAME, password: PASSWORD, kind: "signin" }, { id: "ext_vyre", tab: { id: 7 }, origin: "https://login.acme.test" });
  assert.deepEqual(r.data, { prompt: true });
  const check = app.received.find((m) => m["op"] === "login.check")!;
  assert.deepEqual(check["input"], { origin: "https://login.acme.test", username: USERNAME, password: PASSWORD, kind: "signin" });

  // the sign-in navigates: loading, then complete
  await b.w.onTabUpdated(7, { status: "loading" }, undefined);
  assert.equal(shown.length, 0);
  await b.w.onTabUpdated(7, { status: "complete" }, undefined);
  assert.equal(shown.length, 1);
  assert.equal(shown[0]!["host"], "login.acme.test");
  assert.equal(shown[0]!["mode"], "save");
  assert.deepEqual(shown[0]!["agent"], { id: "agt_intake", name: "Intake" });
  assert.equal(b.w.save.pendingCount, 0, "the worker no longer holds the password");

  const saved = await b.w.onMessage({ type: "vyre.save", name: "Acme Portal", username: USERNAME, password: PASSWORD, share: true, mode: "save" }, { id: "ext_vyre", tab: { id: 7 }, origin: "https://login.acme.test" });
  assert.deepEqual(saved.data, { saved: true, itemId: "vit_new" });
  const put = app.puts[0]!;
  assert.equal(put["folderId"], "vfo_mine");
  assert.equal(put["kind"], "login");
  assert.deepEqual(put["fields"], [{ key: "url", value: "https://login.acme.test" }, { key: "username", value: USERNAME }, { key: "password", value: PASSWORD, secret: true }]);
  const share = app.received.find((m) => m["capability"] === "vault.share")!;
  assert.deepEqual(share["input"], { resource: { type: "vault_item", id: "vit_new" }, subject: { kind: "agent", id: "agt_intake" }, level: "use" });
  assert.deepEqual(Object.keys(b.areas.local.data).filter((k) => !["activeSpace", "spaces", "siteRules"].includes(k)), []);
  assert.ok(!JSON.stringify([b.areas.local.writes, b.areas.session.writes, b.areas.sync.writes, logged]).includes(PASSWORD));
  void p;
});

test("a single-page app that never navigates still gets the card after a short settle", async () => {
  const app = new FakeApp();
  loginPage(doc);
  const b = await worker(app);
  const shown: Record<string, any>[] = [];
  ns.prompt = { show: (card: Record<string, any>) => { shown.push({ ...card }); return true; }, hide() {} };
  const { createSave } = await import("../src/worker/save.js");
  const timers: (() => void)[] = [];
  const save = createSave({
    bridge: { invoke: (c: string, i: Record<string, any>) => b.w.bridge.invoke(c, i), op: (o: string, i: Record<string, any>) => b.w.bridge.op(o, i) },
    scripting: b.ext.scripting, rules: b.w.rules, setTimer: (f: () => void) => { timers.push(f); return timers.length; }, clearTimer: () => {},
  });
  await save.submitted({ tabId: 7, origin: "https://login.acme.test" }, { username: USERNAME, password: PASSWORD, kind: "signin" });
  assert.equal(shown.length, 0);
  timers[0]!();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(shown.length, 1);
});

test("a known login is not offered; a changed password is offered as an update", async () => {
  const app = new FakeApp();
  loginPage(doc);
  const b = await worker(app);
  const ctx = { id: "ext_vyre", tab: { id: 7 }, origin: "https://login.acme.test" };
  app.login = { state: "known", itemId: "vit_acme", name: "Acme Portal" };
  assert.deepEqual((await b.w.onMessage({ type: "vyre.submit", username: USERNAME, password: PASSWORD, kind: "signin" }, ctx)).data, { prompt: false, why: "known" });
  app.login = { state: "changed", itemId: "vit_acme", name: "Acme Portal" };
  ns.prompt = { show: () => true, hide() {} };
  assert.deepEqual((await b.w.onMessage({ type: "vyre.submit", username: USERNAME, password: PASSWORD, kind: "signin" }, ctx)).data, { prompt: true });
  await b.w.onTabUpdated(7, { status: "loading" }, undefined);
  await b.w.onTabUpdated(7, { status: "complete" }, undefined);
  const r = await b.w.onMessage({ type: "vyre.save", name: "Acme Portal", username: USERNAME, password: PASSWORD, share: false, mode: "update" }, ctx);
  assert.deepEqual(r.data, { saved: true, itemId: "vit_acme" });
  assert.deepEqual(app.puts[0], { itemId: "vit_acme", fieldsSet: [{ key: "password", value: PASSWORD, secret: true }] });
});

test("Never Save on a site skips the check entirely; Never for this site sets the rule", async () => {
  const app = new FakeApp();
  app.rules = [{ host: "login.acme.test", neverFill: false, neverSave: true }];
  loginPage(doc);
  const b = await worker(app);
  const ctx = { id: "ext_vyre", tab: { id: 7 }, origin: "https://login.acme.test" };
  assert.deepEqual((await b.w.onMessage({ type: "vyre.submit", username: USERNAME, password: PASSWORD, kind: "signin" }, ctx)).data, { prompt: false, why: "never_save" });
  assert.equal(app.received.filter((m) => m["op"] === "login.check").length, 0, "the password is not even sent to the app");

  const app2 = new FakeApp();
  const b2 = await worker(app2);
  const r = await b2.w.onMessage({ type: "vyre.dismiss", never: true }, ctx);
  assert.deepEqual(r.data, { never: true });
  const set = app2.received.find((m) => m["capability"] === "vault.site_rules.set")!;
  assert.deepEqual(set["input"], { host: "login.acme.test", neverFill: false, neverSave: true });
});

test("an http page's sign-in is never offered", async () => {
  const app = new FakeApp();
  const b = await worker(app, "http://login.acme.test/signin");
  const r = await b.w.onMessage({ type: "vyre.submit", username: USERNAME, password: PASSWORD, kind: "signin" }, { id: "ext_vyre", tab: { id: 7 }, origin: "http://login.acme.test" });
  assert.deepEqual(r.data, { prompt: false, why: "page" });
  assert.equal(app.received.length, 0);
});

// ---------- the save card ----------

class El {
  tag: string;
  children: El[] = [];
  listeners: Record<string, ((e: any) => void)[]> = {};
  props: Record<string, any> = {};
  style: Record<string, string> = {};
  parent: El | null = null;
  shadow: El | null = null;
  constructor(tag: string) { this.tag = tag; }
  set textContent(v: string) { this.props["text"] = v; this.children = []; }
  get textContent() { return String(this.props["text"] ?? "") + this.children.map((c) => c.textContent).join(""); }
  append(...xs: El[]) { for (const x of xs) { x.parent = this; this.children.push(x); } }
  appendChild(x: El) { this.append(x); return x; }
  attachShadow() { this.shadow = new El("#shadow"); return this.shadow; }
  setAttribute(k: string, v: string) { this.props[k] = v; }
  addEventListener(t: string, f: (e: any) => void) { (this.listeners[t] ??= []).push(f); }
  click() { for (const f of this.listeners["click"] ?? []) f({}); }
  focus() { this.props["focused"] = true; }
  remove() { this.props["removed"] = true; }
  find(pred: (e: El) => boolean): El | null { if (pred(this)) return this; for (const c of [...this.children, ...(this.shadow ? [this.shadow] : [])]) { const f = c.find(pred); if (f) return f; } return null; }
  all(pred: (e: El) => boolean): El[] { return [...(pred(this) ? [this] : []), ...this.children.flatMap((c) => c.all(pred)), ...(this.shadow ? this.shadow.all(pred) : [])]; }
}
const byText = (root: El, text: string) => root.find((e) => e.tag === "button" && e.textContent === text);

test("the card masks the password, peeks for five seconds, and clears it on every way out", () => {
  const body = new El("body");
  const fake: any = { createElement: (t: string) => new El(t), documentElement: body, body };
  (globalThis as any).document = fake;
  const timers: { f: () => void; ms: number }[] = [];
  const realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout;
  (globalThis as any).setTimeout = (f: () => void, ms: number) => { timers.push({ f, ms }); return timers.length; };
  (globalThis as any).clearTimeout = () => {};
  try {
    realPrompt.show({ host: "login.acme.test", username: USERNAME, password: PASSWORD, mode: "save", name: "Acme Portal", agent: { id: "agt_intake", name: "Intake" } });
    const host = body.children[0]!;
    const out = host.shadow!.find((e) => e.tag === "output")!;
    assert.match(out.textContent, /^•+$/, "masked");
    assert.ok(!host.shadow!.find((e) => e.textContent.includes(PASSWORD)));
    byText(host.shadow!, "Peek")!.click();
    assert.equal(out.textContent, PASSWORD);
    const reMask = timers.find((t) => t.ms === 5000)!;
    reMask.f();
    assert.match(out.textContent, /^•+$/, "masked again after 5 seconds");
    assert.ok(byText(host.shadow!, "Never for this site"));
    assert.ok(host.shadow!.find((e) => e.textContent === "Share with Intake"));

    byText(host.shadow!, "Save")!.click();
    assert.equal(sent.at(-1)?.["type"], "vyre.save");
    assert.equal(sent.at(-1)?.["password"], PASSWORD);
    assert.equal(sent.at(-1)?.["share"], false);
    assert.equal(host.props["removed"], true);

    // Not now and Never carry no password at all
    realPrompt.show({ host: "h", username: "u", password: PASSWORD, mode: "save", name: "n", agent: null });
    byText(body.children.at(-1)!.shadow!, "Never for this site")!.click();
    assert.deepEqual(sent.at(-1), { type: "vyre.dismiss", never: true });
    realPrompt.show({ host: "h", username: "u", password: PASSWORD, mode: "update", name: "n", agent: null });
    assert.ok(byText(body.children.at(-1)!.shadow!, "Update"));
    byText(body.children.at(-1)!.shadow!, "Not now")!.click();
    assert.deepEqual(sent.at(-1), { type: "vyre.dismiss", never: false });
  } finally {
    (globalThis as any).setTimeout = realSet;
    (globalThis as any).clearTimeout = realClear;
    (globalThis as any).document = doc;
  }
});
