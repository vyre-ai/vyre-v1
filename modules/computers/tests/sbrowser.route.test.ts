// The Space browser, from the module's side (owner decision 6 Nov): where an agent's chrome_* tools go, whose profile they are, what the Vault channel carries, and who may watch and take over.
// The browser itself is a stand-in here; the real one is sbrowser.heavy.test.ts (a Docker host and the image).
import test from "node:test";
import assert from "node:assert/strict";
import { bindFill, bindKit, bindPersonalChrome, forgetSecrets } from "../projections.ts";
import type { PersonalChrome } from "../projections.ts";
import { bindSpaceBrowser } from "../sbrowser/port.ts";
import { resetAgentInfo } from "../sbrowser/agentinfo.ts";
import type { BrowserAnswer, BrowserToolCall, SpaceBrowser } from "../sbrowser/port.ts";
import { PROFILE_ID as BROWSERD_PROFILE_ID } from "../../../images/space-browser/browserd/profiles.ts";
import { PROFILE_ID, mayTakeOver, profileAccess, profileIdOf } from "../sbrowser/policy.ts";
import { ToolError } from "../handlers/tools/common.ts";
import { asPerson, codeOf, DANA, harness, OMAR } from "../fixtures/harness.ts";
import { tool, world } from "./tools.fixture.ts";

const SCRUB = { createScrubber: (secrets: Array<{ handle: string; value: string }>) => ({ scrub: (text: string) => secrets.reduce((t, s) => t.split(s.value).join(`[${s.handle}]`), text) }) };

let downloadsNow: () => Array<{ name: string; size: number; at: number }> = () => [];
const acked: string[] = [];
let sessionsNow: () => Array<{ site: string; since: number; lastSeen: number }> = () => [];
const signedOut: string[] = [];
function browser(answers: Record<string, (c: BrowserToolCall) => BrowserAnswer> = {}) {
  const calls: BrowserToolCall[] = [];
  let refuse: ToolError | null = null;
  let up = true;
  const sb: SpaceBrowser = {
    async available() { return up; },
    async tool(a) {
      calls.push(a);
      if (refuse) throw refuse;
      return (answers[a.tool] ?? (() => ({ url: "https://example.com/", title: "Example", tree: "- page [e1]", truncated: false, ok: true, tabId: "t1", loading: false })))(a);
    },
    async downloads() { return downloadsNow(); }, async downloadRead(_p, name) { return new TextEncoder().encode(`bytes of ${name}`); }, async downloadAck(_p, name) { acked.push(name); },
    async takeover() {}, async giveBack() {}, async screenshot() { return { bytes: new Uint8Array([1, 2, 3]), width: 1, height: 1 }; },
    async stream() { return { transport: "mjpeg", url: "http://x" }; }, async sessions() { return sessionsNow(); }, async signOut(_p, site) { signedOut.push(site); return true; }, async importChrome() { return { bytes: 0 }; }, async stop() {}, async forget() {},
    async profiles() { return { profiles: [], maxRunning: 6 }; }, async health() { return { ok: true }; },
  };
  bindSpaceBrowser(sb);
  return { calls, refuseWith(e: ToolError | null) { refuse = e; }, setAvailable(v: boolean) { up = v; } };
}
const agentCtx = (id: string, person = DANA) => harness({ principal: { kind: "agent", id }, actingFor: person }).ctx;
const off = (): void => { resetAgentInfo(); bindSpaceBrowser(null); bindFill(null); bindKit(null); bindPersonalChrome(null); };

test("an agent with no computer browses in its own profile of the Space browser, named by its id", async () => {
  const b = browser();
  try {
    const out = await tool["computers.chrome.open"]!(agentCtx("agt_dex"), { url: "https://example.com/" });
    assert.equal(out.url, "https://example.com/");
    assert.equal(b.calls.length, 1);
    assert.deepEqual([b.calls[0]!.profileId, b.calls[0]!.tool, b.calls[0]!.args], ["agt_dex", "chrome_open", { url: "https://example.com/" }]);
    assert.equal(b.calls[0]!.fill, undefined, "no Vault channel for a call with no typing");
  } finally { off(); }
});

test("profiles are per agent: two agents asked by the same person get two profiles, and the person who asks does not change the profile", async () => {
  const b = browser();
  try {
    await tool["computers.chrome.open"]!(agentCtx("agt_dex", DANA), { url: "https://a.test/" });
    await tool["computers.chrome.open"]!(agentCtx("agt_scout", DANA), { url: "https://b.test/" });
    await tool["computers.chrome.open"]!(agentCtx("agt_dex", OMAR), { url: "https://c.test/" });
    assert.deepEqual(b.calls.map((c) => c.profileId), ["agt_dex", "agt_scout", "agt_dex"], "a team agent's logins outlive whoever asked");
  } finally { off(); }
});

test("an agent that has its own computer still browses in the Space browser; naming the computer, or my-chrome, goes where it always went", async () => {
  const b = browser();
  const w = await world();
  const personal: Array<{ tool: string }> = [];
  const p: PersonalChrome = {
    async available(a) { return a.person === DANA; }, async call(a) { personal.push(a); return { ok: true, url: "https://mine.test/", title: "Mine", tree: "x", truncated: false }; },
    held: async () => null, frame: () => null, plan: () => null, drop() {}, takeOver() {}, watch() {},
  };
  try {
    const agent = w.agent();
    await tool["computers.chrome.state"]!(agent.ctx, {});
    assert.equal(b.calls.length, 1, "unnamed goes to the Space browser");
    assert.equal(w.d.named("chrome_state").length, 0, "not to the computer");
    await tool["computers.chrome.state"]!(agent.ctx, { computerId: w.id });
    assert.equal(w.d.named("chrome_state").length, 1, "a named computer is its own browser");
    assert.equal(b.calls.length, 1);
    bindPersonalChrome(p);
    // my-chrome is refused unless the person asked for their own Chrome in this turn (l-mychrome), so the chat's newest line from Dana asks for it
    const asked = () => ({ messages: [{ threadSeq: 1, author: { kind: "person", id: DANA }, body: "Check the inbox in my Chrome" }], hasMore: false });
    const dana = asPerson(w.h, { kind: "agent", id: "agt_intake" }, { actingFor: DANA, respond: { "chat.messages.list": asked } });
    dana.ctx.thread = "thr_1";
    w.d.rebind();
    await tool["computers.chrome.snapshot"]!(dana.ctx, { computerId: "my-chrome" });
    assert.equal(personal.length, 1, "my-chrome is the person's own Chrome, on request");
    assert.equal(b.calls.length, 1);
  } finally { off(); }
});

test("without a Space browser bound nothing changes: an agent with no computer is refused as before, a person must name a computer", async () => {
  bindSpaceBrowser(null);
  await assert.rejects(() => tool["computers.chrome.state"]!(agentCtx("agt_dex"), {}), (e) => codeOf(e) === "validation.not_found");
  const b = browser();
  try {
    await assert.rejects(() => tool["computers.chrome.state"]!(harness().ctx, {}), (e) => codeOf(e) === "validation.bad_input", "a person has to name a computer");
    assert.equal(b.calls.length, 0, "a person's call never reaches an agent's profile");
  } finally { off(); }
});

test("a host that cannot run the Space browser leaves an agent where it was: no computer is the old refusal, and the person's Chrome still works", async () => {
  const b = browser();
  b.setAvailable(false);
  try {
    await assert.rejects(() => tool["computers.chrome.state"]!(agentCtx("agt_dex"), {}), (e) => codeOf(e) === "validation.not_found");
    assert.equal(b.calls.length, 0);
    b.setAvailable(true);
  } finally { off(); }
  const again = browser();
  try {
    await tool["computers.chrome.state"]!(agentCtx("agt_dex"), {});
    assert.equal(again.calls.length, 1, "and when the runtime answers it is used");
  } finally { off(); }
});

test("what the browser refuses with keeps its meaning", async () => {
  const b = browser();
  try {
    for (const [code, want] of [["timeout", "timeout.deadline"], ["paused", "provider.unavailable"], ["not_found", "validation.not_found"], ["bad_input", "validation.bad_input"], ["unavailable", "provider.unavailable"]] as const) {
      b.refuseWith(new ToolError(code, `said ${code}`));
      await assert.rejects(() => tool["computers.chrome.state"]!(agentCtx("agt_dex"), {}), (e) => codeOf(e) === want, code);
    }
    b.refuseWith(null);
    b.refuseWith(new ToolError("paused", "x"));
    await assert.rejects(() => tool["computers.chrome.state"]!(agentCtx("agt_dex"), {}), (e) => /Chrome is paused|paused/i.test(JSON.stringify(e)));
  } finally { off(); }
});

test("the Vault channel rides every call as its asker, ends with the call, and the values it filled are scrubbed from every answer", async () => {
  const issued: Array<{ computerId: string; agentId: string; asker: string }> = [];
  let revoked = 0;
  bindFill({ async issue(h) { issued.push({ computerId: h.computerId, agentId: h.agentId, asker: h.asker }); return { fillToken: `tok${issued.length}`.padEnd(24, "x"), revoke() { revoked += 1; } }; }, url: () => "http://vyre-host/fill" });
  bindKit(SCRUB);
  const value = "s3cret-Value-9";
  const b = browser({
    chrome_fill: (c) => (JSON.stringify(c.args).includes("#Dex_Site") ? { ok: true, filled: 1, used: [{ handle: "#Dex_Site.password", itemId: "itm_1", value }] } : { ok: true, filled: 1 }),
    chrome_snapshot: () => ({ url: "https://example.com/", title: `Welcome ${value}`, tree: `- textbox [e3] value "${value}"`, truncated: false }),
  });
  try {
    const dex = agentCtx("agt_dex", DANA);
    // the calls the agent made (after a fill the module also lists the tabs, to know which one holds the value)
    const asked = () => b.calls.filter((c) => c.tool !== "chrome_tabs");
    await tool["computers.chrome.snapshot"]!(dex, {});
    const first = asked()[0]!.fill!;
    assert.equal(first.url, "http://vyre-host/fill", "even a look carries the channel: the extension in the profile fills on its own");
    assert.deepEqual(issued, [{ computerId: "agt_dex", agentId: "agt_dex", asker: DANA }], "the token is for this profile and this agent, as the asker");
    // the channel lives only while the person's call runs (sbrowser audit bug 5): it ended with the look, and the next call brings a new one
    assert.equal(revoked, 1, "the look's channel ended with it");
    await tool["computers.chrome.fill"]!(dex, { fields: [{ ref: "e3", value: "#Dex_Site.password" }] });
    assert.notEqual(asked()[1]!.fill!.token, first.token, "a later call of the same person has a channel of its own");
    assert.deepEqual([issued.length, revoked], [2, 2]);
    await tool["computers.chrome.fill"]!(agentCtx("agt_dex", OMAR), { fields: [{ ref: "e3", value: "#Dex_Site.password" }] });
    assert.deepEqual(issued.at(-1), { computerId: "agt_dex", agentId: "agt_dex", asker: OMAR }, "another asker's call is a grant as that asker");
    assert.notEqual(asked()[2]!.fill!.token, first.token);
    await tool["computers.chrome.fill"]!(agentCtx("agt_scout", DANA), { fields: [{ ref: "e3", value: "#Scout_Site.password" }] });
    assert.equal(issued.at(-1)!.computerId, "agt_scout", "another agent is another profile with its own token");
    assert.equal(revoked, issued.length, "no channel outlives its call");
    const snap = await tool["computers.chrome.snapshot"]!(dex, {});
    assert.ok(!JSON.stringify(snap).includes(value), "the value is scrubbed after it was filled on this profile");
    assert.match(snap.tree, /\[#Dex_Site\.password\]/);
    const other = await tool["computers.chrome.snapshot"]!(agentCtx("agt_scout"), {});
    assert.ok(JSON.stringify(other).includes(value), "a value filled on Dex's profile is not Scout's to scrub (profiles keep their own secrets)");
  } finally { forgetSecrets("agt_dex"); forgetSecrets("agt_scout"); off(); }
});

test("a screenshot of a profile is kept in the agent's folder like any other", async () => {
  const PNG = "iVBORw0KGgo=";
  const b = browser({ chrome_screenshot: () => ({ png: PNG, width: 1280, height: 800 }) });
  try {
    const h = harness({ principal: { kind: "agent", id: "agt_dex" }, actingFor: DANA });
    const out = await tool["computers.chrome.screenshot"]!(h.ctx, {});
    assert.equal(out.width, 1280);
    assert.equal(h.calls("files.create").length, 1);
    assert.equal(b.calls[0]!.profileId, "agt_dex");
  } finally { off(); }
});

// ---- who may watch and take over

test("the profile access rule by how the agent is shared: private and personal only the owner; shared with named people they watch, owner and admins take over; the whole Space, owner and admins", () => {
  const mk = (cls: "private" | "personal" | "shared" | "space", people: string[] = []) => ({ agentId: "agt_x", ownerId: DANA, class: cls, people });
  for (const cls of ["private", "personal"] as const) {
    assert.equal(profileAccess(mk(cls), DANA, false), "owner");
    assert.equal(profileAccess(mk(cls, [OMAR]), OMAR, true), "none", `${cls}: not even an admin`);
  }
  assert.equal(profileAccess(mk("space"), DANA, false), "owner");
  assert.equal(profileAccess(mk("space"), OMAR, true), "admin");
  assert.equal(profileAccess(mk("space"), OMAR, false), "none", "a member who is not an admin");
  assert.equal(profileAccess(mk("shared", [OMAR]), OMAR, false), "viewer", "a person it was shared with watches");
  assert.equal(profileAccess(mk("shared", [OMAR]), OMAR, true), "admin", "an admin takes over");
  assert.equal(profileAccess(mk("shared", [OMAR]), "usr_other", false), "none");
  assert.equal(profileAccess(mk("shared", [OMAR]), "usr_other", true), "admin");
  assert.deepEqual(["owner", "admin", "viewer", "none"].map((x) => mayTakeOver(x as never)), [true, true, false, false]);
});

test("a profile id is one rule in the module and in the browser, and cannot name a path", () => {
  assert.equal(PROFILE_ID.source, BROWSERD_PROFILE_ID.source);
  for (const good of ["agt_dex", "agt_9f3a2b", "abc", "A-b_c"]) assert.equal(profileIdOf(good), good);
  for (const bad of ["", "ab", "../etc", "a/b", "agt dex", ".hidden", "a".repeat(81), "agt_é", "-lead"]) assert.equal(profileIdOf(bad), null, bad);
});

// ---- downloads

test("what a profile's browser downloaded goes into the agent's Files under Downloads, as the agent, is dropped from the browser service, and the agent is told the path", async () => {
  const b = browser();
  acked.length = 0;
  downloadsNow = () => [{ name: "report.pdf", size: 18, at: 1 }, { name: "data.csv", size: 12, at: 2 }];
  try {
    const h = harness({ principal: { kind: "agent", id: "agt_dex" }, actingFor: DANA, respond: { "files.folder.create": () => ({ folder: { folderId: "fld_downloads" } }) } });
    const out = await tool["computers.chrome.click"]!(h.ctx, { ref: "e1" });
    assert.deepEqual(out.downloads.map((d: { name: string; path: string }) => [d.name, d.path]), [["report.pdf", "Downloads/report.pdf"], ["data.csv", "Downloads/data.csv"]]);
    const made = h.calls("files.create").filter((c) => String(c.input["name"]).startsWith("step-") === false);
    assert.deepEqual(made.map((c) => [c.input["folderId"], c.input["name"], c.input["mime"], c.input["kind"]]), [["fld_downloads", "report.pdf", "application/pdf", "pdf"], ["fld_downloads", "data.csv", "text/csv", "spreadsheet"]]);
    assert.equal(Buffer.from((made[0]!.input["content"] as { base64: string }).base64, "base64").toString(), "bytes of report.pdf");
    assert.deepEqual(acked, ["report.pdf", "data.csv"], "the browser service dropped its copies");
    assert.equal(h.calls("files.folder.create").length, 1);
    assert.equal(h.calls("files.folder.create")[0]!.input["name"], "Downloads");
    downloadsNow = () => [];
    assert.equal((await tool["computers.chrome.click"]!(h.ctx, { ref: "e1" })).downloads, undefined, "nothing new: no field");
    // a look that does not report downloads leaves them for the next step that does
    downloadsNow = () => [{ name: "later.zip", size: 1, at: 3 }];
    await tool["computers.chrome.snapshot"]!(h.ctx, {});
    assert.equal(h.calls("files.create").filter((c) => !String(c.input["name"]).startsWith("step-")).length, 2);
    assert.equal((await tool["computers.chrome.state"]!(h.ctx, {})).downloads[0].path, "Downloads/later.zip");
    assert.equal(b.calls.length, 4);
  } finally { downloadsNow = () => []; off(); }
});

test("a name already in Downloads gets a number, and a file that cannot be made stays in the browser service for the next step", async () => {
  browser();
  acked.length = 0;
  downloadsNow = () => [{ name: "a.pdf", size: 1, at: 1 }];
  let taken = true;
  try {
    const h = harness({ principal: { kind: "agent", id: "agt_dex" }, actingFor: DANA, respond: {
      "files.folder.create": () => ({ folder: { folderId: "fld_dl2" } }),
      "files.create": (i) => { if (taken && i["name"] === "a.pdf") throw { error: { code: "validation.duplicate" } }; return { file: { fileId: "fil_x" } }; },
    } });
    const out = await tool["computers.chrome.open"]!(h.ctx, { url: "https://example.com/" });
    assert.equal(out.downloads[0].path, "Downloads/a (2).pdf");
    acked.length = 0;
    downloadsNow = () => [{ name: "b.pdf", size: 1, at: 2 }];
    const broke = harness({ principal: { kind: "agent", id: "agt_scout" }, actingFor: DANA, respond: { "files.folder.create": () => ({ folder: { folderId: "fld_dl3" } }), "files.create": () => { throw new Error("disk full"); } } });
    const o2 = await tool["computers.chrome.open"]!(broke.ctx, { url: "https://example.com/" });
    assert.equal(o2.downloads, undefined);
    assert.deepEqual(acked, [], "not dropped: it is tried again");
    taken = false;
  } finally { downloadsNow = () => []; off(); }
});

test("an Assistant's downloads go to its person's own Personal folder, and anyone else's agent to its own folder", async () => {
  browser();
  acked.length = 0;
  downloadsNow = () => [{ name: "tax.pdf", size: 1, at: 1 }];
  try {
    const ast = harness({ principal: { kind: "agent", id: "agt_ast" }, actingFor: DANA, respond: {
      "agents.get": () => ({ agent: { agentId: "agt_ast", name: "Dana's Assistant", face: "dana", kind: "assistant", ownerId: DANA, folderId: "fld_agent_ast" } }),
      "files.tree": () => ({ roots: [{ key: "space", folderId: "fld_space" }, { key: "personal", folderId: "fld_dana_personal" }] }),
      "files.folder.create": (i) => ({ folder: { folderId: `made_in_${String(i["parentId"])}` } }),
    } });
    const out = await tool["computers.chrome.state"]!(ast.ctx, {});
    assert.equal(out.downloads[0].path, "Downloads/tax.pdf");
    assert.equal(ast.calls("files.folder.create")[0]!.input["parentId"], "fld_dana_personal");
    assert.equal(ast.calls("files.create")[0]!.input["folderId"], "made_in_fld_dana_personal");
  } finally { downloadsNow = () => []; off(); }
});

test("each browser step with a caption is a line of the agent's browser timeline with a picture, the chat gets one live card, and the agent's name rides the call", async () => {
  const b = browser({ chrome_screenshot: () => ({ png: "iVBORw0KGgo=", width: 1, height: 1 }) });
  try {
    const h = harness({ principal: { kind: "agent", id: "agt_dex" }, actingFor: DANA, respond: {
      "agents.get": () => ({ agent: { agentId: "agt_dex", name: "Dex", face: "dex", kind: "agent", ownerId: DANA, folderId: "fld_dex" } }),
      "chat.post": () => ({ posted: true }),
    } });
    h.ctx.thread = "thr_1";
    await tool["computers.chrome.click"]!(h.ctx, { ref: "e4" });
    await tool["computers.chrome.type"]!(h.ctx, { ref: "e5", text: "hello" });
    assert.equal(b.calls[0]!.agent?.name, "Dex");
    const steps = h.rows("SELECT computer_id, caption, tool, thread_id FROM computers_timeline ORDER BY idx");
    assert.deepEqual(steps.map((r) => [r["computer_id"], r["caption"], r["tool"], r["thread_id"]]), [["agt_dex", "Clicked element e4", "chrome_click", "thr_1"], ["agt_dex", "Typed into element e5", "chrome_type", "thr_1"]]);
    assert.equal(h.calls("files.create").length, 2, "a picture each");
    const cards = h.calls("chat.post");
    assert.equal(cards.length, 1, "one live card per burst");
    assert.deepEqual((cards[0]!.input["blocks"] as Array<{ type: string; data: { agentId: string } }>).map((x) => [x.type, x.data.agentId]), [["browser_screenshot", "agt_dex"]]);
    const mine = await tool["computers.browser.timeline"]!(harness({ principal: { kind: "person", id: DANA }, respond: { "agents.share_class": () => ({ class: "space", ownerId: DANA, people: [] }) } }).ctx, { agentId: "agt_dex" }).catch((e) => e);
    assert.ok(mine, "the timeline is a capability of its own for people");
    await tool["computers.chrome.snapshot"]!(h.ctx, {});
    assert.equal(h.rows("SELECT COUNT(*) AS n FROM computers_timeline")[0]?.["n"], 2, "a look is not a step");
  } finally { off(); }
});

// A person who has taken over holds the agent's browser (owner ruling 6 Nov, DESIGN-agent-workspaces.md). The rule is the browser service's (browserd, profiles.ts: a call that is not the person's is refused while the controls
// are held), because it is the one layer every caller goes through; the real one is proved in sbrowser.heavy.test.ts. From the module's side: an agent's call is never marked as the person's, the refusal reaches the agent
// with the plain reason, nothing else gets in while it is held, and when the person gives back the agent works at once.
test("while a person holds an agent's browser the agent's tools are refused with the reason, never marked as the person's, and work again at once on give back", async () => {
  const held = new Map<string, string>();
  const calls: BrowserToolCall[] = [];
  const sb: SpaceBrowser = {
    async available() { return true; },
    async tool(a) {
      calls.push(a);
      if (held.has(a.profileId) && a.by !== "person") throw new ToolError("paused", "A person has the controls. The tools wait until they give them back.");
      return { url: "https://example.com/", title: "Example", tree: "- page [e1]", truncated: false, ok: true, tabId: "t1", loading: false };
    },
    async downloads() { return []; }, async downloadRead() { return new Uint8Array(); }, async downloadAck() {},
    async takeover(a) { const by = held.get(a.profileId); if (by && by !== a.personId) throw new ToolError("bad_input", "Someone else has the controls."); held.set(a.profileId, a.personId); },
    async giveBack(id) { held.delete(id); },
    async screenshot() { return { bytes: new Uint8Array([1]), width: 1, height: 1 }; }, async stream() { return { transport: "mjpeg", url: "http://x" }; }, async sessions() { return []; }, async signOut() { return true; }, async importChrome() { return { bytes: 0 }; }, async stop() {}, async forget() {},
    async profiles() { return { profiles: [...held].map(([profileId, by]) => ({ profileId, running: true, tabs: 1, busy: false, takeover: true, takeoverBy: by, viewers: 1, lastActiveAt: 1, held: 0, paused: false })), maxRunning: 6 }; }, async health() { return { ok: true }; },
  };
  bindSpaceBrowser(sb);
  try {
    await tool["computers.chrome.open"]!(agentCtx("agt_dex"), { url: "https://example.com/" });
    assert.equal(calls.at(-1)!.by, undefined, "an agent's call is never the person's");
    await sb.takeover({ profileId: "agt_dex", personId: DANA });
    for (const [name, input] of [["computers.chrome.open", { url: "https://example.org/" }], ["computers.chrome.state", {}], ["computers.chrome.snapshot", {}]] as const) {
      const before = calls.length;
      await assert.rejects(() => (tool[name] as (c: unknown, i: unknown) => Promise<unknown>)(agentCtx("agt_dex"), input), (e) => codeOf(e) === "provider.unavailable" && /A person has the controls/.test(JSON.stringify(e)), `${name} waits with the reason`);
      assert.equal(calls.length, before + 1);
      assert.equal(calls.at(-1)!.by, undefined, `${name} reached the browser as the agent's, so the browser could refuse it`);
    }
    await assert.rejects(() => sb.takeover({ profileId: "agt_dex", personId: OMAR }), /Someone else has the controls/, "a second person is refused while it is held");
    await sb.giveBack("agt_dex");
    const out = await tool["computers.chrome.state"]!(agentCtx("agt_dex"), {});
    assert.equal(out.loading, false, "given back, the agent works at once");
  } finally { off(); }
});
