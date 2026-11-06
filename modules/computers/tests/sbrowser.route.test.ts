// The Space browser, from the module's side (owner decision 6 Nov): where an agent's chrome_* tools go, whose profile they are, what the Vault channel carries, and who may watch and take over.
// The browser itself is a stand-in here; the real one is sbrowser.heavy.test.ts (a Docker host and the image).
import test from "node:test";
import assert from "node:assert/strict";
import { bindFill, bindKit, bindPersonalChrome, forgetSecrets } from "../projections.ts";
import type { PersonalChrome } from "../projections.ts";
import { bindSpaceBrowser } from "../sbrowser/port.ts";
import type { BrowserAnswer, BrowserToolCall, SpaceBrowser } from "../sbrowser/port.ts";
import { PROFILE_ID as BROWSERD_PROFILE_ID } from "../../../images/space-browser/browserd/profiles.ts";
import { PROFILE_ID, profileAccess, profileIdOf } from "../sbrowser/policy.ts";
import { ToolError } from "../handlers/tools/common.ts";
import { asPerson, codeOf, DANA, harness, OMAR } from "../fixtures/harness.ts";
import { tool, world } from "./tools.fixture.ts";

const SCRUB = { createScrubber: (secrets: Array<{ handle: string; value: string }>) => ({ scrub: (text: string) => secrets.reduce((t, s) => t.split(s.value).join(`[${s.handle}]`), text) }) };

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
    async takeover() {}, async giveBack() {}, async screenshot() { return { bytes: new Uint8Array(), width: 1, height: 1 }; },
    async stream() { return { transport: "mjpeg", url: "http://x" }; }, async stop() {}, async forget() {},
    async profiles() { return { profiles: [], maxRunning: 6 }; }, async health() { return { ok: true }; },
  };
  bindSpaceBrowser(sb);
  return { calls, refuseWith(e: ToolError | null) { refuse = e; }, setAvailable(v: boolean) { up = v; } };
}
const agentCtx = (id: string, person = DANA) => harness({ principal: { kind: "agent", id }, actingFor: person }).ctx;
const off = (): void => { bindSpaceBrowser(null); bindFill(null); bindKit(null); bindPersonalChrome(null); };

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
    const dana = asPerson(w.h, { kind: "agent", id: "agt_intake" }, { actingFor: DANA });
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

test("the Vault channel rides every call, one token per profile and asker, and the values it filled are scrubbed from every answer", async () => {
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
    await tool["computers.chrome.snapshot"]!(dex, {});
    const first = b.calls[0]!.fill!;
    assert.equal(first.url, "http://vyre-host/fill", "even a look carries the channel: the extension in the profile fills on its own");
    assert.deepEqual(issued, [{ computerId: "agt_dex", agentId: "agt_dex", asker: DANA }], "the token is for this profile and this agent, as the asker");
    await tool["computers.chrome.fill"]!(dex, { fields: [{ ref: "e3", value: "#Dex_Site.password" }] });
    assert.equal(b.calls[1]!.fill!.token, first.token, "the same asker reuses the token");
    assert.equal(issued.length, 1);
    await tool["computers.chrome.fill"]!(agentCtx("agt_dex", OMAR), { fields: [{ ref: "e3", value: "#Dex_Site.password" }] });
    assert.equal(issued.length, 2, "another asker is a new grant");
    assert.equal(revoked, 1, "and the old one ends");
    assert.notEqual(b.calls[2]!.fill!.token, first.token);
    await tool["computers.chrome.fill"]!(agentCtx("agt_scout", DANA), { fields: [{ ref: "e3", value: "#Scout_Site.password" }] });
    assert.equal(issued.at(-1)!.computerId, "agt_scout", "another agent is another profile with its own token");
    assert.equal(revoked, 1, "and does not end Dex's");
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

test("the profile access rule: an Assistant only its person; a personal agent only its owner; a team agent its owner and admins", () => {
  const assistant = { agentId: "agt_dana_assistant", ownerId: DANA, kind: "assistant" as const };
  const personal = { agentId: "agt_mine", ownerId: DANA, kind: "agent" as const };
  const team = { agentId: "agt_dex", ownerId: DANA, kind: "agent" as const, team: true };
  assert.equal(profileAccess(assistant, DANA, false), "owner");
  assert.equal(profileAccess(assistant, OMAR, true), "none", "not even an admin");
  assert.equal(profileAccess(personal, DANA, false), "owner");
  assert.equal(profileAccess(personal, OMAR, true), "none", "unknown sharing is the narrow rule");
  assert.equal(profileAccess({ ...personal, team: false }, OMAR, true), "none");
  assert.equal(profileAccess(team, DANA, false), "owner");
  assert.equal(profileAccess(team, OMAR, true), "admin");
  assert.equal(profileAccess(team, OMAR, false), "none", "a member who is not an admin");
});

test("a profile id is one rule in the module and in the browser, and cannot name a path", () => {
  assert.equal(PROFILE_ID.source, BROWSERD_PROFILE_ID.source);
  for (const good of ["agt_dex", "agt_9f3a2b", "abc", "A-b_c"]) assert.equal(profileIdOf(good), good);
  for (const bad of ["", "ab", "../etc", "a/b", "agt dex", ".hidden", "a".repeat(81), "agt_é", "-lead"]) assert.equal(profileIdOf(bad), null, bad);
});
