// comms.senders.list and comms.senders.set_default: every sender the caller may use, gathered through the owning modules' capabilities.
// The scripted stand-ins answer in the shape those capabilities' manifests declare; the answer of the list is checked against the manifest of this module (the generated registry is
// rebuilt by CI, so the new capabilities are read from the manifest itself).
import test from "node:test";
import assert from "node:assert/strict";
import manifest from "../../../manifests/inbox.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import { fail } from "../../../host/src/routes/errors.ts";
import { sendersList, sendersSetDefault } from "../handlers/senders.ts";
import type { Sender } from "../handlers/senders.ts";
import { codeOf, harness } from "../fixtures/harness.ts";
import type { InboxCtx } from "../projections.ts";

const ME = "usr_maya01";
interface Box { id: string; kind: "personal" | "shared" | "agent" | "service"; address: string; title: string; provider: "google" | "microsoft" | "imap" | "inbound_only"; privacy: "private" | "space" | "people"; state: string; ownerId?: string; agentId?: string }
interface Num { id: string; e164: string; title: string; displayName?: string; state: "pending" | "active" | "released"; capabilities: string[]; assigneeKind: "person" | "agent" | "inbox"; assigneeId?: string }
interface World {
  boxes?: Box[]; domains?: { id: string; name: string; provider: "resend" | "mailgun"; verified: boolean }[]; numbers?: Num[];
  provider?: "resend" | "mailgun"; stored?: Partial<Record<"email" | "text", string>>; denied?: string[]; down?: string[]; principal?: InboxCtx["principal"]; pageSize?: number;
}

const GMAIL: Box = { id: "mbx_maya", kind: "personal", address: "maya@firm.test", title: "Maya", provider: "google", privacy: "private", state: "syncing", ownerId: ME };
const OUTLOOK: Box = { id: "mbx_omar", kind: "personal", address: "omar@firm.test", title: "Omar", provider: "microsoft", privacy: "space", state: "syncing", ownerId: "usr_omar01" };
const IMAP: Box = { id: "mbx_imap", kind: "personal", address: "maya@old.test", title: "Old mail", provider: "imap", privacy: "private", state: "syncing", ownerId: ME };
const HELLO: Box = { id: "mbx_hello", kind: "shared", address: "hello@firm.test", title: "Hello", provider: "inbound_only", privacy: "space", state: "syncing" };
const LINE: Num = { id: "num_line", e164: "+14155550101", title: "Intake line", displayName: "Intake line", state: "active", capabilities: ["voice", "sms"], assigneeKind: "person", assigneeId: ME };
const DOMAIN = { id: "dom_firm", name: "mail.firm.test", provider: "resend" as const, verified: true };

function setup(w: World = {}) {
  const h = harness({ principal: w.principal ?? { kind: "person", id: ME } });
  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  const stored = { ...(w.stored ?? {}) } as Record<string, string>;
  const page = <T>(rows: T[], input: Record<string, unknown>): { rows: T[]; next?: string } => {
    const size = w.pageSize ?? 500;
    const from = typeof input.cursor === "string" ? Number(input.cursor) : 0;
    const slice = rows.slice(from, from + size);
    return from + slice.length < rows.length ? { rows: slice, next: String(from + slice.length) } : { rows: slice };
  };
  const ctx: InboxCtx = Object.assign(Object.create(h.ctx) as InboxCtx, {
    principal: w.principal ?? { kind: "person", id: ME },
    authorize(action: { perm: string | null }, resource: { type: string; id: string | null }) {
      authz.push({ perm: action.perm, ...resource });
      const effect = (w.denied ?? []).includes(`${resource.type}:${resource.id}`) ? "deny" : "allow";
      return { effect, reason: effect, decisionId: "dec_test" } as const;
    },
    async call(cap: string, input: unknown): Promise<unknown> {
      const body = input as Record<string, unknown>;
      calls.push({ cap, input: body });
      if ((w.down ?? []).includes(cap)) throw fail("internal.unavailable", "0".repeat(32));
      switch (cap) {
        case "mail.mailbox.list": { const p = page(w.boxes ?? [], body); return { mailboxes: p.rows, total: (w.boxes ?? []).length, ...(p.next ? { next: p.next } : {}) }; }
        case "mail.domain.list": { const p = page(w.domains ?? [], body); return { domains: p.rows.map((d) => ({ ...d, spf: "pass", dkim: "pass", dmarc: "pass", isDefault: true })), total: 1 }; }
        case "telephony.number.list": { const p = page(w.numbers ?? [], body); return { numbers: p.rows, total: (w.numbers ?? []).length, ...(p.next ? { next: p.next } : {}) }; }
        case "settings.get": {
          const key = String(body.key);
          if (key === "mail.provider") return { row: { key, value: w.provider ?? "resend" } };
          const channel = key === "comms.default_sender_email" ? "email" : "text";
          return { row: { key, value: stored[channel] ?? null } };
        }
        case "settings.set": {
          const channel = body.key === "comms.default_sender_email" ? "email" : "text";
          stored[channel] = String(body.value);
          return { row: { key: body.key, value: body.value }, previous: null };
        }
        default: throw new Error(`unexpected call ${cap}`);
      }
    },
  });
  const authz: { perm: string | null; type: string; id: string | null }[] = [];
  return { ctx, calls, stored, authz };
}

const out = (name: string) => manifest.capabilities?.find((c) => c.name === name)?.output;
const byId = (rows: Sender[], id: string): Sender => rows.find((s) => s.id === id) ?? assert.fail(`no sender ${id}`);

test("email senders come from every mailbox: Gmail and Outlook as the member, IMAP and shared through the Space domain, each with its provider name", async () => {
  const { ctx } = setup({ boxes: [GMAIL, OUTLOOK, IMAP, HELLO], domains: [DOMAIN], numbers: [LINE] });
  const r = await sendersList(ctx, { channel: "email" });
  assert.deepEqual(validate(out("comms.senders.list")!, r, "", {}), []);
  assert.deepEqual(r.senders.map((s) => [s.id, s.via, s.provider, s.scope, s.usable]), [
    ["mbx_maya", "Gmail", "google", "mine", true],
    ["mbx_imap", "Resend", "resend", "mine", true],
    ["mbx_hello", "Resend", "resend", "space", true],
    ["mbx_omar", "Outlook", "microsoft", "space", true],
  ]);
  assert.deepEqual(r.senders.map((s) => s.channel), ["email", "email", "email", "email"]);
  assert.equal(byId(r.senders, "mbx_maya").address, "maya@firm.test");
  assert.equal(byId(r.senders, "mbx_maya").name, "Maya");
});

test("with no channel the list holds email and text senders, and texting numbers say Twilio", async () => {
  const { ctx } = setup({ boxes: [GMAIL], numbers: [LINE, { ...LINE, id: "num_shared", e164: "+14155550102", title: "Front desk", displayName: undefined, assigneeKind: "inbox", assigneeId: "mbx_hello" }] });
  const r = await sendersList(ctx, {});
  assert.deepEqual(r.senders.map((s) => [s.id, s.channel]), [["mbx_maya", "email"], ["num_line", "text"], ["num_shared", "text"]]);
  const line = byId(r.senders, "num_line");
  assert.deepEqual([line.via, line.provider, line.scope, line.address, line.name, line.usable], ["Twilio", "twilio", "mine", "+14155550101", "Intake line", true]);
  assert.equal(byId(r.senders, "num_shared").scope, "space");
  assert.equal(byId(r.senders, "num_shared").name, "Front desk");
});

test("a mailbox that cannot send is listed with the reason: receive only, paused, error, disconnected; one still waiting for its first sync can send", async () => {
  const { ctx } = setup({
    boxes: [
      { ...HELLO, id: "mbx_rx" }, { ...GMAIL, id: "mbx_paused", state: "paused", address: "a@firm.test" }, { ...GMAIL, id: "mbx_err", state: "error", address: "b@firm.test" },
      { ...GMAIL, id: "mbx_gone", state: "disconnected", address: "d@firm.test" },
    ],
  });
  const r = await sendersList(ctx, { channel: "email" });
  assert.equal(r.senders.length, 4);
  assert.ok(r.senders.every((s) => !s.usable && typeof s.why === "string" && s.why.length > 0));
  assert.match(byId(r.senders, "mbx_rx").why!, /Receive only.*verify a Resend sending domain/);
  assert.match(byId(r.senders, "mbx_paused").why!, /Paused/);
  assert.match(byId(r.senders, "mbx_err").why!, /reconnected/);
  assert.match(byId(r.senders, "mbx_gone").why!, /Disconnected/);
  assert.ok(r.senders.every((s) => !s.default), "nothing usable, so nothing is the default");
  const first = await sendersList(setup({ boxes: [{ ...GMAIL, state: "pending" }] }).ctx, { channel: "email" });
  assert.equal(first.senders[0]?.usable, true, "a connection waiting for its first sync can send");
});

test("the Space sending provider decides the name, and an unverified domain at that provider means the domain senders cannot send", async () => {
  const mailgun = setup({ boxes: [IMAP], domains: [{ ...DOMAIN, provider: "mailgun" }], provider: "mailgun" });
  const a = await sendersList(mailgun.ctx, { channel: "email" });
  assert.deepEqual([a.senders[0]?.via, a.senders[0]?.provider, a.senders[0]?.usable], ["Mailgun", "mailgun", true]);

  const wrong = setup({ boxes: [IMAP, GMAIL], domains: [{ ...DOMAIN, provider: "mailgun" }], provider: "resend" });
  const b = await sendersList(wrong.ctx, { channel: "email" });
  assert.equal(byId(b.senders, "mbx_imap").usable, false);
  assert.equal(byId(b.senders, "mbx_maya").usable, true, "a member's own Gmail needs no Space domain");

  const unverified = setup({ boxes: [IMAP], domains: [{ ...DOMAIN, verified: false }] });
  assert.equal((await sendersList(unverified.ctx, { channel: "email" })).senders[0]?.usable, false);
});

test("an agent sends through the Space domain even from a Gmail mailbox, and shared and agent inboxes ask their own permission", async () => {
  const agent = setup({ boxes: [{ ...GMAIL, ownerId: undefined, agentId: "agt_bot" }, HELLO], domains: [DOMAIN], principal: { kind: "agent", id: "agt_bot" } });
  const r = await sendersList(agent.ctx, { channel: "email" });
  assert.equal(byId(r.senders, "mbx_maya").via, "Resend");
  assert.deepEqual(agent.authz.map((a) => a.perm), ["comms.agent_send", "comms.agent_send"]);

  const person = setup({ boxes: [GMAIL, HELLO], domains: [DOMAIN] });
  await sendersList(person.ctx, { channel: "email" });
  assert.deepEqual(person.authz.map((a) => [a.id, a.perm]), [["mbx_maya", null], ["mbx_hello", "comms.shared_send"]]);
});

test("access: a mailbox or number the caller may not use is not in the list at all", async () => {
  const { ctx } = setup({ boxes: [GMAIL, HELLO], domains: [DOMAIN], numbers: [LINE, { ...LINE, id: "num_other", e164: "+14155550103", assigneeId: "usr_omar01" }], denied: ["mailbox:mbx_hello", "number:num_other"] });
  const r = await sendersList(ctx, {});
  assert.deepEqual(r.senders.map((s) => s.id), ["mbx_maya", "num_line"]);
});

test("numbers: voice only and still-pending numbers are listed as not usable with the reason, released ones are gone", async () => {
  const { ctx } = setup({ numbers: [
    LINE, { ...LINE, id: "num_voice", e164: "+14155550104", title: "Voice", displayName: "Voice", capabilities: ["voice"] },
    { ...LINE, id: "num_wait", e164: "+14155550105", title: "New", displayName: "New", state: "pending" }, { ...LINE, id: "num_rel", e164: "+14155550106", state: "released" },
  ] });
  const r = await sendersList(ctx, { channel: "text" });
  assert.deepEqual(r.senders.map((s) => [s.id, s.usable]), [["num_line", true], ["num_wait", false], ["num_voice", false]]);
  assert.match(byId(r.senders, "num_voice").why!, /cannot send texts/);
  assert.match(byId(r.senders, "num_wait").why!, /set up/);
});

test("lists longer than one page are read to the end", async () => {
  const boxes = Array.from({ length: 7 }, (_, i) => ({ ...HELLO, id: `mbx_s${i}`, address: `s${i}@firm.test`, title: `S${i}` }));
  const { ctx, calls } = setup({ boxes, domains: [DOMAIN], pageSize: 3 });
  const r = await sendersList(ctx, { channel: "email" });
  assert.equal(r.senders.length, 7);
  assert.equal(calls.filter((c) => c.cap === "mail.mailbox.list").length, 3);
});

test("a source that is down does not hide the others: the domain list failing leaves Gmail usable and the domain senders not", async () => {
  const { ctx } = setup({ boxes: [GMAIL, IMAP], domains: [DOMAIN], numbers: [LINE], down: ["mail.domain.list"] });
  const r = await sendersList(ctx, {});
  assert.equal(byId(r.senders, "mbx_maya").usable, true);
  assert.equal(byId(r.senders, "mbx_imap").usable, false);
  assert.equal(byId(r.senders, "num_line").usable, true);
  const noText = setup({ boxes: [GMAIL], numbers: [LINE], down: ["telephony.number.list"] });
  assert.deepEqual((await sendersList(noText.ctx, {})).senders.map((s) => s.id), ["mbx_maya"]);
});

test("the default: the stored choice, else the caller's own usable sender, else the first usable one; exactly one per channel", async () => {
  const world = { boxes: [OUTLOOK, GMAIL, HELLO], domains: [DOMAIN], numbers: [LINE, { ...LINE, id: "num_b", e164: "+14155550107", displayName: "B", title: "B", assigneeId: "usr_omar01" }] };
  const none = await sendersList(setup(world).ctx, {});
  assert.deepEqual(none.senders.filter((s) => s.default).map((s) => s.id), ["mbx_maya", "num_line"]);

  const chosen = await sendersList(setup({ ...world, stored: { email: "mbx_hello", text: "num_b" } }).ctx, {});
  assert.deepEqual(chosen.senders.filter((s) => s.default).map((s) => s.id), ["mbx_hello", "num_b"]);

  const gone = await sendersList(setup({ ...world, stored: { email: "mbx_deleted" } }).ctx, { channel: "email" });
  assert.deepEqual(gone.senders.filter((s) => s.default).map((s) => s.id), ["mbx_maya"], "a stored sender that no longer exists falls back");

  const unusable = await sendersList(setup({ boxes: [{ ...GMAIL, state: "paused" }, HELLO], domains: [DOMAIN], stored: { email: "mbx_maya" } }).ctx, { channel: "email" });
  assert.deepEqual(unusable.senders.filter((s) => s.default).map((s) => s.id), ["mbx_hello"], "a stored sender that cannot send now is not the default");

  const noMine = await sendersList(setup({ boxes: [OUTLOOK], numbers: [] }).ctx, { channel: "email" });
  assert.deepEqual(noMine.senders.filter((s) => s.default).map((s) => s.id), ["mbx_omar"]);
});

test("set_default stores the choice in the person's own settings, and the next list shows it", async () => {
  const w = setup({ boxes: [GMAIL, HELLO], domains: [DOMAIN], numbers: [LINE] });
  const r = await sendersSetDefault(w.ctx, { channel: "email", senderId: "mbx_hello" });
  assert.deepEqual(r, { channel: "email", senderId: "mbx_hello" });
  assert.deepEqual(w.calls.filter((c) => c.cap === "settings.set").map((c) => c.input), [{ key: "comms.default_sender_email", value: "mbx_hello" }]);
  assert.deepEqual((await sendersList(w.ctx, { channel: "email" })).senders.filter((s) => s.default).map((s) => s.id), ["mbx_hello"]);
  await sendersSetDefault(w.ctx, { channel: "text", senderId: "num_line" });
  assert.equal(w.stored.text, "num_line");
});

test("set_default refuses a sender that is not on the channel's list, one that cannot send, and a bad channel, in plain words", async () => {
  const w = setup({ boxes: [{ ...GMAIL, state: "paused" }], numbers: [LINE] });
  await assert.rejects(sendersSetDefault(w.ctx, { channel: "email", senderId: "num_line" }), (e) => codeOf(e) === "validation.precondition_failed" && /not one you can send from/.test((e as { error: { message: string } }).error.message));
  await assert.rejects(sendersSetDefault(w.ctx, { channel: "email", senderId: "mbx_maya" }), (e) => codeOf(e) === "validation.precondition_failed" && /maya@firm.test cannot send right now. Paused/.test((e as { error: { message: string } }).error.message));
  await assert.rejects(sendersSetDefault(w.ctx, { channel: "fax" as never, senderId: "x" }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(sendersList(w.ctx, { channel: "fax" as never }), (e) => codeOf(e) === "validation.bad_input");
  assert.deepEqual(w.stored, {}, "nothing was stored");
  const denied = setup({ boxes: [GMAIL], denied: ["mailbox:mbx_maya"] });
  await assert.rejects(sendersSetDefault(denied.ctx, { channel: "email", senderId: "mbx_maya" }), (e) => codeOf(e) === "validation.precondition_failed");
});
