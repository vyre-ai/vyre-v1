// Ask the person (docs/ask-the-person.md): an outside agent asked the person it acts for to do what only that person may. The hold runs as the person and names the agent; only that person,
// on their own press, releases it; it runs as them, once, with exactly the input on the card; a raw secret never gets onto a card. The neighbours are the harness fakes.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf, reasonOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, as, bob, bot, parkInput } from "../fixtures/seed.ts";
import { findHold, rawSecretIn } from "../projections.ts";

const SSO = { provider: { key: "google", title: "Google", issuer: "https://accounts.google.com", clientId: "123.apps.googleusercontent.com", clientSecretHandle: "#Google_Client_Secret", enabled: true } };
type Parked = { holdId: string; taskId: string };

/** What the Gate hook hands gate.park for an ask: the person as principal, the agent in `ask`. */
const askInput = (over: Record<string, unknown> = {}): Record<string, unknown> =>
  parkInput({ capName: "members.sso.set", input: SSO, act: "signin_change", principal: alice, actingFor: undefined, ask: { by: bot, what: "Add or change an OIDC provider" }, ...over });

async function parkAsk(h: Harness, over: Record<string, unknown> = {}): Promise<Parked> {
  h.callee("access.principals.get", () => ({ principal: { name: "Simba (Claude Code)" } }));
  return h.call("gate.park", askInput(over), as(bot));
}
const claims = (h: Harness, p: Parked, over: Record<string, unknown> = {}) => ({ task: p.taskId, hold: p.holdId, decision: "dec_1", hash: "ph_1", by: alice.id, forPerson: null, device: "dev_1", exp: h.now() + 600_000, ...over });
const release = (h: Harness, p: Parked, over: Record<string, unknown> = {}, who: { id: string; kind: "person" | "agent"; device?: string; actingFor?: string } = { id: alice.id, kind: "person", device: "dev_1" }) =>
  h.call("gate.release", { holdId: p.holdId, taskId: p.taskId, approvalToken: h.sealToken(claims(h, p, over)) }, who);
async function refused(p: Promise<unknown>, code: string, reason?: string): Promise<void> {
  await assert.rejects(p, (e) => { assert.equal(codeOf(e), code, JSON.stringify(e)); if (reason) assert.equal(reasonOf(e), reason); return true; });
}

test("an ask parks as the person's own call: assigned to them only, named for the agent, every input on the card, dropped (never passed on) when nobody answers", async () => {
  const h = harness();
  const p = await parkAsk(h);
  const hold = findHold(h.db, p.holdId)!;
  assert.deepEqual(hold.principal, alice, "it runs as the person");
  assert.deepEqual(hold.askedBy, bot, "and names the agent that asked");
  assert.equal(hold.actingFor, undefined);
  assert.deepEqual(hold.approver, { kind: "person", id: alice.id }, "the person, whatever the act's rule says (signin_change names admins)");
  assert.equal(hold.rule.onTimeout, "drop");
  assert.equal(hold.summary, "Simba (Claude Code) asks you to: Add or change an OIDC provider");
  const task = h.callsTo("tasks.create")[0]!.input;
  assert.deepEqual(task.assigned, { kind: "person", id: alice.id });
  assert.equal(task.title, "Simba (Claude Code) asks: Add or change an OIDC provider");
  const [about, inputs] = task.blocks;
  assert.equal(about.type, "pairs");
  assert.deepEqual([about.data.act, about.data.cap, about.data.input, about.data.ask], ["signin_change", "members.sso.set", SSO, { what: "Add or change an OIDC provider", by: "Simba (Claude Code)" }], "the chat card reads the hold like any other, and the ask's own line");
  assert.deepEqual(about.data.pairs, [["What happens", "Add or change an OIDC provider"], ["Asked by", "Simba (Claude Code)"], ["Runs as", "You, once, exactly as shown"], ["Tool", "members.sso.set"]]);
  assert.equal(inputs.type, "table");
  assert.deepEqual(inputs.data.rows, Object.entries(SSO.provider).map(([k, v]) => [`provider ${k}`, String(v)]), "the exact input, one value per row, the secret as its handle");
  const requested = h.events.find((e) => e.name === "gate.requested")!;
  assert.deepEqual(requested.payload["askedBy"], bot);
  assert.deepEqual(requested.payload["principal"], alice);
});

test("an ask that carries a secret value is refused before any card exists; a handle is fine", async () => {
  const h = harness();
  const raw = { provider: { ...SSO.provider, clientSecretHandle: "#ok", clientSecret: "GOCSPX-abc" } };
  await refused(parkAsk(h, { input: raw }), "validation.bad_input", "raw_secret");
  assert.equal(h.callsTo("tasks.create").length, 0, "no card shows the value");
  assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS n FROM gate_holds").get()!["n"], 0, "and no row keeps it");
  assert.equal(rawSecretIn({ apiKey: "#Stripe_Live" }), null);
  assert.equal(rawSecretIn({ nested: [{ password: "hunter2" }] }), "/nested/0/password");
  assert.equal(rawSecretIn({ clientSecretHandle: "#X" }), null);
});

test("only the person it runs as releases it, by their own press: not an admin, not an agent acting for them; then it runs as them, once, exactly as held", async () => {
  const h = harness();
  h.callee("members.sso.set", (input: unknown) => ({ provider: (input as typeof SSO).provider }));
  const p = await parkAsk(h);
  await refused(release(h, p, { by: bob.id }, { id: bob.id, kind: "person", device: "dev_1" }), "validation.precondition_failed", "not_the_person");
  await refused(release(h, p, { forPerson: alice.id, by: bot.id }, { id: bot.id, kind: "agent", actingFor: alice.id }), "validation.precondition_failed");
  assert.equal(h.callsTo("members.sso.set").length, 0, "nothing ran on a refused approval");
  const r = await release(h, p);
  const ran = h.callsTo("members.sso.set");
  assert.equal(ran.length, 1);
  assert.deepEqual(ran[0]!.input, SSO, "exactly what was held");
  assert.equal(ran[0]!.opts?.onBehalfOf, alice.id, "as the person, never as the agent");
  assert.deepEqual(r, { result: SSO });
  const hold = findHold(h.db, p.holdId)!;
  assert.equal(hold.state, "approved");
  assert.equal(hold.decidedBy, alice.id);
  assert.deepEqual(hold.result, SSO, "the answer waits for the agent that asked, though it has no chat");
  assert.deepEqual(h.events.find((e) => e.name === "gate.approved")!.payload, { holdId: p.holdId, act: "signin_change", taskId: p.taskId, askedBy: bot, by: alice.id });
  await refused(release(h, p), "validation.precondition_failed", "not_held");
  assert.equal(h.callsTo("members.sso.set").length, 1, "single use");
});

test("declined, the agent's ask is closed and the event names it", async () => {
  const h = harness();
  const p = await parkAsk(h);
  await h.call("gate.deny", { holdId: p.holdId, taskId: p.taskId, mode: "send_back", note: "Not yet" }, { id: alice.id, kind: "person" });
  assert.equal(findHold(h.db, p.holdId)!.state, "denied");
  assert.deepEqual(h.events.find((e) => e.name === "gate.denied")!.payload, { holdId: p.holdId, act: "signin_change", taskId: p.taskId, askedBy: bot, by: alice.id, mode: "send_back", note: "Not yet" });
});

test("an ask names a person: an agent principal with ask is refused", async () => {
  const h = harness();
  await refused(parkAsk(h, { principal: bot }), "validation.bad_input", "ask_not_person");
});
