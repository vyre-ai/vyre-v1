// The Gate on the single send API (spec 2.14, 4.4; ARCH 8.2), through the real invoke pipeline: a person's own send skips the Gate;
// an agent's, an automation's and a campaign's is held as an Approve task, runs once approved, and never reaches the provider before.
// The pipeline is host/src/invoke.ts over the real registry and validators; the Gate hook asks `sendGateApplies`, the rule this module
// exports for it. Authorize is a stand-in that allows, so the only thing that can hold a call here is the Gate.
import test from "node:test";
import assert from "node:assert/strict";
import { createInvoke, indexCapabilities } from "../../../host/src/invoke.ts";
import type { CommitBatch, CtxSeed, GateHook, Handler, InvokeResult } from "../../../host/src/invoke.ts";
import { registry } from "../../../generated/registry.ts";
import { validateInput } from "../../../generated/validators.ts";
import type { CapabilityDef } from "../../../packages/contracts/src/types.ts";
import { sendGateApplies, send, sendAs, sendPreview, TRACE_HEADER } from "../handlers/send.ts";
import { codeOf, contractErrors, NOW } from "../fixtures/harness.ts";
import { rig, row, sendIn } from "./send.rig.test.ts";
import type { RigOptions } from "./send.rig.test.ts";

const ALLOW = { effect: "allow", reason: "ok", steps: [], scope: undefined, obligations: [], decisionId: "dec_gatetest01" } as const;
const PERSON: CtxSeed["principal"] = { kind: "person", id: "usr_maya01" };
const AGENT: CtxSeed["principal"] = { kind: "agent", id: "agt_scout01" };
const SERVICE: CtxSeed["principal"] = { kind: "service", id: "svc_engine01" };
const APPROVED = "approval-token-for-this-payload";

/** The capabilities mail.send calls while it runs; the rig answers them. */
const NESTED = [
  "settings.get", "contacts.suppression.check", "contacts.preferences.get", "resend.send_email", "mailgun.send_email", "google.gmail.send_message", "ms.mail.send_message", "files.get",
];

function stack(o: RigOptions = {}) {
  const r = rig(o);
  const parked: { cap: string; act: string; principal: string }[] = [];
  const commits: CommitBatch[] = [];
  const handlers: Record<string, Handler> = {
    "mail.send": (ctx, input) => send(ctx, input),
    "mail.send_as": (ctx, input) => sendAs(ctx, input),
    "mail.send_preview": (ctx, input) => sendPreview(ctx, input),
  };
  for (const name of NESTED) handlers[name] = (_ctx, input) => r.ctx.call(name, input);
  const gate: GateHook = {
    // the Gate hook asks the rule this module exports; provider calls made from inside an already cleared send are not asked again
    applies: (c, _input, seed) => (c.name === "mail.send" || c.name === "mail.send_as" ? sendGateApplies({ principalKind: seed.principal.kind, origin: seed.origin }) : null),
    park: async (a) => {
      parked.push({ cap: a.cap.name, act: a.act, principal: a.seed.principal.id });
      return { taskId: "tsk_hold01" };
    },
    verify: (token) => token === APPROVED,
  };
  const invoke = createInvoke({
    caps: indexCapabilities(registry.capabilities as unknown as CapabilityDef[]),
    validateInput,
    authorize: () => ALLOW,
    handler: (name) => handlers[name],
    commit: async (b) => {
      commits.push(b);
      return b.events.map((e, i) => ({ ...e, seq: commits.length * 10 + i + 1 }));
    },
    gate,
    services: () => ({ db: r.h.ctx.db }),
    now: () => r.ctx.now(),
  });
  const as = (principal: CtxSeed["principal"], more: Partial<CtxSeed> = {}): CtxSeed => ({ space: "spc_mailtest", principal, ...more });
  return { r, parked, commits, invoke, as };
}

/** The commit batch of the one call to `cap`; calls it makes (the provider, the settings) commit their own audit rows. */
function committed(s: { commits: CommitBatch[] }, cap: string): CommitBatch {
  const hit = s.commits.filter((c) => c.cap === cap);
  assert.equal(hit.length, 1, `one commit for ${cap}`);
  return hit[0]!;
}

function done(res: InvokeResult): { output: Record<string, unknown>; traceId: string } {
  if (res.status !== "ok") assert.fail(`expected the call to run, it was held as ${res.taskId}`);
  return { output: res.output as Record<string, unknown>, traceId: res.traceId };
}

// ---- the rule

test("the Gate rule: a person at a screen skips it; an agent, an automation, a campaign and an outside actor do not", () => {
  const cases: [Parameters<typeof sendGateApplies>[0], boolean][] = [
    [{ principalKind: "person" }, false],
    [{ principalKind: "person", origin: "user" }, false],
    [{ principalKind: "agent" }, true],
    [{ principalKind: "agent", origin: "user" }, true],
    [{ principalKind: "service", origin: "user" }, true],
    [{ principalKind: "actor", origin: "user" }, true],
    [{ principalKind: "person", origin: "automation:aut_1" }, true],
    [{ principalKind: "person", origin: "campaign:cmp_1" }, true],
    [{ principalKind: "service", origin: "campaign:cmp_1" }, true],
  ];
  for (const [call, held] of cases) assert.deepEqual(sendGateApplies(call), held ? { act: "send" } : null, JSON.stringify(call));
});

// ---- through the pipeline

test("a person's own send skips the Gate and goes out, with the trace id in the header and on the row", async () => {
  const s = stack();
  const input = sendIn();
  const { output, traceId } = done(await s.invoke("mail.send", input, s.as(PERSON)));
  assert.equal(output.status, "sent");
  assert.deepEqual(s.parked, []);
  assert.deepEqual(contractErrors("mail.send", "out", output), []);
  const body = s.r.calls("resend.send_email")[0]!.input;
  assert.equal((body.headers as Record<string, string>)[TRACE_HEADER], traceId);
  assert.equal(row(s.r, String(output.messageId))!.traceId, traceId);
  assert.deepEqual(committed(s, "mail.send").events.map((e) => [e.type, e.actor]), [["message.sent", "usr_maya01"]]);
  assert.equal(body.text, "Hi Pat");   // no agent line on a person's message
});

test("an agent's send is held for approval before anything is stored or sent", async () => {
  const s = stack();
  const res = await s.invoke("mail.send", sendIn(), s.as(AGENT));
  assert.deepEqual([res.status, res.status === "held" ? res.taskId : null], ["held", "tsk_hold01"]);
  assert.deepEqual(s.parked, [{ cap: "mail.send", act: "send", principal: "agt_scout01" }]);
  assert.equal(s.r.seen.length, 0);   // not even the suppression list was asked
  assert.equal(s.r.h.rows(`SELECT * FROM mail_message`).length, 0);
  assert.equal(s.commits.length, 0);
});

test("once approved, the agent's send runs, carries the agent line and names the agent", async () => {
  const s = stack();
  const { output } = done(await s.invoke("mail.send", sendIn(), s.as(AGENT, { approval: APPROVED })));
  assert.equal(output.status, "sent");
  assert.equal(s.r.calls("resend.send_email")[0]!.input.text, "Hi Pat\n\n-- \nDrafted by an agent");
  assert.equal(row(s.r, String(output.messageId))!.draftedByAgent, "agt_scout01");
  assert.deepEqual(s.parked, []);
});

test("an approval token the Gate does not accept holds the send again", async () => {
  const s = stack();
  const res = await s.invoke("mail.send", sendIn(), s.as(AGENT, { approval: "stale-token" }));
  assert.equal(res.status, "held");
  assert.equal(s.r.sent().length, 0);
});

test("automations and campaigns are held like agents; the same call from a person at a screen is not", async () => {
  const s = stack();
  const auto = await s.invoke("mail.send", sendIn(), s.as(SERVICE, { origin: "automation:aut_1" }));
  const camp = await s.invoke("mail.send", sendIn(), s.as(SERVICE, { origin: "campaign:cmp_spring" }));
  const asPerson = await s.invoke("mail.send", sendIn(), s.as(PERSON, { origin: "automation:aut_1" }));
  assert.deepEqual([auto.status, camp.status, asPerson.status], ["held", "held", "held"]);
  assert.equal(s.parked.length, 3);
  assert.equal(s.r.sent().length, 0);
  const screen = await s.invoke("mail.send", sendIn(), s.as(PERSON, { origin: "user" }));
  assert.equal(screen.status, "ok");
  assert.equal(s.r.sent().length, 1);
});

test("send_as follows the same Gate: a person's reply goes, an agent's waits", async () => {
  const s = stack();
  const input = { mailboxId: "mbx_maya", to: [{ address: "pat@acme.test" }], subject: "Re: Question", text: "Yes.", idempotencyKey: "as-1" };
  const mine = done(await s.invoke("mail.send_as", input, s.as(PERSON)));
  assert.equal(mine.output.providerId, "gm_1");
  const theirs = await s.invoke("mail.send_as", { ...input, idempotencyKey: "as-2" }, s.as(AGENT));
  assert.equal(theirs.status, "held");
  assert.equal(s.r.calls("google.gmail.send_message").length, 1);
});

test("the preview is never held, whoever asks", async () => {
  const s = stack();
  const { output } = done(await s.invoke("mail.send_preview", { mailboxId: "mbx_hello", to: [{ address: "pat@acme.test" }] }, s.as(AGENT)));
  assert.deepEqual(contractErrors("mail.send_preview", "out", output), []);
  assert.deepEqual(s.parked, []);
});

test("input that does not fit the contract is refused by the pipeline before the Gate or the handler", async () => {
  const s = stack();
  const noKey = Object.fromEntries(Object.entries(sendIn()).filter(([key]) => key !== "idempotencyKey"));
  await assert.rejects(s.invoke("mail.send", noKey, s.as(AGENT)), (e: unknown) => codeOf(e) === "validation.bad_input");
  await assert.rejects(s.invoke("mail.send", sendIn({ mailboxId: "nope" }), s.as(PERSON)), (e: unknown) => codeOf(e) === "validation.bad_input");
  assert.deepEqual(s.parked, []);
  assert.equal(s.r.seen.length, 0);
});

test("a suppressed recipient through the pipeline: the call succeeds as suppressed and the event is committed", async () => {
  const s = stack({ suppressed: { "pat@acme.test": "unsubscribe" } });
  const { output } = done(await s.invoke("mail.send", sendIn(), s.as(PERSON)));
  assert.deepEqual(output, { status: "suppressed", suppressed: ["pat@acme.test"] });
  assert.deepEqual(committed(s, "mail.send").events.map((e) => [e.type, e.payload]), [["message.suppressed", { channel: "email", address: "pat@acme.test", reason: "unsubscribe" }]]);
  assert.equal(s.r.sent().length, 0);
});

test("the clock the pipeline gives the handler is the Space's", async () => {
  const s = stack();
  const { output } = done(await s.invoke("mail.send", sendIn(), s.as(PERSON)));
  assert.equal(row(s.r, String(output.messageId))!.sentAt, NOW);
});
