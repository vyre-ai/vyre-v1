// Agent control in Vyre for Chrome (V1-SPEC 3.12 and 2.7, ARCH 7.12): the chrome_* tools over chrome.debugger against a fake browser. Snapshot, act, type, fill, tabs, wait,
// screenshot, net, console, api and batch; the indigo frame shown only while an agent drives; Stop and Esc; held sends; secrets that never reach the agent; opt-in per Space.
// The same tools against a real Chrome are in ext-agent.real.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as pageFns from "../src/agent/page.js";
import * as consequence from "../src/agent/consequence.js";
import * as selector from "../src/agent/selector.js";
import * as verify from "../src/agent/verify.js";
import { MASK, bareUrl, maskBody, maskHeaders, maskJson, maskText, maskUrl, scrub } from "../src/agent/mask.js";
import { BATCHABLE, TOOLS, WORDS, AgentFailure, checkInput, parseCommand } from "../src/agent/protocol.js";
import { parseKey, isPublicUrl } from "../src/agent/tools.js";
import { createAgentControl } from "../src/agent/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(ROOT, "..", "..");
const SECRET = "hunter2-Pa55";

// ---------- a fake browser ----------

const FN_PREFIX = Object.entries(pageFns).filter(([name, f]) => typeof f === "function" && name !== "callExpression").map(([name, f]) => [`(${f.toString()})(`, name]);

function ctl(idx, role, name, over = {}) {
  return { k: "c", idx, depth: 1, role, name, path: `form[0]>${role}[${idx}]`, enabled: true, frame: { x: 20, y: 60 + idx * 50, w: 200, h: 30 }, ...over };
}

function loginPage() {
  return {
    url: "https://acme.test/login", title: "Acme sign in", text: "Welcome to Acme. Sign in to continue.", viewport: { w: 1280, h: 800 }, focused: null, values: {}, secretValues: {}, secrets: new Set(), checked: {}, selects: {},
    controls: [
      ctl(0, "textbox", "Email"),
      ctl(1, "textbox", "Password", { secret: true }),
      ctl(2, "button", "Sign in", { submit: true }),
      ctl(3, "link", "Pricing", { href: "https://acme.test/pricing", depth: 0 }),
      ctl(4, "checkbox", "Remember me", { checked: false }),
      ctl(5, "textbox", "Message", { formSubmit: "Send message" }),
      ctl(6, "button", "Send message", { submit: true }),
      ctl(7, "combobox", "Plan"),
      ctl(8, "button", "Covered", { covered: "Cookie banner" }),
      ctl(9, "button", "Pay now", { enabled: true }),
      ctl(10, "button", "Disabled thing", { enabled: false }),
    ],
    extra: [{ k: "g", role: "form", name: "login", depth: 0 }, { k: "h", level: 1, name: "Welcome", depth: 0 }],
  };
}

function pricingPage() {
  return { ...loginPage(), url: "https://acme.test/pricing", title: "Acme pricing", text: "Plans and pricing", controls: [ctl(0, "link", "Back", { href: "https://acme.test/login", depth: 0 })], extra: [] };
}

function makeWorld(over = {}) {
  const world = {
    clock: 1000, timers: [], events: [], results: [], active: "spc_a", sent: 0, mouse: [], keys: [], typed: [], shots: [], blurLog: [], navigations: [], apiCalls: [], fillRequests: [],
    attached: new Set(), detaches: [], badge: {}, overlay: new Map(), evalValue: 42, tabs: new Map(), nextTab: 20, listeners: [], detachListeners: [], connectListeners: [], removedListeners: [],
    pages: new Map(), apiReply: { status: 200, mime: "application/json", headers: { "content-type": "application/json", "set-cookie": "sid=abc123", "x-request-id": "r1" }, body: JSON.stringify({ items: [{ id: 1 }], api_key: "sk_live_999", token: "t0k" }), truncated: false },
    ...over,
  };
  const now = () => world.clock;
  const sleep = async (ms) => { world.clock += ms; };
  const setTimer = (f, ms) => { const t = { f, at: world.clock + ms, live: true }; world.timers.push(t); return t; };
  const clearTimer = (t) => { if (t) t.live = false; };
  world.advance = async (ms) => {
    world.clock += ms;
    for (const t of [...world.timers]) if (t.live && t.at <= world.clock) { t.live = false; t.f(); }
    await new Promise((r) => setTimeout(r, 0));
  };
  world.emit = (tabId, method, params = {}) => { for (const l of world.listeners) l({ tabId }, method, params); };

  world.tabs.set(7, { id: 7, url: "https://acme.test/login", title: "Acme sign in", status: "complete", active: true });
  world.pages.set(7, loginPage());

  const page = (tabId) => world.pages.get(tabId);
  const control = (tabId, idx) => page(tabId).controls.find((c) => c.idx === idx);
  const navigate = (tabId, to) => {
    const p = to === "pricing" ? pricingPage() : to === "login" ? loginPage() : { ...loginPage(), url: to, title: "Elsewhere", text: "Somewhere", controls: [], extra: [] };
    world.pages.set(tabId, p);
    const tab = world.tabs.get(tabId);
    tab.url = p.url;
    tab.title = p.title;
    world.navigations.push(p.url);
    world.emit(tabId, "Page.frameStartedLoading", {});
    setTimeout(() => world.emit(tabId, "Page.loadEventFired", {}), 2);
  };
  const clicked = (tabId, c) => {
    const p = page(tabId);
    if (c.name === "Pricing") navigate(tabId, "pricing");
    else if (c.name === "Back") navigate(tabId, "login");
    else if (c.name === "Remember me") c.checked = !c.checked;
    else if (c.name === "Send message" || c.name === "Pay now") { world.sent++; p.text += " Sent."; } else if (c.name === "Sign in") { p.text = "Signed in as Dana."; p.title = "Acme dashboard"; }
    p.focused = c.idx;
  };
  const raw = (tabId) => {
    const p = page(tabId);
    const nodes = [...p.extra, ...p.controls.map((c) => {
      const n = { ...c, focused: p.focused === c.idx };
      delete n.covered;
      if (c.checked !== undefined) n.checked = c.checked;
      if (c.secret || p.secrets.has(c.idx)) { n.secret = true; if (p.secretValues[c.idx]) n.length = p.secretValues[c.idx].length; } else if (p.values[c.idx]) n.value = p.values[c.idx];
      return n;
    })];
    return { title: p.title, url: p.url, viewport: p.viewport, text: p.text, nodes, truncated: false };
  };
  const evaluate = (tabId, expression) => {
    const hit = FN_PREFIX.find(([prefix]) => expression.startsWith(prefix));
    if (!hit) return world.evalThrows ? { exceptionDetails: { text: "boom", exception: { description: "ReferenceError: x is not defined at https://acme.test/app?token=zzz" } } } : { result: { value: world.evalValue } };
    const args = JSON.parse(`[${expression.slice(hit[0].length, -1)}]`);
    const p = page(tabId);
    switch (hit[1]) {
      case "collectPage": return { result: { value: args[0] && args[0] !== "#login" ? { error: "no_element" } : raw(tabId) } };
      case "revealElement": { const c = control(tabId, args[0]); if (!c) return { result: { value: null } }; return { result: { value: { x: c.frame.x, y: c.frame.y, w: c.frame.w, h: c.frame.h, cx: c.frame.x + 100, cy: c.frame.y + 15, covered: c.covered || "", vw: 1280, vh: 800, sx: 0, sy: 0 } } }; }
      case "focusElement": p.focused = args[0]; return { result: { value: true } };
      case "selectOption": { const ok = ["free", "pro"].includes(String(args[1]).toLowerCase()); if (ok) p.selects[args[0]] = args[1]; return { result: { value: ok ? { ok: true, label: args[1] } : { ok: false, why: "no option called " + JSON.stringify(args[1]) } } }; }
      case "scrollTo": world.scrolled = args; return { result: { value: { top: 400, moved: true, atEnd: false } } };
      case "describeElement": { const c = control(tabId, args[0]); return { result: { value: c ? { tag: "input", role: null, attributes: { type: c.secret ? "password" : "text", value: c.secret ? MASK : "" }, text: "", box: c.frame, visible: true, disabled: false } : null } }; }
      case "pointInfo": { const c = p.controls.find((k) => args[0] >= k.frame.x && args[0] <= k.frame.x + k.frame.w && args[1] >= k.frame.y && args[1] <= k.frame.y + k.frame.h); return { result: { value: c ? { actionable: true, name: c.name, nameless: false, role: c.role, submit: c.submit === true, href: c.href } : { actionable: false } } }; }
      case "probe": return { result: { value: args[0] === "load" ? true : args[0] === "text" ? p.text.includes(args[1]) : (p.selectors || []).includes(args[1]) } };
      case "markSecret": p.secrets.add(args[0]); return { result: { value: true } };
      case "blurSecrets": p.blur = args[0]; world.blurLog.push(args[0]); return { result: { value: 1 } };
      case "scrubSecrets": { let t = String(args[0]); for (const v of Object.values(p.secretValues)) t = t.split(v).join(MASK); return { result: { value: t } }; }
      case "pageRequest": world.apiCalls.push(args[0]); return { result: { value: world.apiReply } };
      default: return { result: { value: null } };
    }
  };
  const dbg = {
    attach: async ({ tabId }) => { if (world.denyAttach) throw new Error("Another debugger is already attached to the tab with id: " + tabId); world.attached.add(tabId); },
    detach: async ({ tabId }) => { world.attached.delete(tabId); world.detaches.push(tabId); },
    sendCommand: async ({ tabId }, method, params = {}) => {
      if (!world.attached.has(tabId)) throw new Error("Debugger is not attached to the tab with id: " + tabId);
      switch (method) {
        case "Runtime.evaluate": return evaluate(tabId, params.expression);
        case "Input.dispatchMouseEvent": {
          world.mouse.push({ type: params.type, x: params.x, y: params.y, button: params.button, clickCount: params.clickCount });
          if (params.type === "mouseReleased" && params.clickCount === 1) { const c = page(tabId).controls.find((k) => params.x >= k.frame.x && params.x <= k.frame.x + k.frame.w && params.y >= k.frame.y && params.y <= k.frame.y + k.frame.h); if (c) clicked(tabId, c); }
          return {};
        }
        case "Input.insertText": {
          world.typed.push(params.text);
          const p = page(tabId);
          const c = control(tabId, p.focused);
          if (c) { if (c.secret || p.secrets.has(c.idx)) p.secretValues[c.idx] = (p.replace ? "" : p.secretValues[c.idx] || "") + params.text; else p.values[c.idx] = (p.replace ? "" : p.values[c.idx] || "") + params.text; }
          p.replace = false;
          return {};
        }
        case "Input.dispatchKeyEvent": {
          world.keys.push({ type: params.type, key: params.key, modifiers: params.modifiers, commands: params.commands });
          if (params.commands && params.commands.includes("selectAll")) page(tabId).replace = true;
          if (params.type === "keyDown" && params.key === "Enter") { const c = control(tabId, page(tabId).focused); if (c && c.formSubmit) { world.sent++; page(tabId).text += " Sent."; } }
          return {};
        }
        case "Page.navigate": navigate(tabId, params.url); return {};
        case "Page.getLayoutMetrics": return { cssVisualViewport: { clientWidth: 1280, clientHeight: 800 }, cssContentSize: { width: 1280, height: 2400 } };
        case "Page.captureScreenshot": world.shots.push({ params, blurred: Boolean(page(tabId).blur) }); return { data: "UE5H" };
        case "Network.getResponseBody": return { body: JSON.stringify({ ok: true, password: "p", rows: 3 }), base64Encoded: false };
        default: return {};
      }
    },
    onEvent: { addListener: (f) => world.listeners.push(f) },
    onDetach: { addListener: (f) => world.detachListeners.push(f) },
  };
  const ext = {
    runtime: { id: "ext", onConnect: { addListener: (f) => world.connectListeners.push(f) } },
    storage: { local: { async get() { return {}; }, async set() {}, async remove() {} } },
    debugger: dbg,
    action: {
      setBadgeText: async ({ tabId, text }) => { world.badge[tabId] = text; }, setBadgeBackgroundColor: async () => {}, setTitle: async () => {},
    },
    scripting: {
      executeScript: async ({ target, func, args }) => {
        const tabId = target.tabId;
        if (func.name === "overlayShow") world.overlay.set(tabId, { ...args[0], cursor: null });
        else if (func.name === "overlayCursor") { const o = world.overlay.get(tabId); if (o) o.cursor = { x: args[0], y: args[1], click: args[2] }; } else if (func.name === "overlayHide") world.overlay.delete(tabId);
        return [{ frameId: 0, result: true }];
      },
    },
    tabs: {
      get: async (id) => { const t = world.tabs.get(id); if (!t) throw new Error("No tab with id: " + id); return { ...t }; },
      query: async () => [...world.tabs.values()].filter((t) => t.active).map((t) => ({ ...t })),
      create: async ({ url, active }) => { const id = world.nextTab++; world.tabs.set(id, { id, url: "about:blank", title: "", status: "complete", active: Boolean(active) }); world.pages.set(id, { ...loginPage(), url: "about:blank", title: "", controls: [], extra: [] }); return { id, url }; },
      remove: async (id) => { world.tabs.delete(id); for (const f of world.removedListeners) f(id); },
      onRemoved: { addListener: (f) => world.removedListeners.push(f) },
    },
  };
  const transport = {
    online: true, connect() {}, close() {},
    tell(op, input) { if (op === "agent.event") world.events.push(input); else world.results.push({ op, ...input }); },
    async call(type, name, input, extra) {
      world.fillRequests.push({ type, name, input, extra });
      if (world.fillFails) return { filled: false };
      setTimeout(() => { void control_.onIncoming({ type: "fill", ref: input.target.ref, value: SECRET }); }, 1);
      return { filled: true };
    },
  };
  const control_ = createAgentControl(ext, { transport, activeSpace: async () => world.active, now, sleep, settleMs: 0, setTimer, clearTimer, idleMs: 20_000 });
  world.control = control_;
  world.ext = ext;
  world.page = page;
  world.agent = { id: "agt_intake", name: "Intake" };
  world.call = (tool, input = {}, who = world.agent, space = "spc_a") => control_.run({ tool, input, agent: who, space });
  world.optIn = async (mode = "computer", spaces = ["spc_a"]) => { await control_.onIncoming({ type: "agent.optin", spaces, mode }); };
  world.eventsOf = (name) => world.events.filter((e) => e.event === name);
  world.fails = async (tool, input, code, who = world.agent) => {
    try { await world.call(tool, input, who); } catch (e) { assert.equal(e.code, code, `${tool} failed with ${e.code}: ${e.message}`); return e; }
    throw new Error(`${tool} should have failed with ${code}`);
  };
  return world;
}

async function ready(over = {}) {
  const w = makeWorld(over);
  await w.optIn();
  return w;
}

// ---------- the contract ----------

test("every chrome tool in the computers manifest has a handler, and the capability each executes is the manifest's", () => {
  const manifest = fs.readFileSync(path.join(REPO, "manifests/computers.ts"), "utf8");
  const found = [...manifest.matchAll(/'(computers\.chrome\.[a-z_]+)'[\s\S]*?mcpName: '(chrome_[a-z]+)'/g)].map((m) => [m[2], m[1]]);
  assert.ok(found.length >= 22, `found ${found.length} chrome tools in the manifest`);
  for (const [tool, cap] of found) assert.equal(TOOLS[tool], cap, `${tool} executes ${cap}`);
  assert.deepEqual(Object.keys(TOOLS).sort(), found.map((f) => f[0]).sort(), "no tool the manifest does not name, none missing");
  assert.ok(!Object.keys(TOOLS).includes("chrome_ghl"), "the workflow-specific tool of the old extension is not part of v1");
});

test("tool inputs are checked: unknown keys, wrong types and bad enums are refused with words", () => {
  assert.deepEqual(checkInput("chrome_snapshot", {}), {});
  assert.deepEqual(checkInput("chrome_snapshot", { format: "text", computerId: "cmp_1" }), { format: "text", computerId: "cmp_1" });
  for (const [tool, bad] of [["chrome_snapshot", { sel: "x" }], ["chrome_act", { action: "explode" }], ["chrome_act", {}], ["chrome_type", { text: 5 }], ["chrome_open", {}], ["chrome_api", { method: "TRACE", url: "https://a.test" }], ["chrome_fill", { fields: "x" }], ["chrome_wait", { until: "eventually" }], ["chrome_nope", {}]]) {
    assert.throws(() => checkInput(tool, bad), (e) => e instanceof AgentFailure && (e.code === "bad_input" || e.code === "unknown_tool"), `${tool} ${JSON.stringify(bad)}`);
  }
  assert.ok(!BATCHABLE.has("chrome_send") && !BATCHABLE.has("chrome_stop") && !BATCHABLE.has("chrome_eval") && !BATCHABLE.has("chrome_batch"), "nothing the Gate or the person must see alone runs in a batch");
});

test("the wire accepts only well formed agent calls and opt-in lists", () => {
  assert.deepEqual(parseCommand({ type: "agent.call", id: "c1", tool: "chrome_snapshot", input: {}, agent: { id: "agt_1", name: "Intake" }, space: "spc_a" }), { type: "agent.call", id: "c1", tool: "chrome_snapshot", input: {}, agent: { id: "agt_1", name: "Intake" }, space: "spc_a" });
  assert.deepEqual(parseCommand({ type: "agent.optin", spaces: ["spc_a", 5], mode: "computer" }), { type: "agent.optin", spaces: ["spc_a"], mode: "computer" });
  assert.equal(parseCommand({ type: "agent.optin", spaces: ["a"] }).mode, "personal");
  for (const junk of [null, 5, "x", [], {}, { type: "agent.call" }, { type: "agent.call", id: "c", tool: "t", agent: "Intake", space: "s" }, { type: "fill", ref: "r", value: "v" }, { type: "eval", code: "1" }]) assert.equal(parseCommand(junk), null);
  for (const code of ["not_opted_in", "wrong_space", "paused", "busy", "held_gone", "not_public", "secret_field", "cross_origin"]) assert.ok(WORDS[code].length > 20, code);
});

test("keys are named the way a person would name them", () => {
  assert.equal(parseKey("Enter").key, "Enter");
  assert.equal(parseKey("Enter").text, "\r");
  assert.equal(parseKey("Control+A").modifiers, 2);
  assert.equal(parseKey("Control+A").text, undefined);
  assert.equal(parseKey("Shift+Tab").modifiers, 8);
  assert.equal(parseKey("a").code, "KeyA");
  assert.equal(parseKey("7").code, "Digit7");
  assert.equal(parseKey(" ").code, "Space");
  assert.throws(() => parseKey("Hyper+X"), (e) => e.code === "bad_input");
  assert.throws(() => parseKey("NotAKey"), (e) => e.code === "bad_input");
});

test("agents browse the public web only", () => {
  for (const ok of ["https://acme.test/x", "http://example.org", "https://93.184.216.34/", "https://sub.domain.co.uk:8443/a?b=c"]) assert.equal(isPublicUrl(ok), true, ok);
  for (const no of ["http://localhost:3000", "http://127.0.0.1/", "http://10.0.0.5/", "http://192.168.1.1/", "http://172.16.0.1/", "http://169.254.169.254/latest/meta-data", "http://100.64.1.1/", "http://[::1]/", "http://[fd00::1]/", "https://printer.local/", "https://wiki.internal/", "http://intranet/", "file:///etc/passwd", "chrome://settings", "javascript:alert(1)", "ftp://a.test/", "not a url"]) assert.equal(isPublicUrl(no), false, no);
});

// ---------- the judgement ported from 0.6 ----------

test("a send, post, payment or deletion is held; a link called Pricing and a Sign in button are not", () => {
  const held = [["Send message", "send"], ["Resend", "send"], ["Post", "post"], ["Publish", "post"], ["Pay now", "payment"], ["Buy for $20", "payment"], ["Place order", "payment"], ["Delete account", "delete"], ["Remove", "delete"], ["Submit", "submit"], ["Confirm", "submit"], ["Merge pull request", "deploy"], ["Log out", "access"], ["Invite", "access"], ["Connect", "access"]];
  for (const [name, kind] of held) {
    const v = consequence.of({ name, role: "button" });
    assert.equal(v.consequential, true, name);
    assert.equal(v.kind, kind, name);
  }
  for (const name of ["Pricing", "Contact us", "Read more", "Next page", "Sign in", "Search", "Open menu", "Accept cookies"]) assert.equal(consequence.of({ name, role: "link" }).consequential, false, name);
  assert.equal(consequence.of({ name: "Sign in", role: "button", submit: true }).consequential, false, "a benign submit moves on");
  assert.equal(consequence.of({ name: "Save changes", role: "button", submit: true }).consequential, true, "any other form submit is held");
  assert.equal(consequence.of({ name: "Grant", role: "link", href: "https://x.test/oauth/authorize?client=1" }).consequential, true);
  assert.equal(consequence.of({ name: "Account", role: "link", href: "https://x.test/billing" }).consequential, true, "a link to billing is held");
  assert.equal(consequence.of({ role: "button", nameless: true }).consequential, true, "what cannot be read matters");
  assert.equal(consequence.of({ name: " ", role: "button" }).consequential, true);
  for (const role of ["textbox", "searchbox", "checkbox", "radio", "combobox", "switch"]) assert.equal(consequence.of({ name: "Send to", role }).consequential, false, `a ${role} named Send to only takes focus`);
  assert.equal(consequence.ofEnter({}).consequential, false);
  assert.equal(consequence.ofEnter({ formSubmit: "Send message" }).consequential, true, "Enter submits the form it is in");
  assert.equal(consequence.ofEnter({ formSubmit: "Search" }).consequential, false);
  assert.equal(consequence.retryable({ name: "Next", role: "button" }), true);
  assert.equal(consequence.retryable({ name: "Send", role: "button" }), false, "a send is never replayed");
});

test("a ref binds by what the control is; a tie or a miss is an answer, not a guess", () => {
  const a = { role: "button", name: "Save", path: "p[0]", enabled: true };
  const b = { role: "button", name: "Cancel", path: "p[1]", enabled: true };
  const field = { role: "textbox", name: "Save", path: "p[2]", enabled: true };
  const sel = selector.of(a);
  assert.equal(selector.resolve(sel, [b, a, field]).control, a, "the role is a gate: the field called Save is not the button");
  assert.equal(selector.resolve(sel, [b]).why, "unbound");
  assert.equal(selector.resolve(sel, [a, { ...a }]).why, "tied");
  assert.equal(selector.resolve(selector.of({ ...a, identifier: "save-btn" }), [{ ...a, name: "Store", identifier: "save-btn" }]).control.name, "Store", "an identifier outranks a name");
  const unlabelled = { role: "textbox", path: "form[0]>input[3]", enabled: true };
  assert.equal(selector.resolve(selector.of(unlabelled), [unlabelled, { ...unlabelled, path: "form[0]>input[4]" }]).control, unlabelled, "an unlabelled field is told by where it sits");
});

test("a click that changed nothing did not land; what moved is reported by name", () => {
  const before = { title: "T", url: "https://a.test/", text: "one", controls: [{ role: "button", name: "Go", path: "b[0]", enabled: true }] };
  assert.equal(verify.changed(before, { ...before }).ok, false);
  const after = { ...before, text: "two", controls: [{ role: "button", name: "Go", path: "b[0]", enabled: false }, { role: "link", name: "Next", path: "a[0]", enabled: true }] };
  assert.equal(verify.changed(before, after).ok, true);
  const d = verify.diff(before, after);
  assert.deepEqual([d.appeared, d.altered, d.text], [["Next"], ["Go"], true]);
  assert.equal(verify.signature(before), verify.signature({ ...before, controls: [{ ...before.controls[0], frame: { x: 9 } }] }), "geometry does not count");
});

// ---------- what an agent may read ----------

test("credentials, tokens and cookies are masked everywhere an agent can read", () => {
  assert.equal(maskUrl("https://u:p@a.test/x?token=abc&q=1#frag"), `https://a.test/x?token=${MASK}&q=1`);
  assert.equal(bareUrl("https://a.test/reset/AAAAAAAAAAAAAAAAAAAAAAAA?x=1#y"), "https://a.test/reset/…");
  assert.equal(scrub("went to https://a.test/p?token=zzz and back"), "went to https://a.test/p and back");
  assert.equal(scrub("x".repeat(300)).length, 200);
  assert.deepEqual(maskJson({ id: 1, api_key: "sk", nested: { Authorization: "Bearer abcdefghij", ok: true }, list: [{ password: "p" }] }), { id: 1, api_key: MASK, nested: { Authorization: MASK, ok: true }, list: [{ password: MASK }] });
  assert.deepEqual(maskHeaders({ "Set-Cookie": "sid=1", "Content-Type": "text/html", Authorization: "Bearer x", "X-Api-Key": "k" }), { "set-cookie": MASK, "content-type": "text/html", authorization: MASK, "x-api-key": MASK });
  assert.equal(maskBody("a=1&password=hunter2&b=2", "application/x-www-form-urlencoded"), `a=1&password=${MASK}&b=2`);
  assert.equal(maskBody(JSON.stringify({ csrf: "zz", name: "Dana" }), "application/json"), JSON.stringify({ csrf: MASK, name: "Dana" }));
  assert.doesNotMatch(maskText("auth eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def and Bearer abcdefghijklmnop"), /eyJ|abcdefghijklmnop/);
});

// ---------- the guard: Space, opt-in, and the person's Stop ----------

test("an agent drives this Chrome only for the active Space, and only when the Space is opted in", async () => {
  const w = makeWorld();
  await w.fails("chrome_snapshot", {}, "not_opted_in");
  await w.optIn("computer", ["spc_a"]);
  w.active = "spc_b";
  await w.fails("chrome_snapshot", {}, "wrong_space");
  w.active = "spc_a";
  const r = await w.call("chrome_snapshot");
  assert.match(r.tree, /textbox "Email"/);
  const status = await w.call("chrome_status");
  assert.deepEqual([status.connected, status.paused, status.held], [true, false, []]);
  await w.control.onIncoming({ type: "agent.optin", spaces: [], mode: "computer" });
  assert.equal(w.overlay.size, 0, "closing the Space to agents takes the frame off at once");
  await w.fails("chrome_snapshot", {}, "not_opted_in");
  assert.equal((await w.call("chrome_status")).connected, false);
});

test("the frame, the beacon and the debugger exist only while an agent drives, and go when it is idle", async () => {
  const w = await ready();
  assert.equal(w.overlay.size, 0, "nothing before the agent acts");
  await w.call("chrome_plan", { goal: "Sign in to Acme", steps: ["fill the form"] });
  await w.call("chrome_snapshot");
  const o = w.overlay.get(7);
  assert.equal(o.name, "Intake");
  assert.equal(o.paused, false);
  assert.equal(o.goal, "Sign in to Acme");
  assert.equal(o.port, "vyre.agent.overlay");
  assert.equal(w.badge[7], "●");
  assert.ok(w.attached.has(7));
  assert.equal(w.eventsOf("driving").filter((e) => e.on).length, 1);
  await w.call("chrome_snapshot");
  assert.equal(w.eventsOf("driving").filter((e) => e.on).length, 1, "a second call keeps the same session");
  await w.advance(19_000);
  assert.equal(w.overlay.size, 1, "not yet idle");
  await w.call("chrome_snapshot");
  await w.advance(19_000);
  assert.equal(w.overlay.size, 1, "a call restarts the idle clock");
  await w.advance(2_000);
  assert.equal(w.overlay.size, 0, "idle: the frame is gone");
  assert.equal(w.attached.size, 0, "idle: the debugger is detached");
  assert.equal(w.badge[7], "");
  const off = w.eventsOf("driving").filter((e) => !e.on);
  assert.equal(off.length, 1);
  assert.equal(off[0].why, "idle");
  await w.call("chrome_snapshot");
  assert.equal(w.overlay.size, 1, "the next call brings the frame back");
});

test("Stop on the frame gives the tab back, is logged under the agent, and the agent waits until resumed", async () => {
  const w = await ready();
  await w.call("chrome_snapshot");
  const port = { name: "vyre.agent.overlay", sender: { id: "ext", tab: { id: 7 } }, onMessage: { addListener: (f) => { port.send = f; } } };
  for (const f of w.connectListeners) f(port);
  port.send({ type: "stop" });
  await w.advance(0);
  assert.equal(w.overlay.size, 0, "the frame is off");
  assert.equal(w.attached.size, 0, "the debugger is detached: the tab is the person's again");
  const stopped = w.eventsOf("stopped");
  assert.equal(stopped.length, 1);
  assert.deepEqual([stopped[0].agent, stopped[0].by], ["agt_intake", "person"]);
  await w.fails("chrome_snapshot", {}, "paused");
  await w.fails("chrome_click", { x: 1, y: 1 }, "paused");
  const st = await w.call("chrome_status");
  assert.equal(st.paused, true);
  await w.call("chrome_stop", { reason: "again" });
  const r = await w.call("chrome_resume");
  assert.equal(r.resumed, true);
  assert.equal(w.eventsOf("resumed").length, 1);
  assert.match((await w.call("chrome_snapshot")).tree, /Sign in/);
  const other = { id: "agt_scout", name: "Scout" };
  assert.match((await w.call("chrome_status", {}, other)).paused ? "paused" : "free", /free/, "another agent was never stopped");
});

test("Esc pauses everything with a dashed frame until the person answers; the agent calls chrome_resume", async () => {
  const w = await ready();
  await w.call("chrome_snapshot");
  const port = { name: "vyre.agent.overlay", sender: { id: "ext", tab: { id: 7 } }, onMessage: { addListener: (f) => { port.send = f; } } };
  for (const f of w.connectListeners) f(port);
  port.send({ type: "esc" });
  await w.advance(0);
  const o = w.overlay.get(7);
  assert.equal(o.paused, true, "the frame stays, paused, so the person sees the agent is waiting");
  assert.equal(w.attached.size, 0, "nothing can run");
  assert.equal(w.eventsOf("paused").length, 1);
  await w.fails("chrome_act", { ref: "e1", action: "click" }, "paused");
  await w.call("chrome_resume");
  assert.equal(w.overlay.size, 0, "answered: the dashed frame comes off");
  assert.match((await w.call("chrome_snapshot")).tree, /Email/);
});

test("a message on the frame's port from anywhere but this extension's own tab is ignored", async () => {
  const w = await ready();
  await w.call("chrome_snapshot");
  const make = (sender, name = "vyre.agent.overlay") => { const p = { name, sender, onMessage: { addListener: (f) => { p.send = f; } } }; for (const f of w.connectListeners) f(p); return p; };
  const foreign = make({ id: "someone-else", tab: { id: 7 } });
  const nameless = make({ id: "ext", tab: { id: 7 } }, "other");
  const noTab = make({ id: "ext" });
  for (const p of [foreign, nameless, noTab]) if (p.send) p.send({ type: "stop" });
  await w.advance(0);
  assert.equal(w.overlay.size, 1);
  assert.equal(w.eventsOf("stopped").length, 0);
});

test("cancelling Chrome's own debugging bar is a Stop", async () => {
  const w = await ready();
  await w.call("chrome_snapshot");
  w.attached.delete(7);
  for (const f of w.detachListeners) f({ tabId: 7 }, "canceled_by_user");
  await w.advance(0);
  assert.equal(w.eventsOf("stopped")[0].by, "person");
  assert.equal(w.overlay.size, 0);
  await w.fails("chrome_snapshot", {}, "paused");
});

// ---------- snapshot ----------

test("snapshot reads the page as a tree with refs and keeps secret values out of it", async () => {
  const w = await ready();
  w.page(7).values[0] = "dana@acme.test";
  w.page(7).secretValues[1] = SECRET;
  const r = await w.call("chrome_snapshot");
  assert.equal(r.url, "https://acme.test/login");
  assert.equal(r.title, "Acme sign in");
  assert.equal(r.truncated, false);
  const lines = r.tree.split("\n");
  assert.match(lines[0], /^page "Acme sign in" https:\/\/acme\.test\/login$/);
  assert.ok(lines.some((l) => /form "login"/.test(l)));
  assert.ok(lines.some((l) => /heading "Welcome" \(h1\)/.test(l)));
  assert.ok(lines.includes('    textbox "Email" [ref=e1] value="dana@acme.test"'), r.tree);
  assert.ok(lines.some((l) => /textbox "Password" \[ref=e2\] value=•+ \(12 characters\)/.test(l)));
  assert.ok(lines.some((l) => /button "Sign in" \[ref=e3\] \(submits a form\)/.test(l)));
  assert.ok(lines.some((l) => /link "Pricing" \[ref=e4\] -> https:\/\/acme\.test\/pricing/.test(l)));
  assert.ok(lines.some((l) => /checkbox "Remember me" \[ref=e5\] \(unchecked\)/.test(l)));
  assert.ok(lines.some((l) => /button "Disabled thing" \[ref=e11\] \(disabled\)/.test(l)));
  assert.doesNotMatch(r.tree, new RegExp(SECRET), "the secret is not in the tree");
  const text = await w.call("chrome_snapshot", { format: "text" });
  assert.equal(text.tree, "Welcome to Acme. Sign in to continue.");
  await w.fails("chrome_snapshot", { selector: "#nope" }, "no_element");
  assert.match((await w.call("chrome_snapshot", { selector: "#login" })).tree, /Email/);
});

// ---------- act, click ----------

test("a click re-binds the ref to a fresh look, moves the named cursor, presses, and reports what changed", async () => {
  const w = await ready();
  await w.call("chrome_snapshot");
  const r = await w.call("chrome_act", { ref: "e4", action: "click" });
  assert.equal(r.ok, true);
  assert.match(r.snapshot, /link "Back"/, "the page after the click is returned with fresh refs");
  assert.deepEqual(w.mouse.map((m) => m.type), ["mouseMoved", "mousePressed", "mouseReleased"]);
  assert.deepEqual([w.mouse[1].x, w.mouse[1].y], [120, 225]);
  assert.equal(w.tabs.get(7).url, "https://acme.test/pricing");
  const back = await w.call("chrome_act", { ref: "e1", action: "click" });
  assert.equal(back.ok, true, "the new snapshot's refs work");
});

test("the agent's named cursor goes to the control it presses", async () => {
  const w = await ready();
  await w.call("chrome_snapshot");
  assert.equal(w.overlay.get(7).cursor, null, "no cursor until the agent points at something");
  await w.call("chrome_act", { ref: "e5", action: "check" });
  assert.deepEqual(w.overlay.get(7).cursor, { x: 120, y: 275, click: true });
  await w.call("chrome_act", { ref: "e4", action: "hover" });
  assert.deepEqual(w.overlay.get(7).cursor, { x: 120, y: 225, click: false }, "a hover moves the cursor without a click ring");
});

test("a ref the page has moved away from is a miss with a reason, and nothing is pressed", async () => {
  const w = await ready();
  await w.fails("chrome_act", { ref: "e4", action: "click" }, "unknown_ref");
  await w.call("chrome_snapshot");
  w.page(7).controls = w.page(7).controls.filter((c) => c.name !== "Pricing");
  const gone = await w.call("chrome_act", { ref: "e4", action: "click" });
  assert.equal(gone.ok, false);
  assert.match(gone.why, /moved or changed/);
  assert.equal(w.mouse.length, 0);
  w.page(7).controls.push(ctl(20, "button", "Sign in", { path: "form[0]>button[2]" }));
  const tied = await w.call("chrome_act", { ref: "e3", action: "click" });
  assert.equal(tied.ok, false);
  assert.match(tied.why, /More than one control matches/);
  assert.equal(w.mouse.length, 0);
});

test("a disabled or covered control is not pressed, and says why", async () => {
  const w = await ready();
  await w.call("chrome_snapshot");
  const dis = await w.call("chrome_act", { ref: "e11", action: "click" });
  assert.deepEqual([dis.ok, /disabled/.test(dis.why)], [false, true]);
  const cov = await w.call("chrome_act", { ref: "e9", action: "click" });
  assert.deepEqual([cov.ok, /covered by "Cookie banner"/.test(cov.why)], [false, true]);
  assert.equal(w.mouse.length, 0);
});

test("a click that changes nothing is reported as not landed", async () => {
  const w = await ready();
  await w.call("chrome_snapshot");
  const r = await w.call("chrome_act", { ref: "e3", action: "click" });
  assert.equal(r.ok, true, "Sign in changes the page text");
  const again = await w.call("chrome_act", { ref: "e3", action: "click" });
  assert.equal(again.ok, false, "pressing it again changes nothing");
  assert.match(again.why, /did not land/);
  assert.equal(again.retryable, true);
});

test("a send, post or payment is held: nothing is pressed until chrome_send, which only its own agent can call, once", async () => {
  const w = await ready();
  await w.call("chrome_snapshot");
  const r = await w.call("chrome_act", { ref: "e7", action: "click" });
  assert.equal(r.ok, false);
  assert.match(r.heldId, /^hld_[0-9a-f]{18}$/);
  assert.match(r.why, /held until the person approves/);
  assert.equal(w.mouse.length, 0, "nothing was pressed");
  assert.equal(w.sent, 0);
  const pay = await w.call("chrome_act", { ref: "e10", action: "click" });
  assert.notEqual(pay.heldId, r.heldId);
  const held = w.eventsOf("held");
  assert.deepEqual(held.map((h) => h.kind), ["send", "payment"]);
  assert.match(held[0].summary, /send: "Send message" on https:\/\/acme\.test\/login/);
  assert.deepEqual((await w.call("chrome_status")).held.sort(), [r.heldId, pay.heldId].sort());
  const scout = { id: "agt_scout", name: "Scout" };
  await w.fails("chrome_send", { heldId: r.heldId }, "held_gone", scout);
  await w.fails("chrome_send", { heldId: "hld_unknown" }, "held_gone");
  const sent = await w.call("chrome_send", { heldId: r.heldId });
  assert.equal(sent.sent, true);
  assert.equal(w.sent, 1, "pressed exactly once");
  assert.equal(w.mouse.filter((m) => m.type === "mousePressed").length, 1);
  await w.fails("chrome_send", { heldId: r.heldId }, "held_gone");
  assert.equal((await w.call("chrome_status")).held.length, 1);
});

test("a held item expires, and is dropped when its tab goes", async () => {
  const w = await ready();
  await w.call("chrome_snapshot");
  const r = await w.call("chrome_act", { ref: "e7", action: "click" });
  w.clock += 11 * 60_000;
  await w.fails("chrome_send", { heldId: r.heldId }, "held_gone");
  await w.call("chrome_snapshot");
  const h2 = await w.call("chrome_act", { ref: "e7", action: "click" });
  for (const f of w.removedListeners) f(7);
  await w.advance(0);
  assert.equal((await w.call("chrome_status")).held.includes(h2.heldId), false);
});

test("a click by coordinates is judged by what is under the point", async () => {
  const w = await ready();
  const free = await w.call("chrome_click", { x: 120, y: 225 });
  assert.equal(free.ok, true);
  assert.equal(w.tabs.get(7).url, "https://acme.test/pricing");
  const w2 = await ready();
  const held = await w2.call("chrome_click", { x: 120, y: 375 });
  assert.equal(held.ok, false);
  assert.ok(held.heldId, "Send message under the point");
  assert.equal(w2.mouse.length, 0);
  await w2.fails("chrome_click", { x: 5 }, "bad_input");
  const none = await w2.call("chrome_click", { x: 900, y: 700 });
  assert.equal(none.ok, true, "empty space is free");
  const sent = await w2.call("chrome_send", { heldId: held.heldId });
  assert.equal(sent.sent, false, "a click by coordinates cannot be replayed safely");
});

test("check, uncheck, hover, focus, select and scroll", async () => {
  const w = await ready();
  await w.call("chrome_snapshot");
  const on = await w.call("chrome_act", { ref: "e5", action: "check" });
  assert.equal(on.ok, true);
  const already = await w.call("chrome_act", { ref: "e5", action: "check" });
  assert.deepEqual([already.ok, /already checked/.test(already.why)], [true, true]);
  assert.equal(w.mouse.filter((m) => m.type === "mousePressed").length, 1, "an already checked box is not clicked again");
  const off = await w.call("chrome_act", { ref: "e5", action: "uncheck" });
  assert.equal(off.ok, true);
  const mouseBefore = w.mouse.length;
  assert.equal((await w.call("chrome_act", { ref: "e4", action: "hover" })).ok, true);
  assert.deepEqual(w.mouse.slice(mouseBefore).map((m) => m.type), ["mouseMoved"]);
  assert.equal((await w.call("chrome_act", { ref: "e1", action: "focus" })).ok, true);
  assert.equal(w.page(7).focused, 0);
  assert.equal((await w.call("chrome_act", { ref: "e8", action: "select", value: "Pro" })).ok, true);
  const bad = await w.call("chrome_act", { ref: "e8", action: "select", value: "Gold" });
  assert.deepEqual([bad.ok, /no option called "Gold"/.test(bad.why)], [false, true]);
  const sc = await w.call("chrome_act", { action: "scroll", value: "bottom" });
  assert.equal(sc.ok, true);
  assert.deepEqual(w.scrolled, [null, "bottom"]);
  await w.fails("chrome_act", { action: "click" }, "bad_input");
});

test("pressing Enter in a field of a form whose submit is a send is held; other keys go through", async () => {
  const w = await ready();
  await w.call("chrome_snapshot");
  const r = await w.call("chrome_act", { ref: "e6", action: "press", value: "Enter" });
  assert.equal(r.ok, false);
  assert.ok(r.heldId);
  assert.equal(w.sent, 0);
  assert.equal(w.keys.filter((k) => k.key === "Enter").length, 0);
  const tab = await w.call("chrome_act", { ref: "e6", action: "press", value: "Tab" });
  assert.equal(tab.ok, true);
  const approved = await w.call("chrome_send", { heldId: r.heldId });
  assert.equal(approved.sent, true);
  assert.equal(w.sent, 1);
  assert.equal(w.keys.filter((k) => k.key === "Enter" && k.type === "keyDown").length, 1);
  await w.call("chrome_snapshot");
  const search = await w.call("chrome_act", { ref: "e1", action: "press", value: "Enter" });
  assert.equal(search.ok, true, "Enter in a field with no form to submit is free");
  await w.fails("chrome_act", { action: "press" }, "bad_input");
});

// ---------- type, fill, secrets ----------

test("type puts text in a field, and submit holds when the form's submit is a send", async () => {
  const w = await ready();
  await w.call("chrome_snapshot");
  const r = await w.call("chrome_type", { ref: "e1", text: "dana@acme.test" });
  assert.equal(r.ok, true);
  assert.equal(w.page(7).values[0], "dana@acme.test");
  assert.equal(w.page(7).focused, 0);
  const held = await w.call("chrome_type", { ref: "e6", text: "Hello there", submit: true });
  assert.equal(held.ok, true, "the typing is done");
  assert.ok(held.heldId, "the submit is held");
  assert.equal(w.sent, 0);
  assert.equal(w.page(7).values[5], "Hello there");
  const free = await w.call("chrome_type", { ref: "e1", text: "!" });
  assert.equal(free.ok, true);
  await w.fails("chrome_type", { ref: "e99", text: "x" }, "unknown_ref");
});

test("text is never typed into a secret field; a Vault handle fills it and the value never reaches the agent", async () => {
  const w = await ready();
  await w.call("chrome_snapshot");
  await w.fails("chrome_type", { ref: "e2", text: "my-password" }, "secret_field");
  assert.equal(w.typed.length, 0);
  const r = await w.call("chrome_type", { ref: "e2", text: "#Acme.password" });
  assert.equal(r.ok, true);
  assert.deepEqual(w.fillRequests.map((q) => [q.type, q.name, q.input.handle, q.input.target.kind, q.extra.agent, q.extra.space]), [["invoke", "vault.fill", "#Acme.password", "browser", "agt_intake", "spc_a"]]);
  assert.match(w.fillRequests[0].input.target.ref, /^ag\d+-[0-9a-f]{24}$/);
  assert.equal(w.page(7).secretValues[1], SECRET, "the page holds the value");
  assert.ok(w.page(7).secrets.has(1), "and remembers it came from the Vault");
  assert.ok(w.keys.some((k) => k.commands && k.commands.includes("selectAll")), "the field was cleared first");
  const snap = await w.call("chrome_snapshot");
  assert.match(snap.tree, /textbox "Password" \[ref=e2\]( \(focused\))? value=•+ \(12 characters\)/);
  const everything = JSON.stringify([r, snap, w.events, w.results]);
  assert.doesNotMatch(everything, new RegExp(SECRET), "no result or event carries the value");
  w.page(7).values[0] = "";
  const user = await w.call("chrome_fill", { fields: [{ ref: "e1", value: "#Acme.username" }, { ref: "e2", value: "#Acme.password" }] });
  assert.deepEqual([user.ok, user.filled], [true, 2]);
  assert.match((await w.call("chrome_snapshot")).tree, /textbox "Email" \[ref=e1\] \(secret/, "a field filled from the Vault stays masked");
});

test("a handle the Vault will not fill is a plain failure, not a typed handle", async () => {
  const w = await ready({ fillFails: true });
  await w.call("chrome_snapshot");
  await w.fails("chrome_type", { ref: "e2", text: "#Acme.password" }, "fill_failed");
  assert.equal(w.typed.length, 0, "the handle text was not typed into the page");
});

test("fill types text fields and reports how many it filled", async () => {
  const w = await ready();
  await w.call("chrome_snapshot");
  const r = await w.call("chrome_fill", { fields: [{ ref: "e1", value: "a@b.test" }, { ref: "e6", value: "Hi" }] });
  assert.deepEqual([r.ok, r.filled], [true, 2]);
  assert.equal(w.page(7).values[0], "a@b.test");
  const partial = await w.call("chrome_fill", { fields: [{ ref: "e1", value: "ok" }, { ref: "e2", value: "plain secret" }] }).catch((e) => ({ code: e.code }));
  assert.equal(partial.code, "secret_field");
  await w.fails("chrome_fill", { fields: [] }, "bad_input");
  await w.fails("chrome_fill", { fields: [{ ref: "e1" }] }, "bad_input");
});

test("a screenshot is taken with secret fields blurred, then restored; a ref clips to its element", async () => {
  const w = await ready();
  await w.call("chrome_snapshot");
  const r = await w.call("chrome_screenshot");
  assert.deepEqual([r.image, r.mime, r.width, r.height], ["UE5H", "image/png", 1280, 800]);
  assert.deepEqual(w.blurLog, [true, false], "blurred for the capture, restored after");
  assert.equal(w.shots[0].blurred, true, "the capture saw the blur");
  const full = await w.call("chrome_screenshot", { fullPage: true });
  assert.deepEqual([full.width, full.height, w.shots[1].params.captureBeyondViewport], [1280, 2400, true]);
  const el = await w.call("chrome_screenshot", { ref: "e1" });
  assert.deepEqual([el.width, el.height], [200, 30]);
  assert.deepEqual(w.shots[2].params.clip, { x: 20, y: 60, width: 200, height: 30, scale: 1 });
});

// ---------- open, tabs ----------

test("open navigates the current tab, refuses private addresses, and never opens one tab per step", async () => {
  const w = await ready();
  const r = await w.call("chrome_open", { url: "https://other.test/page" });
  assert.deepEqual([r.tabId, r.url], ["7", "https://other.test/page"]);
  assert.equal(w.tabs.size, 1, "the open tab was reused");
  await w.fails("chrome_open", { url: "http://localhost:3000/" }, "not_public");
  await w.fails("chrome_open", { url: "http://169.254.169.254/" }, "not_public");
  await w.fails("chrome_open", { url: "ftp://a.test/" }, "bad_input");
  assert.equal(w.navigations.length, 1, "the refused addresses were never navigated to");
  const n = await w.call("chrome_open", { url: "https://third.test/", newTab: true });
  assert.notEqual(n.tabId, "7");
  assert.equal(w.tabs.size, 2);
});

test("a redirect into the box lands on a blank page and is refused", async () => {
  const w = await ready();
  const nav = w.ext.debugger.sendCommand;
  w.ext.debugger.sendCommand = async (t, method, params) => {
    const out = await nav(t, method, params);
    if (method === "Page.navigate" && params.url === "https://sneaky.test/") { const tab = w.tabs.get(7); tab.url = "http://192.168.0.1/admin"; }
    return out;
  };
  await w.fails("chrome_open", { url: "https://sneaky.test/" }, "not_public");
  assert.equal(w.navigations[w.navigations.length - 1], "about:blank");
});

test("tabs: an agent lists, uses and closes only the tabs it opened or was given; there is a limit", async () => {
  const w = await ready({}).then(async (x) => { await x.optIn("personal"); return x; });
  await w.fails("chrome_snapshot", {}, "no_tab");
  assert.deepEqual((await w.call("chrome_tabs", { action: "list" })).tabs, []);
  const first = await w.call("chrome_open", { url: "https://one.test/" });
  assert.notEqual(first.tabId, "7", "the person's tab is left alone");
  assert.equal(w.tabs.get(7).url, "https://acme.test/login");
  await w.fails("chrome_tabs", { action: "close", tabId: "7" }, "not_yours");
  const list = await w.call("chrome_tabs", { action: "list" });
  assert.deepEqual(list.tabs.map((t) => [t.tabId, t.url, t.active]), [[first.tabId, "https://one.test/", true]]);
  const used = await w.call("chrome_tabs", { action: "use", tabId: "7" });
  assert.equal(used.tabs.length, 2, "the person's active tab can be handed over by using it");
  assert.match((await w.call("chrome_snapshot")).tree, /Email/);
  const closed = await w.call("chrome_tabs", { action: "close", tabId: first.tabId });
  assert.equal(closed.tabs.length, 1);
  assert.equal(w.tabs.has(Number(first.tabId)), false);
  for (let i = 0; i < 7; i++) await w.call("chrome_tabs", { action: "new" });
  await w.fails("chrome_tabs", { action: "new" }, "tab_limit");
  await w.fails("chrome_tabs", { action: "new", url: "http://localhost/" }, "tab_limit");
});

test("a tab someone else is driving is busy, and a tab that closes ends its session", async () => {
  const w = await ready();
  await w.call("chrome_snapshot");
  const scout = { id: "agt_scout", name: "Scout" };
  await w.fails("chrome_snapshot", {}, "busy", scout);
  for (const f of w.removedListeners) f(7);
  await w.advance(0);
  assert.equal(w.eventsOf("driving").filter((e) => !e.on)[0].why, "closed");
});

test("a page Chrome will not let the extension control is not driven", async () => {
  const w = await ready();
  await w.call("chrome_snapshot");
  w.tabs.get(7).url = "chrome://settings";
  await w.fails("chrome_snapshot", {}, "no_page");
  const d = await ready({ denyAttach: true });
  await d.fails("chrome_snapshot", {}, "debugger_denied");
  assert.equal(d.overlay.size, 0, "no frame on a tab that could not be controlled");
  assert.equal(d.eventsOf("driving").filter((e) => e.on).length, 1);
  assert.equal(d.eventsOf("driving").filter((e) => !e.on)[0].why, "denied");
  assert.equal(d.badge[7], "", "and no beacon");
});

// ---------- wait, state, inspect, eval ----------

test("wait for load, text, selector, network idle and time", async () => {
  const w = await ready();
  assert.deepEqual((await w.call("chrome_wait", { until: "load" })).ok, true);
  assert.equal((await w.call("chrome_wait", { until: "text", value: "Welcome to Acme" })).ok, true);
  const missing = await w.call("chrome_wait", { until: "text", value: "never appears", timeoutMs: 300 });
  assert.equal(missing.ok, false);
  assert.ok(missing.waitedMs >= 300);
  w.page(7).selectors = ["#late"];
  assert.equal((await w.call("chrome_wait", { until: "selector", value: "#late" })).ok, true);
  const t = await w.call("chrome_wait", { until: "time", value: "250" });
  assert.deepEqual([t.ok, t.waitedMs], [true, 250]);
  w.emit(7, "Network.requestWillBeSent", { requestId: "q1", request: { method: "GET", url: "https://acme.test/api/a" }, type: "XHR", timestamp: 1 });
  const idle = w.call("chrome_wait", { until: "network_idle", timeoutMs: 5000 });
  const r = await idle;
  assert.equal(r.ok, false, "a request still in flight is not idle");
  w.emit(7, "Network.loadingFinished", { requestId: "q1", timestamp: 1.2 });
  assert.equal((await w.call("chrome_wait", { until: "network_idle", timeoutMs: 5000 })).ok, true);
  await w.fails("chrome_wait", { until: "text" }, "bad_input");
});

test("state, inspect and eval answer from the page, masked", async () => {
  const w = await ready();
  const st = await w.call("chrome_state");
  assert.deepEqual(st, { url: "https://acme.test/login", title: "Acme sign in", loading: false });
  await w.call("chrome_snapshot");
  const el = await w.call("chrome_inspect", { ref: "e2" });
  assert.equal(el.element.secret, true);
  assert.equal(el.element.attributes.value, MASK);
  assert.equal(el.element.name, "Password");
  w.evalValue = { user: "dana", api_key: "sk_live_1", n: [1, 2] };
  const ev = await w.call("chrome_eval", { expression: "window.__state" });
  assert.deepEqual(ev.result, { user: "dana", api_key: MASK, n: [1, 2] });
  w.page(7).secretValues[1] = SECRET;
  w.evalValue = "the password is " + SECRET;
  assert.equal((await w.call("chrome_eval", { expression: "document.querySelector('[type=password]').value" })).result, `the password is ${MASK}`);
  w.evalThrows = true;
  const e = await w.fails("chrome_eval", { expression: "x" }, "page_error");
  assert.doesNotMatch(e.message, /token=zzz/, "the error text is scrubbed of query strings");
});

// ---------- net, console, sources ----------

test("net lists requests with timing, masks credentials, and fetches bodies on request", async () => {
  const w = await ready();
  await w.call("chrome_snapshot");
  w.emit(7, "Network.requestWillBeSent", { requestId: "r1", request: { method: "POST", url: "https://acme.test/api/login?token=abc&x=1", headers: { Authorization: "Bearer zzzzzzzzzzzz", "Content-Type": "application/json" }, postData: JSON.stringify({ email: "a@b.test", password: SECRET }) }, type: "Fetch", timestamp: 10 });
  w.emit(7, "Network.responseReceived", { requestId: "r1", response: { status: 200, mimeType: "application/json" } });
  w.emit(7, "Network.loadingFinished", { requestId: "r1", timestamp: 10.25 });
  w.emit(7, "Network.requestWillBeSent", { requestId: "r2", request: { method: "GET", url: "https://acme.test/static/app.js" }, type: "Script", timestamp: 11 });
  const plain = await w.call("chrome_net");
  assert.deepEqual(plain.requests, [{ method: "GET", url: "https://acme.test/static/app.js" }, { method: "POST", url: `https://acme.test/api/login?token=${MASK}&x=1`, status: 200, ms: 250 }]);
  const filtered = await w.call("chrome_net", { filter: "login" });
  assert.equal(filtered.requests.length, 1);
  w.page(7).secretValues[1] = SECRET;
  const bodies = await w.call("chrome_net", { filter: "login", bodies: true });
  const row = bodies.requests[0];
  assert.equal(row.body, JSON.stringify({ ok: true, password: MASK, rows: 3 }));
  assert.equal(row.requestBody, JSON.stringify({ email: "a@b.test", password: MASK }));
  assert.doesNotMatch(JSON.stringify(bodies), new RegExp(SECRET));
  assert.doesNotMatch(JSON.stringify(bodies), /zzzzzzzzzzzz/);
});

test("console and sources are kept per tab and scrubbed", async () => {
  const w = await ready();
  await w.call("chrome_snapshot");
  w.page(7).secretValues[1] = SECRET;
  w.emit(7, "Runtime.consoleAPICalled", { type: "log", args: [{ value: "hello" }, { value: "pw " + SECRET }], timestamp: Date.UTC(2026, 9, 25) });
  w.emit(7, "Runtime.consoleAPICalled", { type: "warning", args: [{ value: "careful" }], timestamp: Date.UTC(2026, 9, 25) });
  w.emit(7, "Runtime.exceptionThrown", { exceptionDetails: { text: "Uncaught", exception: { description: "TypeError: x" } }, timestamp: Date.UTC(2026, 9, 25) });
  const all = await w.call("chrome_console");
  assert.deepEqual(all.messages.map((m) => [m.level, m.text]), [["log", `hello pw ${MASK}`], ["warn", "careful"], ["error", "TypeError: x"]]);
  assert.deepEqual((await w.call("chrome_console", { level: "error" })).messages.map((m) => m.text), ["TypeError: x"]);
  assert.equal((await w.call("chrome_console", { limit: 1 })).messages.length, 1);
  w.emit(7, "Network.requestWillBeSent", { requestId: "s1", request: { method: "GET", url: "https://acme.test/api/items?page=1" }, type: "XHR", timestamp: 1 });
  w.emit(7, "Network.requestWillBeSent", { requestId: "s2", request: { method: "GET", url: "https://acme.test/api/items?page=2" }, type: "XHR", timestamp: 2 });
  w.emit(7, "Network.requestWillBeSent", { requestId: "s3", request: { method: "POST", url: "https://acme.test/api/items" }, type: "Fetch", timestamp: 3 });
  w.emit(7, "Network.requestWillBeSent", { requestId: "s4", request: { method: "GET", url: "https://cdn.acme.test/app.js" }, type: "Script", timestamp: 4 });
  const src = await w.call("chrome_sources");
  assert.deepEqual(src.endpoints, [{ method: "POST", url: "https://acme.test/api/items" }, { method: "GET", url: "https://acme.test/api/items" }]);
  assert.deepEqual(src.scripts, ["https://cdn.acme.test/app.js"]);
});

// ---------- api ----------

test("api calls the site the tab is on with the page's session, and masks what comes back", async () => {
  const w = await ready();
  const r = await w.call("chrome_api", { method: "GET", url: "/api/items" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.headers, { "content-type": "application/json", "set-cookie": MASK, "x-request-id": "r1" });
  assert.deepEqual(r.body, { items: [{ id: 1 }], api_key: MASK, token: MASK });
  assert.deepEqual([w.apiCalls[0].method, w.apiCalls[0].url, w.apiCalls[0].body], ["GET", "https://acme.test/api/items", null]);
  const post = await w.call("chrome_api", { method: "POST", url: "https://acme.test/api/items", headers: { "X-Trace": "1", Cookie: "steal=1", Host: "evil" }, body: { name: "n" } });
  assert.equal(post.status, 200);
  assert.deepEqual(w.apiCalls[1].headers, { "X-Trace": "1", "content-type": "application/json" }, "forbidden headers are dropped, JSON bodies get their type");
  assert.equal(w.apiCalls[1].body, JSON.stringify({ name: "n" }));
  await w.fails("chrome_api", { method: "GET", url: "https://evil.test/steal" }, "cross_origin");
  await w.fails("chrome_api", { method: "GET", url: "http://acme.test/api" }, "cross_origin");
  await w.fails("chrome_api", { method: "GET", url: "https://acme.test/x", headers: { Authorization: "Bearer #Acme.api_key" } }, "handle_unsupported");
  w.apiReply = { status: 200, mime: "text/plain", headers: {}, body: `pw=${SECRET} Bearer abcdefghijklmnop`, truncated: true };
  w.page(7).secretValues[1] = SECRET;
  const text = await w.call("chrome_api", { method: "GET", url: "/echo" });
  assert.equal(text.truncated, true);
  assert.doesNotMatch(JSON.stringify(text), new RegExp(`${SECRET}|abcdefghijklmnop`));
});

// ---------- batch, plan ----------

test("batch runs steps in order and stops at the first held item or failure; nothing needing the Gate runs inside it", async () => {
  const w = await ready();
  await w.call("chrome_snapshot");
  const r = await w.call("chrome_batch", { steps: [{ tool: "chrome_act", args: { ref: "e5", action: "check" } }, { tool: "chrome_act", args: { ref: "e7", action: "click" } }, { tool: "chrome_snapshot", args: {} }] });
  assert.deepEqual(r.results.map((x) => [x.tool, x.ok]), [["chrome_act", true], ["chrome_act", false]]);
  assert.ok(r.results[1].heldId, "the batch stopped at the held send");
  assert.equal(w.sent, 0);
  for (const [tool, args] of [["chrome_send", { heldId: r.results[1].heldId }], ["chrome_stop", {}], ["chrome_eval", { expression: "1" }], ["chrome_batch", { steps: [] }]]) {
    const out = await w.call("chrome_batch", { steps: [{ tool, args }] });
    assert.deepEqual([out.results[0].ok, out.results[0].result.error.code], [false, "not_in_batch"], tool);
  }
  const post = await w.call("chrome_batch", { steps: [{ tool: "chrome_api", args: { method: "POST", url: "/x" } }] });
  assert.equal(post.results[0].result.error.code, "not_in_batch");
  assert.equal(w.apiCalls.length, 0);
  const bad = await w.call("chrome_batch", { steps: [{ tool: "chrome_act", args: { ref: "e99", action: "click" } }, { tool: "chrome_snapshot", args: {} }] });
  assert.equal(bad.results.length, 1);
  assert.equal(bad.results[0].result.error.code, "unknown_ref");
  await w.fails("chrome_batch", { steps: [] }, "bad_input");
});

test("every action is logged under the agent with a short, scrubbed sentence", async () => {
  const w = await ready();
  await w.call("chrome_snapshot");
  await w.call("chrome_act", { ref: "e4", action: "click" });
  await w.call("chrome_open", { url: "https://other.test/reset?token=SECRET123" });
  await w.fails("chrome_open", { url: "http://localhost/" }, "not_public");
  const acted = w.eventsOf("acted");
  assert.deepEqual(acted.map((e) => [e.agent, e.tool, e.ok]), [["agt_intake", "chrome_snapshot", true], ["agt_intake", "chrome_act", true], ["agt_intake", "chrome_open", true], ["agt_intake", "chrome_open", false]]);
  assert.ok(acted.every((e) => e.summary.length <= 200));
  assert.doesNotMatch(JSON.stringify(w.events), /SECRET123/);
  assert.equal(w.eventsOf("acted").filter((e) => e.tool === "chrome_status").length, 0);
});

// ---------- the channel to the app ----------

test("a call from the app is answered over the channel with the output or an error in words", async () => {
  const w = makeWorld();
  await w.control.onIncoming({ type: "agent.optin", spaces: ["spc_a"], mode: "computer" });
  await w.control.onIncoming({ type: "agent.call", id: "c1", tool: "chrome_snapshot", input: {}, agent: w.agent, space: "spc_a" });
  await w.control.onIncoming({ type: "agent.call", id: "c2", tool: "chrome_act", input: { ref: "e1", action: "click" }, agent: w.agent, space: "spc_a" });
  await w.control.onIncoming({ type: "agent.call", id: "c3", tool: "chrome_snapshot", input: { bogus: 1 }, agent: w.agent, space: "spc_a" });
  await w.control.onIncoming({ type: "agent.call", id: "c4", tool: "chrome_snapshot", input: {}, agent: w.agent, space: "spc_other" });
  await w.control.onIncoming({ type: "bogus" });
  assert.deepEqual(w.results.map((r) => [r.op, r.callId, r.ok]), [["agent.result", "c1", true], ["agent.result", "c2", true], ["agent.result", "c3", false], ["agent.result", "c4", false]]);
  assert.match(w.results[0].output.tree, /Email/);
  assert.equal(w.results[2].error.code, "bad_input");
  assert.equal(w.results[3].error.code, "wrong_space");
  assert.match(w.results[3].error.message, /not the active Space/);
});

// ---------- the source itself ----------

test("the agent code has no network of its own, no stored data and no logging", () => {
  const dir = path.join(ROOT, "src/agent");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
  assert.ok(files.length >= 12, `found ${files.length} files`);
  for (const f of files) {
    const bare = fs.readFileSync(path.join(dir, f), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest|new WebSocket|sendBeacon|EventSource/.test(bare), `${f} opens a connection of its own`);
    assert.ok(!/\beval\s*\(|new Function\(|innerHTML\s*=|document\.write/.test(bare), `${f} runs or injects text as code`);
    assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(bare), `${f} keeps data of its own`);
    assert.ok(!/storage\.(local|session|sync)\.(set|get|remove)/.test(bare), `${f} reaches storage directly`);
    assert.ok(!/console\.(log|info|debug|warn|error)/.test(bare), `${f} logs`);
    assert.ok(!/navigator\.credentials|PublicKeyCredential/.test(bare), `${f} touches WebAuthn`);
    assert.ok(!/@ts-nocheck|@ts-ignore/.test(fs.readFileSync(path.join(dir, f), "utf8")), `${f} turns off type checking`);
  }
});

test("only the page's own network is used, and only by chrome_api", () => {
  const page = fs.readFileSync(path.join(ROOT, "src/agent/page.js"), "utf8");
  const uses = page.split("\n").filter((l) => /\["fetch"\]/.test(l));
  assert.equal(uses.length, 1, "one place reaches the page's network");
  const tools = fs.readFileSync(path.join(ROOT, "src/agent/tools.js"), "utf8");
  assert.equal((tools.match(/pageRequest/g) || []).length, 2, "imported once, called once");
});
