// What a person does with an agent's browser (sbrowser/handlers.ts): list the ones they may watch, open the live view, take over, give back. An Assistant's browser is its person's alone, a team agent's goes
// to its owner and to admins, and an agent never uses these (it drives its own profile with its tools).
import test from "node:test";
import assert from "node:assert/strict";
import { bindSpaceBrowser } from "../sbrowser/port.ts";
import { browserStreamInput, browserStreamOpen } from "../sbrowser/handlers.ts";
import type { ProfileRow, SpaceBrowser } from "../sbrowser/port.ts";
import { ToolError } from "../handlers/tools/common.ts";
import { codeOf, DANA, harness, OMAR } from "../fixtures/harness.ts";
import { tool } from "./tools.fixture.ts";

const WATCHER = "usr_watcher";
const AGENTS: Record<string, { ownerId: string; class: "private" | "personal" | "shared" | "space"; people: string[] }> = {
  agt_dana_ast: { ownerId: DANA, class: "private", people: [] },
  agt_dex: { ownerId: DANA, class: "space", people: [] },
  agt_mine: { ownerId: DANA, class: "personal", people: [] },
  agt_named: { ownerId: DANA, class: "shared", people: [WATCHER] },
};
const row = (profileId: string, over: Partial<ProfileRow> = {}): ProfileRow => ({ profileId, running: true, tabs: 2, busy: false, takeover: false, viewers: 0, lastActiveAt: 1_760_000_000_000, held: 0, paused: false, ...over });

let sessionsNow: () => Array<{ site: string; since: number; lastSeen: number }> = () => [];
const signedOut: string[] = [];
function rig() {
  const rows = new Map<string, ProfileRow>([["agt_named", row("agt_named")], ["agt_dana_ast", row("agt_dana_ast")], ["agt_dex", row("agt_dex", { bridge: { connected: 1, hello: true, optin: true } })], ["agt_mine", row("agt_mine")], ["agt_gone", row("agt_gone")]]);
  const seen: string[] = [];
  const sb: SpaceBrowser = {
    async available() { return true; }, async tool() { return {}; }, async downloads() { return []; }, async downloadRead() { return new Uint8Array(); }, async downloadAck() {},
    async takeover(a) {
      const r = rows.get(a.profileId)!;
      if (r.takeoverBy && r.takeoverBy !== a.personId) throw new ToolError("bad_input", "Someone else has the controls.");
      rows.set(a.profileId, { ...r, takeover: true, takeoverBy: a.personId }); seen.push(`takeover ${a.profileId} ${a.personId}`);
    },
    async giveBack(id) { const { takeoverBy: _t, ...r } = rows.get(id)!; rows.set(id, { ...r, takeover: false }); seen.push(`give_back ${id}`); },
    async screenshot() { return { bytes: new Uint8Array(), width: 1, height: 1 }; },
    async stream(a) { seen.push(`stream ${a.profileId}`); return { transport: "mjpeg", url: `http://10.0.0.2:7002/stream?t=abc&p=${a.profileId}`, ws: "ws://10.0.0.2:7002/ws?t=abc" }; },
    async sessions() { return sessionsNow(); }, async signOut(_p, site) { signedOut.push(site); return true; }, async importChrome() { return { bytes: 0 }; }, async stop() {}, async forget() {},
    async profiles() { return { profiles: [...rows.values()], maxRunning: 6 }; }, async health() { return { ok: true }; },
  };
  bindSpaceBrowser(sb);
  return { seen, rows };
}
const respond = { "agents.share_class": (i: Record<string, unknown>) => { const a = AGENTS[String(i["agentId"])]; if (!a) throw new Error("no such agent"); return a; } };
const as = (person: string, manager = true) => harness({ principal: { kind: "person", id: person }, manager, respond });
const off = (): void => bindSpaceBrowser(null);

test("a person sees the browsers they may watch: an owner their own, an admin the team agents' and never another's Assistant or personal agent", async () => {
  rig();
  try {
    const dana = await tool["computers.browser.profiles"]!(as(DANA, false).ctx, {});
    assert.deepEqual(dana.profiles.map((p: { agentId: string; access: string }) => [p.agentId, p.access]), [["agt_named", "owner"], ["agt_dana_ast", "owner"], ["agt_dex", "owner"], ["agt_mine", "owner"]], "Dana sees hers; agt_gone has no agent and is left out");
    assert.equal(dana.maxRunning, 6);
    const omar = await tool["computers.browser.profiles"]!(as(OMAR, true).ctx, {});
    assert.deepEqual(omar.profiles.map((p: { agentId: string; access: string }) => [p.agentId, p.access]), [["agt_named", "admin"], ["agt_dex", "admin"]], "an admin sees the shared and team agents, never an Assistant or a personal agent");
    const member = await tool["computers.browser.profiles"]!(as(OMAR, false).ctx, {});
    assert.deepEqual(member.profiles, [], "a member who is not an admin sees none of Dana's");
    const dex = dana.profiles.find((p: { agentId: string }) => p.agentId === "agt_dex");
    assert.deepEqual([dex.paired, dex.running, dex.tabs, dex.busy], [true, true, 2, false], "paired means Vyre for Chrome is connected and was told the Space");
    assert.equal(dana.profiles.find((p: { agentId: string }) => p.agentId === "agt_mine").paired, false);
  } finally { off(); }
});

test("an agent shared with named people may be watched by them and taken over only by its owner and admins", async () => {
  const r = rig();
  try {
    const w = as(WATCHER, false);
    assert.deepEqual((await tool["computers.browser.profiles"]!(w.ctx, {})).profiles.map((p: { agentId: string; access: string }) => [p.agentId, p.access]), [["agt_named", "viewer"]]);
    assert.match((await tool["computers.browser.stream"]!(w.ctx, { agentId: "agt_named" })).url, /stream/);
    await assert.rejects(() => tool["computers.browser.take_over"]!(w.ctx, { agentId: "agt_named" }), (e) => codeOf(e) === "permission.no_grant");
    await assert.rejects(() => tool["computers.browser.stream"]!(w.ctx, { agentId: "agt_dex" }), (e) => codeOf(e) === "permission.no_grant", "not shared with them");
    assert.deepEqual(r.seen, ["stream agt_named"]);
  } finally { off(); }
});

test("the live view is for the same people, and it gives a ticketed address that is not the browser's WebSocket for the host's relay", async () => {
  const r = rig();
  try {
    const own = await tool["computers.browser.stream"]!(as(DANA, false).ctx, { agentId: "agt_dex" });
    assert.equal(own.transport, "mjpeg");
    assert.match(own.url, /^\/browsers\/agt_dex\/stream\?ticket=cpt_/);
    assert.match(own.ws, /^\/browsers\/agt_dex\/ws\?ticket=cpt_/);
    assert.ok(!JSON.stringify(own).includes("10.0.0.2"), "the browser service's own address stays in the Space: the viewer gets the Space's relay");
    assert.ok(own.expiresAt > 1_760_000_000_000);
    await tool["computers.browser.stream"]!(as(OMAR, true).ctx, { agentId: "agt_dex" });
    for (const [who, agentId] of [[OMAR, "agt_dana_ast"], [OMAR, "agt_mine"]] as const) {
      await assert.rejects(() => tool["computers.browser.stream"]!(as(who, true).ctx, { agentId }), (e) => codeOf(e) === "permission.no_grant", `${who} ${agentId}`);
    }
    await assert.rejects(() => tool["computers.browser.stream"]!(as(OMAR, false).ctx, { agentId: "agt_dex" }), (e) => codeOf(e) === "permission.no_grant", "a member who is not an admin");
    await assert.rejects(() => tool["computers.browser.stream"]!(as(DANA).ctx, { agentId: "agt_nobody" }), (e) => codeOf(e) === "validation.not_found");
    await assert.rejects(() => tool["computers.browser.stream"]!(as(DANA).ctx, { agentId: "../etc" }), (e) => codeOf(e) === "validation.not_found");
    assert.deepEqual(r.seen, ["stream agt_dex", "stream agt_dex"], "refused calls never reached the browser");
  } finally { off(); }
});

test("the relay spends a ticket once, for the same agent, and tells whether the person may send input", async () => {
  const r = rig();
  try {
    const dana = as(DANA, false);
    const view = await tool["computers.browser.stream"]!(dana.ctx, { agentId: "agt_dex" });
    const ticket = /ticket=(cpt_\w+)/.exec(view.url)![1]!;
    const open = await browserStreamOpen(dana.ctx, { ticket, agentId: "agt_dex" });
    assert.deepEqual(open && [open.personId, open.input, open.url.includes("10.0.0.2")], [DANA, false, true], "frames only: nobody holds the controls");
    assert.equal(await browserStreamOpen(dana.ctx, { ticket, agentId: "agt_dex" }), null, "one use");
    const again = /ticket=(cpt_\w+)/.exec((await tool["computers.browser.stream"]!(dana.ctx, { agentId: "agt_dex" })).url)![1]!;
    assert.equal(await browserStreamOpen(dana.ctx, { ticket: again, agentId: "agt_scout" }), null, "another agent's browser");
    await tool["computers.browser.take_over"]!(dana.ctx, { agentId: "agt_dex" });
    const mine = /ticket=(cpt_\w+)/.exec((await tool["computers.browser.stream"]!(dana.ctx, { agentId: "agt_dex" })).url)![1]!;
    const taken = await browserStreamOpen(dana.ctx, { ticket: mine, agentId: "agt_dex" });
    assert.equal(taken?.input, true, "a take-over ticket for the person who holds the controls");
    assert.equal(await browserStreamInput(dana.ctx, { agentId: "agt_dex", personId: DANA }), true);
    assert.equal(await browserStreamInput(dana.ctx, { agentId: "agt_dex", personId: OMAR }), false);
    assert.ok(r.seen.length > 0);
  } finally { off(); }
});

test("take over and give back: one person at a time, the one who has the controls or an admin gives back, an Assistant's browser only its person", async () => {
  const r = rig();
  try {
    const t = await tool["computers.browser.take_over"]!(as(DANA, false).ctx, { agentId: "agt_dex" });
    assert.deepEqual([t.profile.agentId, t.profile.takeoverBy, t.profile.access], ["agt_dex", DANA, "owner"]);
    await assert.rejects(() => tool["computers.browser.take_over"]!(as(OMAR, true).ctx, { agentId: "agt_dex" }), (e) => codeOf(e) === "validation.precondition_failed", "someone else has the controls");
    await assert.rejects(() => tool["computers.browser.give_back"]!(as(OMAR, false).ctx, { agentId: "agt_dex" }), (e) => codeOf(e) === "permission.no_grant", "a member who is not an admin cannot");
    const back = await tool["computers.browser.give_back"]!(as(OMAR, true).ctx, { agentId: "agt_dex" });
    assert.equal(back.profile.takeoverBy, undefined, "an admin gives it back when the person went away");
    await tool["computers.browser.take_over"]!(as(OMAR, true).ctx, { agentId: "agt_dex" });
    await assert.rejects(() => tool["computers.browser.give_back"]!(as(DANA, false).ctx, { agentId: "agt_dex" }), (e) => codeOf(e) === "permission.no_grant", "the owner is not the one who has the controls, and is not an admin here");
    await tool["computers.browser.give_back"]!(as(OMAR, true).ctx, { agentId: "agt_dex" });
    await assert.rejects(() => tool["computers.browser.take_over"]!(as(OMAR, true).ctx, { agentId: "agt_dana_ast" }), (e) => codeOf(e) === "permission.no_grant", "not even an admin takes over an Assistant");
    assert.deepEqual(r.seen, ["takeover agt_dex usr_dana", "give_back agt_dex", `takeover agt_dex ${OMAR}`, "give_back agt_dex"]);
  } finally { off(); }
});

test("an agent never uses these, and with no Space browser they say so", async () => {
  rig();
  try {
    const agent = harness({ principal: { kind: "agent", id: "agt_dex" }, actingFor: DANA, respond });
    for (const cap of ["computers.browser.profiles", "computers.browser.stream", "computers.browser.take_over", "computers.browser.give_back"]) {
      await assert.rejects(() => tool[cap]!(agent.ctx, { agentId: "agt_dex" }), (e) => codeOf(e) === "permission.no_grant", cap);
    }
  } finally { off(); }
  for (const cap of ["computers.browser.profiles", "computers.browser.stream", "computers.browser.take_over", "computers.browser.give_back"]) {
    await assert.rejects(() => tool[cap]!(as(DANA).ctx, { agentId: "agt_dex" }), (e) => codeOf(e) === "provider.unavailable", cap);
  }
});

test("a profile row says running, asleep or waiting with the line, and a browser waiting for room is listed before it ever started", async () => {
  const r = rig();
  r.rows.set("agt_dex", { ...r.rows.get("agt_dex")!, running: false });
  try {
    const dana = as(DANA, false);
    dana.db.run("INSERT INTO computers_claim (claim_key, kind, host, state, since, note) VALUES ('agt_named', 'browser', 'space', 'waiting', 1, 'Waiting for room on the Space server.')");
    dana.db.run("INSERT INTO computers_claim (claim_key, kind, host, state, since, note) VALUES ('agt_mine', 'browser', 'space', 'waiting', 1, 'Waiting for room on the Space server.')");
    r.rows.delete("agt_mine");
    const out = (await tool["computers.browser.profiles"]!(dana.ctx, {})).profiles as Array<{ agentId: string; state: string; line?: string }>;
    const by = Object.fromEntries(out.map((p) => [p.agentId, [p.state, p.line]]));
    assert.deepEqual(by["agt_dex"], ["asleep", undefined]);
    assert.deepEqual(by["agt_dana_ast"], ["running", undefined]);
    assert.deepEqual(by["agt_named"], ["waiting", "Waiting for room on the Space server."]);
    assert.deepEqual(by["agt_mine"], ["waiting", "Waiting for room on the Space server."], "listed though the service never saw it");
  } finally { off(); }
});

test("the sites a browser is signed in to are listed for people who may watch, and signing out is for the owner and admins", async () => {
  rig();
  sessionsNow = () => [{ site: "app.clio.com", since: 5, lastSeen: 6 }];
  signedOut.length = 0;
  try {
    const w = as(WATCHER, false);
    assert.deepEqual((await tool["computers.browser.sessions"]!(w.ctx, { agentId: "agt_named" })).sessions, [{ site: "app.clio.com", since: 5, lastSeen: 6 }]);
    await assert.rejects(() => tool["computers.browser.sessions"]!(w.ctx, { agentId: "agt_dex" }), (e) => codeOf(e) === "permission.no_grant");
    await assert.rejects(() => tool["computers.browser.sign_out"]!(w.ctx, { agentId: "agt_named", site: "app.clio.com" }), (e) => codeOf(e) === "permission.no_grant", "a viewer cannot sign out");
    assert.equal((await tool["computers.browser.sign_out"]!(as(DANA, false).ctx, { agentId: "agt_named", site: "app.clio.com" })).ok, true);
    assert.equal((await tool["computers.browser.sign_out"]!(as(OMAR, true).ctx, { agentId: "agt_dex", site: "x.test" })).ok, true, "an admin");
    await assert.rejects(() => tool["computers.browser.sign_out"]!(as(DANA).ctx, { agentId: "agt_dex", site: "../etc" }), (e) => codeOf(e) === "validation.bad_input");
    await assert.rejects(() => tool["computers.browser.sign_out"]!(as(OMAR, true).ctx, { agentId: "agt_dana_ast", site: "x.test" }), (e) => codeOf(e) === "permission.no_grant");
    assert.deepEqual(signedOut, ["app.clio.com", "x.test"]);
  } finally { sessionsNow = () => []; off(); }
});

// Audit B6 (12 Nov): computers.browser.take_over asked for computers.take_over, which a member does not hold, so a plain member could not take over their own Assistant's browser. The decision: a personal agent's
// browser belongs to its owner (see, take over, give back, sign out); owners and admins see and take over team agents' browsers; nobody else, an admin included, touches someone's personal agent's browser.
test("a plain member's rights cover taking over, giving back and signing out their own Assistant's browser: the capabilities ask only for what every member holds", async () => {
  const { registry } = await import("../../../generated/registry.ts");
  const { PERMISSIONS } = await import("../../../manifests/permissions.ts");
  const memberHas = new Set(PERMISSIONS.filter((p) => p.defaults.member === true).map((p) => p.key));
  for (const name of ["computers.browser.take_over", "computers.browser.give_back", "computers.browser.sign_out", "computers.browser.stream", "computers.browser.sessions", "computers.browser.timeline", "computers.browser.profiles"]) {
    const c = (registry.capabilities as Array<{ name: string; permission?: string | null }>).find((x) => x.name === name)!;
    assert.ok(c, name);
    assert.ok(c.permission === null || c.permission === undefined || memberHas.has(c.permission), `${name} asks for ${String(c.permission)}, which a member does not hold`);
  }
});

test("who takes over: a member their own Assistant (yes), a member someone else's team agent (no), an admin a team agent (yes), an admin someone else's personal agent or Assistant (no)", async () => {
  const r = rig();
  try {
    // a plain member, not an admin: their own Assistant and their own personal agent
    for (const id of ["agt_dana_ast", "agt_mine"]) {
      const dana = as(DANA, false);
      const took = await tool["computers.browser.take_over"]!(dana.ctx, { agentId: id });
      assert.equal(took.profile.takeoverBy, DANA, `${id}: taken over by its owner`);
      await tool["computers.browser.sign_out"]!(dana.ctx, { agentId: id, site: "app.example.com" });
      const back = await tool["computers.browser.give_back"]!(dana.ctx, { agentId: id });
      assert.equal(back.profile.takeoverBy, undefined, `${id}: given back`);
    }
    // a plain member and someone else's team agent
    await assert.rejects(() => tool["computers.browser.take_over"]!(as(OMAR, false).ctx, { agentId: "agt_dex" }), (e) => codeOf(e) === "permission.no_grant");
    // an admin and a team agent
    const admin = as(OMAR, true);
    assert.equal((await tool["computers.browser.take_over"]!(admin.ctx, { agentId: "agt_dex" })).profile.takeoverBy, OMAR);
    await tool["computers.browser.give_back"]!(admin.ctx, { agentId: "agt_dex" });
    // an admin and someone else's personal agent or Assistant: refused, take over, give back and sign out alike
    for (const id of ["agt_dana_ast", "agt_mine"]) {
      for (const [cap, input] of [["computers.browser.take_over", { agentId: id }], ["computers.browser.give_back", { agentId: id }], ["computers.browser.sign_out", { agentId: id, site: "app.example.com" }], ["computers.browser.stream", { agentId: id }]] as const) {
        await assert.rejects(() => tool[cap]!(as(OMAR, true).ctx, input), (e) => codeOf(e) === "permission.no_grant", `${cap} ${id} by an admin`);
      }
    }
    assert.ok(!r.seen.some((s) => s.includes(OMAR) && (s.includes("agt_dana_ast") || s.includes("agt_mine"))), "nothing reached the browser service for them");
  } finally { off(); }
});
