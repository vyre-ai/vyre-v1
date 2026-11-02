// agent.toml is an agent's settings: one rule decides who may change them, however the change arrives. agents.config.may_save is what Files asks, as the writer, before it writes a new version of
// agent.toml; agents.update, the role line and restore_version take the same rule. An outside agent never changes them (person_only); anyone else needs Edit on the agent.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { DANA, MAYA, contractErrors, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;   // eslint-disable-line @typescript-eslint/no-explicit-any
const maySave = async (ctx: Harness["ctx"], fileId: string): Promise<{ agentId: string | null; allowed: boolean; reason?: string; message?: string }> => {
  const out = await h["agents.config.may_save"]!(ctx, { fileId });
  assert.deepEqual(contractErrors("agents.config.may_save", "out", out), [], "the answer keeps to the contract");
  return out;
};
const refusal = async (p: Promise<unknown>): Promise<{ code: string; message: string; details?: Record<string, unknown> }> => {
  try { await p; } catch (e) { return (e as { error: { code: string; message: string; details?: Record<string, unknown> } }).error; }
  assert.fail("the call was accepted");
};

/** An agent of Dana's, its agent.toml, and an outside agent Dana let in. */
async function world() {
  const hn = harness({ allow: () => true });
  const agent = (await h["agents.create"]!(hn.ctx, { name: "Intake", idempotencyKey: "c1" })).agent;
  const toml = hn.world.fileIn(hn.world.folderNamed("Intake", hn.world.root)!.folderId, "agent.toml")!;
  const outside = (await h["agents.outside.connect"]!({ ...hn.ctx, depth: 1 }, { clientName: "Claude Code" })) as { agentId: string };
  return { hn, agentId: agent.agentId as string, tomlId: toml.fileId as string, outsideId: outside.agentId };
}

test("the owner may save an agent's agent.toml; a file that is no agent's agent.toml is any file", async () => {
  const { hn, agentId, tomlId } = await world();
  assert.deepEqual(await maySave(hn.ctx, tomlId), { agentId, allowed: true });
  assert.deepEqual(await maySave(hn.ctx, "fil_notanagentfile"), { agentId: null, allowed: true });
});

test("an outside agent may not, even acting for the owner who may: only a person changes an agent's settings", async () => {
  const { hn, tomlId, agentId, outsideId } = await world();
  const as = hn.as({ kind: "agent", id: outsideId }, DANA);
  const r = await maySave(as, tomlId);
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "person_only");
  assert.match(r.message ?? "", /agent\.toml is this agent's settings, and only a person can change/);
  assert.match(r.message ?? "", /suggest the change/i, "it says what to do instead");
  // and the settings capability itself says the same, in the handler as well as at the door
  const upd = await refusal(h["agents.update"]!(as, { agentId, patch: { model: "claude-opus-5-5" } }));
  assert.equal(upd.code, "permission.no_grant");
  assert.equal(upd.details?.["reason"], "person_only");
  assert.equal((await h["agents.get"]!(hn.ctx, { agentId })).agent.model, undefined, "nothing changed");
  const role = await refusal(h["agents.role_line.set"]!(as, { agentId, description: "Something else" }));
  assert.equal(role.details?.["reason"], "person_only");
  // an outside actor (kind actor) is outside too
  assert.equal((await maySave(hn.as({ kind: "actor", id: "act_token1" }, DANA), tomlId)).reason, "person_only");
});

test("another agent, or a person, without Edit on the agent may not; with Edit they may", async () => {
  const { hn, tomlId, agentId } = await world();
  const helper = (await h["agents.create"]!(hn.ctx, { name: "Helper", idempotencyKey: "c2" })).agent.agentId as string;
  // the helper (acting for Maya) and Maya hold no Edit on Intake
  const asHelper = { ...hn.as({ kind: "agent", id: helper }, MAYA), authorize: (action: { level: string }, resource: { type: string; id: string | null }) => ({ effect: resource.type === "agent" && resource.id === agentId && action.level === "edit" ? "deny" as const : "allow" as const, reason: "", decisionId: "d" }) };
  const r = await maySave(asHelper as Harness["ctx"], tomlId);
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "no_edit");
  assert.match(r.message ?? "", /you can read this agent but not change it/);
  const asMaya = { ...hn.person(MAYA), authorize: asHelper.authorize };
  assert.equal((await maySave(asMaya as Harness["ctx"], tomlId)).reason, "no_edit");
  const upd = await refusal(h["agents.update"]!(asMaya as Harness["ctx"], { agentId, patch: { model: "x" } }));
  assert.equal(upd.code, "permission.no_grant");
  // the same agent acting for someone who may, with its own reach allowing it too, may: the rule is agents.update's
  assert.deepEqual(await maySave(hn.as({ kind: "agent", id: helper }, DANA), tomlId), { agentId, allowed: true });
});

test("an agent in Trash keeps its agent.toml guarded, and who it belongs to is said only to someone who may see that agent", async () => {
  const { hn, tomlId, agentId, outsideId } = await world();
  await h["agents.delete"]!(hn.ctx, { agentId });
  assert.equal((await maySave(hn.as({ kind: "agent", id: outsideId }, DANA), tomlId)).allowed, false);
  const stranger = { ...hn.person("usr_stranger"), authorize: () => ({ effect: "deny" as const, reason: "no_grant", decisionId: "d" }) };
  await h["agents.restore"]!(hn.ctx, { agentId });
  const r = await maySave(stranger as Harness["ctx"], tomlId);
  assert.equal(r.allowed, false);
  assert.equal(r.agentId, null, "a stranger learns nothing about which agent this is");
});
