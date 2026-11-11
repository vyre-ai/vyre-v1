// Vault values in the Space browser (sbrowser audit bugs 2 and 5, 12 Nov): a value an agent's profile was given, by a tool that typed it or by the Vault channel that Vyre for Chrome fills from, never
// comes back in any browser answer, in a picture kept in Files, or to another person who asks the same agent; and a fill is always looked up as the person whose call it rides, for that call only.
// The browser is a stand-in; the real one is sbrowser.heavy.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { bindFill, bindKit, forgetSecrets } from "../projections.ts";
import { bindSpaceBrowser } from "../sbrowser/port.ts";
import { resetAgentInfo } from "../sbrowser/agentinfo.ts";
import type { BrowserAnswer, BrowserToolCall, SpaceBrowser } from "../sbrowser/port.ts";
import { createFillService } from "../handlers/fill.ts";
import type { FillSource } from "../handlers/fill.ts";
import { createVault } from "../../../images/agent-computer/agentd/vault.ts";
import { codeOf, DANA, harness, OMAR } from "../fixtures/harness.ts";
import { tool } from "./tools.fixture.ts";

const KEY = "sk-live-DEX-0123456789abcdef";
const OTP = "842913-ONE-TIME";

function browser(answers: Record<string, (c: BrowserToolCall) => BrowserAnswer | Promise<BrowserAnswer>> = {}) {
  const calls: BrowserToolCall[] = [];
  let shots = 0;
  const sb: SpaceBrowser = {
    async available() { return true; },
    async tool(a) { calls.push(a); return (answers[a.tool] ?? (() => ({ url: "https://example.com/", title: "Example", tree: "- page [e1]", truncated: false, ok: true, tabId: "t1", loading: false })))(a); },
    async downloads() { return []; }, async downloadRead() { return new Uint8Array(); }, async downloadAck() {},
    async takeover() {}, async giveBack() {}, async screenshot() { shots += 1; return { bytes: new Uint8Array([1, 2, 3]), width: 1, height: 1 }; },
    async stream() { return { transport: "mjpeg", url: "http://x" }; }, async sessions() { return []; }, async signOut() { return true; }, async importChrome() { return { bytes: 0 }; }, async stop() {}, async forget() {},
    async profiles() { return { profiles: [], maxRunning: 6 }; }, async health() { return { ok: true }; },
  };
  bindSpaceBrowser(sb);
  return { calls, shots: () => shots };
}
const as = (id: string, person: string) => harness({ principal: { kind: "agent", id }, actingFor: person });
const off = (): void => { resetAgentInfo(); bindSpaceBrowser(null); bindFill(null); bindKit(null); forgetSecrets("agt_dex"); };

/** The Vault channel the daemon binds (setComputersFill): the real fill service over a table of values, as Dana or Omar. */
function channel(table: Record<string, Record<string, string>>) {
  const asked: Array<{ handle: string; asker: string }> = [];
  const source: FillSource = {
    async lookup(handle, who) {
      asked.push({ handle, asker: who.asker });
      const v = table[who.asker]?.[handle];
      return v === undefined ? { kind: "denied", reason: "no_access" } : { kind: "value", itemId: `itm_${handle.replace(/\W/g, "")}`, value: v };
    },
  };
  const service = createFillService({ source, log: () => undefined });
  const live: Array<{ token: string; asker: string; revoked: boolean }> = [];
  bindFill({
    async issue(h) { const g = await service.issue(h); const rec = { token: g.fillToken, asker: h.asker, revoked: false }; live.push(rec); return { fillToken: g.fillToken, revoke() { rec.revoked = true; g.revoke(); } }; },
    url: () => "http://vyre-host/computers/fill",
  });
  /** What Vyre for Chrome in the profile gets when it asks the channel for one handle with this token. */
  const fill = (token: string, handle: string) => {
    const [h, field] = handle.slice(1).split(".");
    return service.serve({ authorization: `Bearer ${token}`, body: { handle: h, field, computerId: "agt_dex" } });
  };
  return { asked, live, fill };
}

test("B (production wiring): with no scrubber bound, as a daemon binds none, a value a tool filled is taken out of every later answer", async () => {
  bindKit(null);
  const b = browser({
    chrome_fill: () => ({ ok: true, filled: 1, used: [{ handle: "#Dex_Api.key", itemId: "itm_1", value: KEY }] }),
    chrome_snapshot: () => ({ url: "https://example.com/", title: "Keys", tree: `- textbox [e3] value "${KEY}" (base64 ${Buffer.from(KEY).toString("base64")})`, truncated: false }),
  });
  try {
    const dex = as("agt_dex", DANA).ctx;
    await tool["computers.chrome.fill"]!(dex, { fields: [{ ref: "e3", value: "#Dex_Api.key" }] });
    const snap = await tool["computers.chrome.snapshot"]!(dex, {});
    assert.equal(JSON.stringify(snap).includes(KEY), false, JSON.stringify(snap));
    assert.equal(JSON.stringify(snap).includes(Buffer.from(KEY).toString("base64")), false, "nor its base64 spelling");
    assert.match(snap.tree, /\[#Dex_Api\.key\]/);
    assert.equal(b.calls.filter((c) => c.tool !== "chrome_tabs").length, 2, "the two calls the agent made (the module lists the tabs after a fill)");
  } finally { off(); }
});

test("B: a value Vyre for Chrome filled through the Vault channel is taken out of eval, snapshot, inspect, console and network answers, to anyone who asks the same agent", async () => {
  const ch = channel({ [DANA]: { "#Dex_Api.key": KEY, "#Dex_Bank.otp": OTP } });
  let token = "";
  const leak = `${KEY} ${OTP}`;
  browser({
    // while Dana's call opens the page, the extension in the profile fills the key and the code into text fields, through the channel that rides this call
    chrome_open: async (c) => { token = c.fill!.token; for (const h of ["#Dex_Api.key", "#Dex_Bank.otp"]) assert.equal((await ch.fill(token, h)).status, 200); return { tabId: "t1", url: String(c.args["url"]), title: "Keys" }; },
    chrome_eval: () => ({ result: `document.querySelector('input').value = ${leak}` }),
    chrome_snapshot: () => ({ url: "https://example.com/", title: "Keys", tree: `- textbox [e3] value "${KEY}"\n- textbox [e4] value "${OTP}"`, truncated: false }),
    chrome_inspect: () => ({ element: { role: "textbox", value: KEY, attributes: { type: "text", value: OTP } } }),
    chrome_console: () => ({ messages: [{ level: "log", text: `debug key=${KEY}`, at: 1 }] }),
    chrome_net: () => ({ requests: [{ method: "POST", url: `https://api.example.com/?k=${encodeURIComponent(KEY)}`, status: 200, ms: 3, body: `otp=${OTP}` }] }),
  });
  try {
    await tool["computers.chrome.open"]!(as("agt_dex", DANA).ctx, { url: "https://example.com/keys" });
    assert.deepEqual(ch.asked.map((x) => x.asker), [DANA, DANA], "looked up as Dana, whose call it was");
    // Omar asks the same team agent to read the page back
    const omar = as("agt_dex", OMAR).ctx;
    const answers = [
      await tool["computers.chrome.eval"]!(omar, { expression: "document.querySelector('input').value" }),
      await tool["computers.chrome.snapshot"]!(omar, {}),
      await tool["computers.chrome.inspect"]!(omar, { ref: "e3" }),
      await tool["computers.chrome.console"]!(omar, {}),
      await tool["computers.chrome.net"]!(omar, { bodies: true }),
    ];
    for (const a of answers) {
      const t = JSON.stringify(a);
      assert.equal(t.includes(KEY) || t.includes(OTP) || t.includes(encodeURIComponent(KEY)), false, t.replaceAll(KEY, "<KEY>").replaceAll(OTP, "<OTP>"));
    }
  } finally { off(); }
});

test("B: no picture is kept or handed out of a tab that holds a value filled from the Vault", async () => {
  const b = browser({
    chrome_fill: () => ({ ok: true, filled: 1, used: [{ handle: "#Dex_Api.key", itemId: "itm_1", value: KEY }] }),
    chrome_tabs: () => ({ tabs: [{ tabId: "t1", url: "https://example.com/", title: "x", active: true }] }),
    chrome_screenshot: () => ({ png: "iVBORw0KGgo=", width: 1280, height: 800 }),
  });
  try {
    const h = as("agt_dex", DANA);
    await tool["computers.chrome.open"]!(h.ctx, { url: "https://example.com/" });
    const before = b.shots();
    assert.ok(before >= 1, "an ordinary step has its picture");
    await tool["computers.chrome.fill"]!(h.ctx, { fields: [{ ref: "e3", value: "#Dex_Api.key" }] });
    await tool["computers.chrome.click"]!(h.ctx, { ref: "e9" });
    assert.equal(b.shots(), before, "the fill step and the next one keep no picture of the tab");
    const files = h.calls("files.create").length;
    await assert.rejects(() => tool["computers.chrome.screenshot"]!(h.ctx, {}), (e) => codeOf(e) === "validation.bad_input" && /holds a value filled from the Vault/.test(JSON.stringify(e)));
    assert.equal(h.calls("files.create").length, files, "and no screenshot of it is stored");
  } finally { off(); }
});

test("C: one team agent working for two people at once: each call carries its own person's channel, a fill is looked up as that person, and no channel outlives its calls", async () => {
  const ch = channel({ [DANA]: { "#Dana_Site.password": "dana-pass-0123" }, [OMAR]: { "#Omar_Site.password": "omar-pass-0123" } });
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const seen: Record<string, string> = {};
  browser({
    // Dana's call waits on the page while Omar's call runs: both are in at once
    chrome_wait: async (c) => { seen["dana"] = c.fill!.token; await gate; return { ok: true, waitedMs: 1 }; },
    chrome_state: (c) => { seen["omar"] = c.fill!.token; return { url: "https://example.com/", title: "x", loading: false }; },
  });
  try {
    const danaCall = tool["computers.chrome.wait"]!(as("agt_dex", DANA).ctx, { text: "Done", timeoutMs: 5000 });
    await new Promise((r) => setTimeout(r, 20));
    await tool["computers.chrome.state"]!(as("agt_dex", OMAR).ctx, {});
    assert.ok(seen["dana"] && seen["omar"] && seen["dana"] !== seen["omar"], "two channels, one per person");
    assert.equal(ch.live.find((g) => g.token === seen["dana"])!.revoked, false, "Omar's call did not end Dana's channel while her call runs");
    // through Dana's channel the Vault answers as Dana: her item fills, Omar's does not
    assert.equal((await ch.fill(seen["dana"]!, "#Dana_Site.password")).status, 200);
    assert.equal((await ch.fill(seen["dana"]!, "#Omar_Site.password")).status, 403, "Omar's item is not Dana's to fill");
    assert.equal((await ch.fill(seen["omar"]!, "#Omar_Site.password")).status, 401, "Omar's call ended, and its channel with it");
    release();
    await danaCall;
    assert.equal((await ch.fill(seen["dana"]!, "#Dana_Site.password")).status, 401, "after her turn nothing fills as Dana");
    assert.ok(ch.live.every((g) => g.revoked), "every channel ended with its calls");
    assert.deepEqual(ch.asked.map((x) => x.asker), [DANA, DANA], "every lookup was as the person whose call carried it");
  } finally { off(); }
});

test("C (in the browser service): the extension fills through the channel every running call shares; calls of two people at once share none, and none is left when the last call ends", async () => {
  const v = createVault();
  assert.equal(v.hasChannel(), false, "no call, no channel");
  const dana = v.enter("http://vyre-host/fill", "d".repeat(24), "agt_dex");
  assert.equal(v.hasChannel(), true);
  const dana2 = v.enter("http://vyre-host/fill", "d".repeat(24), "agt_dex");
  assert.equal(v.hasChannel(), true, "two calls of the same person share her channel");
  const omar = v.enter("http://vyre-host/fill", "o".repeat(24), "agt_dex");
  assert.equal(v.hasChannel(), false, "calls of two people at once: the extension fills as neither");
  await assert.rejects(() => v.value("#Dana_Site.password"), /no channel/);
  omar.leave();
  assert.equal(v.hasChannel(), true);
  dana.leave(); dana2.leave();
  assert.equal(v.hasChannel(), false, "after the last call nothing is left to fill with");
  await assert.rejects(() => v.value("#Dana_Site.password"), /no channel/);
});

// ---- review finding 1: error answers ----------------------------------------------------------------------------------------------------------------

/** Every Chrome tool, with an input it accepts (tools.contract.test.ts has the same list). */
const CHROME: Array<[string, Record<string, unknown>]> = [
  ["computers.chrome.snapshot", { format: "tree" }], ["computers.chrome.act", { ref: "e2", action: "click" }], ["computers.chrome.click", { ref: "e2" }],
  ["computers.chrome.type", { ref: "e3", text: "hello" }], ["computers.chrome.fill", { fields: [{ ref: "e3", value: "hello" }] }], ["computers.chrome.open", { url: "https://example.com/form" }],
  ["computers.chrome.tabs", { action: "list" }], ["computers.chrome.wait", { until: "load" }], ["computers.chrome.screenshot", {}], ["computers.chrome.eval", { expression: "document.title" }],
  ["computers.chrome.console", { level: "log", limit: 10 }], ["computers.chrome.net", { bodies: true }], ["computers.chrome.inspect", { ref: "e2" }], ["computers.chrome.state", {}],
  ["computers.chrome.status", {}], ["computers.chrome.stop", { reason: "x" }], ["computers.chrome.resume", {}], ["computers.chrome.send", { heldId: "held_1" }],
  ["computers.chrome.batch", { steps: [{ tool: "click", args: { ref: "e2" } }] }], ["computers.chrome.plan", { goal: "x", steps: ["a"] }],
  ["computers.chrome.api", { method: "GET", url: "https://example.com/api/items" }], ["computers.chrome.sources", {}],
];

test("finding 1: an error any Chrome tool answers after a value was filled never carries it, whoever asks the same agent next", async () => {
  const ToolErrorOf = (await import("../handlers/tools/common.ts")).ToolError;
  let mode: "page" | "plain" = "page";
  browser(Object.fromEntries(CHROME.map(([cap]) => {
    const name = cap.replace("computers.chrome.", "chrome_");
    return [name, (c: BrowserToolCall) => {
      if (name === "chrome_fill" && JSON.stringify(c.args).includes("#Dex_Api.key")) return { ok: true, filled: 1, used: [{ handle: "#Dex_Api.key", itemId: "itm_1", value: KEY }] };
      // a page's own exception quotes the field (agentd's eval: "the page raised: <description>"), or the service fails with text that holds it
      if (mode === "page") throw new ToolErrorOf("bad_input", `the page raised: Error: ${KEY} (${Buffer.from(KEY).toString("base64")})`);
      throw new Error(`socket closed while sending ${KEY}`);
    }];
  })));
  try {
    await tool["computers.chrome.fill"]!(as("agt_dex", DANA).ctx, { fields: [{ ref: "e3", value: "#Dex_Api.key" }] }).catch(() => undefined);
    const omar = as("agt_dex", OMAR).ctx;
    for (const m of ["page", "plain"] as const) {
      mode = m;
      for (const [cap, input] of CHROME) {
        let said = "";
        try { await tool[cap]!(omar, input); said = "no error"; } catch (e) { said = JSON.stringify(e) + String((e as Error)?.message ?? ""); }
        assert.equal(said.includes(KEY) || said.includes(Buffer.from(KEY).toString("base64")), false, `${cap} (${m}): ${said.replaceAll(KEY, "<KEY>").slice(0, 300)}`);
      }
    }
  } finally { off(); }
});

// ---- review finding 2: the no-picture rule is per tab -----------------------------------------------------------------------------------------------

test("finding 2: a tab a value was filled into is never pictured while it is open, however another tab is opened, used or navigated; closing it ends the rule", async () => {
  // a browser with real tabs: open (in this tab or a new one), use, close, list
  let tabs: Array<{ tabId: string; url: string; title: string; active: boolean }> = [{ tabId: "t1", url: "https://example.com/keys", title: "Keys", active: true }];
  let n = 1;
  const activate = (id: string): void => { tabs = tabs.map((t) => ({ ...t, active: t.tabId === id })); };
  const b = browser({
    chrome_fill: () => ({ ok: true, filled: 1, used: [{ handle: "#Dex_Api.key", itemId: "itm_1", value: KEY }] }),
    chrome_open: (c) => {
      if (c.args["newTab"] === true) { const id = `t${++n}`; tabs.push({ tabId: id, url: String(c.args["url"]), title: "x", active: false }); activate(id); return { tabId: id, url: String(c.args["url"]), title: "x" }; }
      const id = typeof c.args["tabId"] === "string" ? c.args["tabId"] : tabs.find((t) => t.active)!.tabId;
      tabs = tabs.map((t) => (t.tabId === id ? { ...t, url: String(c.args["url"]) } : t));
      return { tabId: id, url: String(c.args["url"]), title: "x" };
    },
    chrome_tabs: (c) => {
      if (c.args["action"] === "use") activate(String(c.args["tabId"]));
      if (c.args["action"] === "close") { tabs = tabs.filter((t) => t.tabId !== c.args["tabId"]); if (!tabs.some((t) => t.active) && tabs[0]) activate(tabs[0].tabId); }
      return { tabs };
    },
    chrome_screenshot: () => ({ png: "iVBORw0KGgo=", width: 1280, height: 800 }),
  });
  const refused = (e: unknown): boolean => codeOf(e) === "validation.bad_input" && /holds a value filled from the Vault/.test(JSON.stringify(e));
  try {
    const h = as("agt_dex", DANA);
    await tool["computers.chrome.fill"]!(h.ctx, { fields: [{ ref: "e3", value: "#Dex_Api.key" }] });
    const omar = as("agt_dex", OMAR);
    await tool["computers.chrome.open"]!(omar.ctx, { url: "https://example.com/other", newTab: true });
    const shotsAfterOpen = b.shots();
    assert.equal((await tool["computers.chrome.screenshot"]!(omar.ctx, {})).width, 1280, "the new tab, which holds nothing, is pictured");
    await assert.rejects(() => tool["computers.chrome.screenshot"]!(omar.ctx, { tabId: "t1" }), refused, "the filled tab, named, is not");
    const before = b.shots();
    await tool["computers.chrome.tabs"]!(omar.ctx, { action: "use", tabId: "t1" });
    assert.equal(b.shots(), before, "using the filled tab keeps no step picture of it");
    await assert.rejects(() => tool["computers.chrome.screenshot"]!(omar.ctx, {}), refused, "and the filled tab, now in front, is not pictured");
    // navigating the filled tab away does not end it: going back can bring the filled page back
    await tool["computers.chrome.open"]!(omar.ctx, { url: "https://example.com/elsewhere", tabId: "t1" });
    await assert.rejects(() => tool["computers.chrome.screenshot"]!(omar.ctx, { tabId: "t1" }), refused, "still refused after it navigated");
    await tool["computers.chrome.tabs"]!(omar.ctx, { action: "close", tabId: "t1" });
    assert.equal((await tool["computers.chrome.screenshot"]!(omar.ctx, {})).width, 1280, "once it is closed, pictures are back");
    assert.ok(shotsAfterOpen >= 1);
  } finally { off(); }
});
