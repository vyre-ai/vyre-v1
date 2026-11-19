// senderId on mail.send, mail.send_as and mail.send_preview: an id from comms.senders.list (for email, the mailbox id). It must name the same mailbox as mailboxId,
// and at send time the sender must still be allowed and connected; the refusal says what to do. Without a senderId nothing changes.
import test from "node:test";
import assert from "node:assert/strict";
import { send, sendAs, sendPreview } from "../handlers/send.ts";
import { AccessSnapshot, authorize } from "../../../kernel/src/authorize/index.ts";
import { codeOf, seedMailbox } from "../fixtures/harness.ts";
import { rig, sendIn } from "./send.rig.test.ts";

async function refusal(p: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await p;
  } catch (e) {
    return { code: codeOf(e), message: (e as { error: { message: string } }).error.message };
  }
  return assert.fail("the send was not refused");
}

test("a send with the senderId of a connected Gmail mailbox goes out through it", async () => {
  const r = rig();
  const out = await send(r.ctx, sendIn({ mailboxId: "mbx_maya", senderId: "mbx_maya" }));
  assert.equal(out.status, "sent");
  assert.equal(r.calls("google.gmail.send_message").length, 1);
});

test("a send with the senderId of a shared mailbox goes out through the Space domain", async () => {
  const r = rig();
  const out = await send(r.ctx, sendIn({ senderId: "mbx_hello" }));
  assert.equal(out.status, "sent");
  assert.equal(r.calls("resend.send_email").length, 1);
});

test("a senderId that names another mailbox than mailboxId, or is not a mailbox, is refused before anything is read or sent", async () => {
  const r = rig();
  const clash = await refusal(send(r.ctx, sendIn({ mailboxId: "mbx_hello", senderId: "mbx_maya" })));
  assert.deepEqual(
    [clash.code, clash.message],
    ["validation.bad_input", "The sender and the mailbox name different senders. Pass the same id for both."],
  );
  const number = await refusal(send(r.ctx, sendIn({ senderId: "num_line" })));
  assert.deepEqual(
    [number.code, number.message],
    ["validation.bad_input", "That sender is not an email sender. Pick one from the list of senders for email."],
  );
  assert.equal(r.sent().length, 0);
});

test("a chosen sender that was disconnected, paused or in error is refused with the next step, even on the Space domain route", async () => {
  const r = rig();
  const cases: [string, string, RegExp][] = [
    ["disconnected", "mbx_hello", /disconnected\. Connect it again in Console, Comms, or pick another sender\./],
    ["paused", "mbx_hello", /paused\. Resume it in Console, Comms/],
    ["error", "mbx_hello", /needs to be reconnected/],
  ];
  for (const [state, id, words] of cases) {
    r.ctx.db.run(`UPDATE mail_mailbox SET state = ? WHERE id = ?`, state, id);
    const got = await refusal(send(r.ctx, sendIn({ mailboxId: id, senderId: id })));
    assert.equal(got.code, "validation.precondition_failed");
    assert.match(got.message, words);
  }
  assert.equal(r.sent().length, 0);
  // the same mailbox without a senderId is not held to this check: nothing changes for callers that do not use the list
  r.ctx.db.run(`UPDATE mail_mailbox SET state = ? WHERE id = ?`, "error", "mbx_hello");
  assert.equal((await send(r.ctx, sendIn({ mailboxId: "mbx_hello" }))).status, "sent");
});

test("a chosen sender the caller may no longer use is refused as not allowed", async () => {
  const r = rig({ denied: new Set(["mbx_maya"]) });
  assert.equal(
    (await refusal(send(r.ctx, sendIn({ mailboxId: "mbx_maya", senderId: "mbx_maya" })))).code,
    "permission.no_grant",
  );
  // lacking the blanket comms.shared_send and with no share of this inbox: refused
  const shared = rig({ deniedPerms: ["comms.shared_send"], denied: new Set(["mbx_hello"]) });
  assert.equal((await refusal(send(shared.ctx, sendIn({ senderId: "mbx_hello" })))).code, "permission.no_grant");
  assert.equal(r.sent().length + shared.sent().length, 0);
});

test("a sender that was deleted since the list was read is not found", async () => {
  const r = rig();
  assert.equal(
    (await refusal(send(r.ctx, sendIn({ mailboxId: "mbx_gone", senderId: "mbx_gone" })))).code,
    "validation.not_found",
  );
});

test("send_as and the preview take a senderId the same way", async () => {
  const r = rig();
  const sent = await sendAs(r.ctx, {
    mailboxId: "mbx_maya",
    senderId: "mbx_maya",
    to: [{ address: "pat@acme.test" }],
    subject: "Hi",
    text: "Hello",
    idempotencyKey: "as-1",
  });
  assert.ok(sent.messageId);
  const preview = await sendPreview(r.ctx, {
    mailboxId: "mbx_maya",
    senderId: "mbx_maya",
    to: [{ address: "pat@acme.test" }],
  });
  assert.equal(preview.providerRoute, "mailbox");
  const clash = await refusal(
    sendAs(r.ctx, {
      mailboxId: "mbx_maya",
      senderId: "mbx_omar",
      to: [{ address: "pat@acme.test" }],
      subject: "Hi",
      text: "Hello",
      idempotencyKey: "as-2",
    }),
  );
  assert.equal(clash.code, "validation.bad_input");
  r.ctx.db.run(`UPDATE mail_mailbox SET state = ? WHERE id = ?`, "error", "mbx_maya");
  const down = await refusal(
    sendAs(r.ctx, {
      mailboxId: "mbx_maya",
      senderId: "mbx_maya",
      to: [{ address: "pat@acme.test" }],
      subject: "Hi",
      text: "Hello",
      idempotencyKey: "as-3",
    }),
  );
  assert.equal(down.code, "validation.bad_input", "send_as answers with its declared code; the message is the same");
  assert.match(down.message, /needs to be reconnected/);
});

/** The kernel's rules for the part these tests need: a grant on the inbox itself counts when it is use or more and has not expired; without `direct` a Member's Space role reaches every inbox under the Space. */
function kernel(
  r: ReturnType<typeof rig>,
  grants: Record<string, { level: "view" | "use" | "edit"; expired?: boolean }>,
): void {
  r.ctx.authorize = (action, resource) => {
    const ok = { effect: "allow", reason: "ok", decisionId: "dec_mailtest01" } as const;
    const no = { effect: "deny", reason: "no_grant", decisionId: "dec_mailtest01" } as const;
    if (action.perm === "comms.shared_send") return no; // the caller lacks the blanket
    if (action.direct !== true) return ok; // the Space role reaches the inbox through its parent
    const g = resource.id ? grants[resource.id] : undefined;
    return g && !g.expired && ["use", "edit"].includes(g.level) ? ok : no;
  };
}

test("a use share of one shared inbox is enough to send as it, and only as it", async () => {
  const r = rig();
  seedMailbox(r.h, "mbx_support", "support@vyre.test", { kind: "shared", provider: "inbound_only" });
  kernel(r, { mbx_hello: { level: "use" } });
  assert.equal((await send(r.ctx, sendIn({ mailboxId: "mbx_hello", senderId: "mbx_hello" }))).status, "sent");
  const other = await refusal(send(r.ctx, sendIn({ mailboxId: "mbx_support", senderId: "mbx_support" })));
  assert.equal(other.code, "permission.no_grant");
  assert.equal(r.sent().length, 1, "nothing went out as support@");
});

test("a Member with no share of the inbox, a view-only share, and an expired share are all refused, though their Space role reaches the inbox", async () => {
  for (const grants of [
    {},
    { mbx_hello: { level: "view" as const } },
    { mbx_hello: { level: "use" as const, expired: true } },
  ]) {
    const r = rig();
    kernel(r, grants);
    assert.equal(
      (await refusal(send(r.ctx, sendIn({ mailboxId: "mbx_hello", senderId: "mbx_hello" })))).code,
      "permission.no_grant",
    );
    assert.equal(r.sent().length, 0);
  }
});

test("comms.shared_send alone still sends as any shared inbox", async () => {
  const r = rig();
  seedMailbox(r.h, "mbx_support", "support@vyre.test", { kind: "shared", provider: "inbound_only" });
  assert.equal((await send(r.ctx, sendIn({ mailboxId: "mbx_support", senderId: "mbx_support" }))).status, "sent");
});

// ---- the real kernel: a fake can drift from the rules, and this is a permission boundary

const SPACE = "spc_t";
const KNOW = 1_760_000_000_000;
/** A Space with a Member who lacks comms.shared_send, a person who has it, and two shared inboxes under the Space, authorized by the kernel itself. */
function realKernel(r: ReturnType<typeof rig>, who: string) {
  const s = new AccessSnapshot();
  s.putRole({ id: "owner", clearance: 3, perms: ["comms.shared_send"], name: "owner" });
  s.putRole({ id: "member", clearance: 1, perms: [], name: "member" });
  s.putRole({ id: "mailer", clearance: 1, perms: ["comms.shared_send"], name: "mailer" });
  for (const [id, role] of [
    ["usr_plain", "member"],
    ["usr_shared", "member"],
    ["usr_mailer", "mailer"],
  ] as const) {
    s.putPrincipal({ id, kind: "person", status: "active", name: id });
    s.addPrincipalRole({ holder: id, role });
  }
  // a membership expands to a grant on the Space node at the role's level (kernel/src/grants/roles.ts): Member and Mailer hold edit there, which reaches every inbox under the Space
  for (const role of ["member", "mailer"])
    s.putGrant({
      id: `gr_role_${role}`,
      subject_kind: "role",
      subject_id: role,
      resource_type: "space",
      resource_id: SPACE,
      level: "edit",
      source: `role:${role}`,
    });
  s.putResource({ id: SPACE, type: "space", parent_id: null, label: 0, owner_id: null, holds: 0 });
  for (const id of ["mbx_hello", "mbx_support"])
    s.putResource({ id, type: "mailbox", parent_id: SPACE, label: 0, owner_id: null, holds: 0 });
  const share = (person: string, mailbox: string, level: "view" | "use" | "edit", expires?: number): void =>
    s.putGrant({
      id: `gr_${person}_${mailbox}_${level}`,
      subject_kind: "actor",
      subject_id: person,
      resource_type: "mailbox",
      resource_id: mailbox,
      level,
      ...(expires !== undefined ? { expires_at: expires } : {}),
    });
  r.ctx.authorize = (action, resource) => {
    const d = authorize(s, { principal: who, action, resource: { type: resource.type, id: resource.id }, now: KNOW });
    return { effect: d.effect, reason: String(d.reason), decisionId: "dec_mailtest01" };
  };
  return { snap: s, share };
}

test("through the real kernel: a plain Member is refused, and a use share of hello@ sends as hello@ only", async () => {
  const r = rig();
  seedMailbox(r.h, "mbx_support", "support@vyre.test", { kind: "shared", provider: "inbound_only" });
  const { snap, share } = realKernel(r, "usr_plain");
  // the premise: without `direct` this Member's Space role reaches the inbox, which is why the check must be direct
  assert.equal(
    authorize(snap, {
      principal: "usr_plain",
      action: { perm: null, level: "use" },
      resource: { type: "mailbox", id: "mbx_hello" },
      now: KNOW,
    }).effect,
    "allow",
  );
  assert.equal(
    (await refusal(send(r.ctx, sendIn({ mailboxId: "mbx_hello", senderId: "mbx_hello" })))).code,
    "permission.no_grant",
  );
  assert.equal(r.sent().length, 0, "a plain Member sent nothing");
  // a view share is not enough; a use share is, for that inbox alone
  share("usr_plain", "mbx_hello", "view");
  assert.equal(
    (await refusal(send(r.ctx, sendIn({ mailboxId: "mbx_hello", senderId: "mbx_hello" })))).code,
    "permission.no_grant",
  );
  share("usr_plain", "mbx_hello", "use");
  assert.equal((await send(r.ctx, sendIn({ mailboxId: "mbx_hello", senderId: "mbx_hello" }))).status, "sent");
  assert.equal(
    (await refusal(send(r.ctx, sendIn({ mailboxId: "mbx_support", senderId: "mbx_support" })))).code,
    "permission.no_grant",
  );
  assert.equal(r.sent().length, 1, "one message, from hello@");
});

test("through the real kernel: an expired share is refused, and comms.shared_send still sends as any shared inbox", async () => {
  const gone = rig();
  const k = realKernel(gone, "usr_shared");
  k.share("usr_shared", "mbx_hello", "use", KNOW - 1);
  assert.equal(
    (await refusal(send(gone.ctx, sendIn({ mailboxId: "mbx_hello", senderId: "mbx_hello" })))).code,
    "permission.no_grant",
  );
  const blanket = rig();
  seedMailbox(blanket.h, "mbx_support", "support@vyre.test", { kind: "shared", provider: "inbound_only" });
  realKernel(blanket, "usr_mailer");
  assert.equal((await send(blanket.ctx, sendIn({ mailboxId: "mbx_support", senderId: "mbx_support" }))).status, "sent");
  assert.equal((await send(blanket.ctx, sendIn({ mailboxId: "mbx_hello", senderId: "mbx_hello" }))).status, "sent");
});
