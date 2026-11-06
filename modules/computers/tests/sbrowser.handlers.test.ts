// What a person does with an agent's browser (sbrowser/handlers.ts): list the ones they may watch, open the live view, take over, give back. An Assistant's browser is its person's alone, a team agent's goes
// to its owner and to admins, and an agent never uses these (it drives its own profile with its tools).
import test from "node:test";
import assert from "node:assert/strict";
import { bindSpaceBrowser } from "../sbrowser/port.ts";
import type { ProfileRow, SpaceBrowser } from "../sbrowser/port.ts";
import { ToolError } from "../handlers/tools/common.ts";
import { codeOf, DANA, harness, OMAR } from "../fixtures/harness.ts";
import { tool } from "./tools.fixture.ts";

const AGENTS: Record<string, { ownerId: string; kind: "assistant" | "agent"; personal?: boolean }> = {
  agt_dana_ast: { ownerId: DANA, kind: "assistant" },
  agt_dex: { ownerId: DANA, kind: "agent" },
  agt_mine: { ownerId: DANA, kind: "agent", personal: true },
};
const row = (profileId: string, over: Partial<ProfileRow> = {}): ProfileRow => ({ profileId, running: true, tabs: 2, busy: false, takeover: false, viewers: 0, lastActiveAt: 1_760_000_000_000, held: 0, paused: false, ...over });

function rig() {
  const rows = new Map<string, ProfileRow>([["agt_dana_ast", row("agt_dana_ast")], ["agt_dex", row("agt_dex", { bridge: { connected: 1, hello: true, optin: true } })], ["agt_mine", row("agt_mine")], ["agt_gone", row("agt_gone")]]);
  const seen: string[] = [];
  const sb: SpaceBrowser = {
    async available() { return true; }, async tool() { return {}; },
    async takeover(a) {
      const r = rows.get(a.profileId)!;
      if (r.takeoverBy && r.takeoverBy !== a.personId) throw new ToolError("bad_input", "Someone else has the controls.");
      rows.set(a.profileId, { ...r, takeover: true, takeoverBy: a.personId }); seen.push(`takeover ${a.profileId} ${a.personId}`);
    },
    async giveBack(id) { const { takeoverBy: _t, ...r } = rows.get(id)!; rows.set(id, { ...r, takeover: false }); seen.push(`give_back ${id}`); },
    async screenshot() { return { bytes: new Uint8Array(), width: 1, height: 1 }; },
    async stream(a) { seen.push(`stream ${a.profileId}`); return { transport: "mjpeg", url: `http://10.0.0.2:7002/stream?t=abc&p=${a.profileId}`, ws: "ws://10.0.0.2:7002/ws?t=abc" }; },
    async stop() {}, async forget() {},
    async profiles() { return { profiles: [...rows.values()], maxRunning: 6 }; }, async health() { return { ok: true }; },
  };
  bindSpaceBrowser(sb);
  return { seen, rows };
}
const respond = { "agents.get": (i: Record<string, unknown>) => { const a = AGENTS[String(i["agentId"])]; if (!a) throw new Error("no such agent"); return { agent: { agentId: i["agentId"], ...a } }; } };
const as = (person: string, manager = true) => harness({ principal: { kind: "person", id: person }, manager, respond });
const off = (): void => bindSpaceBrowser(null);

test("a person sees the browsers they may watch: an owner their own, an admin the team agents' and never another's Assistant or personal agent", async () => {
  rig();
  try {
    const dana = await tool["computers.browser.profiles"]!(as(DANA, false).ctx, {});
    assert.deepEqual(dana.profiles.map((p: { agentId: string; access: string }) => [p.agentId, p.access]), [["agt_dana_ast", "owner"], ["agt_dex", "owner"], ["agt_mine", "owner"]], "Dana sees hers; agt_gone has no agent and is left out");
    assert.equal(dana.maxRunning, 6);
    const omar = await tool["computers.browser.profiles"]!(as(OMAR, true).ctx, {});
    assert.deepEqual(omar.profiles.map((p: { agentId: string; access: string }) => [p.agentId, p.access]), [["agt_dex", "admin"]], "an admin sees the team agent only");
    const member = await tool["computers.browser.profiles"]!(as(OMAR, false).ctx, {});
    assert.deepEqual(member.profiles, [], "a member who is not an admin sees none of Dana's");
    const dex = dana.profiles.find((p: { agentId: string }) => p.agentId === "agt_dex");
    assert.deepEqual([dex.paired, dex.running, dex.tabs, dex.busy], [true, true, 2, false], "paired means Vyre for Chrome is connected and was told the Space");
    assert.equal(dana.profiles.find((p: { agentId: string }) => p.agentId === "agt_mine").paired, false);
  } finally { off(); }
});

test("the live view is for the same people, and it gives a ticketed address that is not the browser's WebSocket for the host's relay", async () => {
  const r = rig();
  try {
    const own = await tool["computers.browser.stream"]!(as(DANA, false).ctx, { agentId: "agt_dex" });
    assert.equal(own.transport, "mjpeg");
    assert.match(own.url, /stream\?t=abc&p=agt_dex/);
    assert.ok(!JSON.stringify(own).includes("ws://"), "the browser's own WebSocket address is for the host's relay, not for a viewer");
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
