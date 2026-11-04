// Verifying the profile email and phone (lane l-chrome2a): send, confirm, a wrong code, expiry, the rate limit, the tick only after confirmation, a changed value clearing it, no phone line, audit rows without the code.
import test from "node:test";
import assert from "node:assert/strict";
import { codeOf, harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { handlers } from "../handlers/index.ts";

const sendersWith = (h: Harness, o: { email?: boolean; text?: boolean }) => h.callee("comms.senders.list", (i) => ({
  senders: [
    ...(o.email !== false && i["channel"] === "email" ? [{ id: "mbx_space", usable: true, scope: "space", provider: "resend" }] : []),
    ...(o.text !== false && i["channel"] === "text" ? [{ id: "num_1", usable: true, scope: "space", provider: "twilio" }] : []),
  ],
}));
function world(o: { email?: boolean; text?: boolean } = {}) {
  const h = harness();
  sendersWith(h, o);
  h.callee("mail.send", () => ({ status: "queued", suppressed: [] }));
  h.callee("telephony.send_sms", () => ({ status: "queued" }));
  return h;
}
const setContact = (h: Harness, v: { email?: string; phone?: string }) => handlers["settings.set"](h.as("usr_a"), { key: "profile.contact", value: v });
const start = (h: Harness, channel: "email" | "phone") => handlers["settings.contact.verify_start"](h.as("usr_a"), { channel });
const confirm = (h: Harness, channel: "email" | "phone", code: string) => handlers["settings.contact.verify_confirm"](h.as("usr_a"), { channel, code });
const status = (h: Harness) => handlers["settings.contact.status"](h.as("usr_a"), {}) as Promise<Record<string, { verified: boolean; canVerify: boolean; pending: boolean }>>;
/** the code the module sent, read from the message it handed to the sender */
const sentCode = (h: Harness): string => /code is (\d{6})/.exec(String((h.calls.filter((c) => c.cap === "mail.send" || c.cap === "telephony.send_sms").at(-1)!.input as { text?: string; body?: string }).text ?? (h.calls.at(-1)!.input as { body?: string }).body))![1]!;

test("send and confirm: the code goes by the Space's mail sender, and the tick shows only after it is confirmed", async () => {
  const h = world();
  await setContact(h, { email: "Ana@Example.com", phone: "+14155550123" });
  assert.deepEqual((await status(h))["email"], { verified: false, canVerify: true, pending: false });
  const r = await start(h, "email");
  assert.equal(r.sent, true);
  const mail = h.calls.find((c) => c.cap === "mail.send")!.input as Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.deepEqual(mail["to"], [{ address: "ana@example.com" }]);
  assert.equal(mail["route"], "space_domain");
  assert.equal(mail["mailboxId"], "mbx_space");
  assert.match(String(mail["text"]), /code is \d{6}\. It expires in 10 minutes/);
  assert.equal((await status(h))["email"]!.verified, false, "sent is not verified");
  assert.equal((await status(h))["email"]!.pending, true);
  assert.deepEqual(await confirm(h, "email", sentCode(h)), { verified: true });
  assert.deepEqual((await status(h))["email"], { verified: true, canVerify: false, pending: false });
  assert.equal((await status(h))["phone"]!.verified, false, "the phone is its own");
});

test("a wrong code is refused and counted; after five tries it is gone", async () => {
  const h = world();
  await setContact(h, { email: "ana@example.com" });
  await start(h, "email");
  const good = sentCode(h);
  const wrong = good === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++) await assert.rejects(confirm(h, "email", wrong), (e) => codeOf(e) === "auth.invalid_code");
  await assert.rejects(confirm(h, "email", good), (e) => codeOf(e) === "rate_limit.exceeded", "five wrong tries spend the code, even the right one");
  await assert.rejects(confirm(h, "email", good), (e) => codeOf(e) === "validation.precondition_failed", "and it is gone");
  assert.equal((await status(h))["email"]!.verified, false);
  assert.equal(h.events.filter((e) => e.name === "settings.contact_code_failed").length, 7);
});

test("a code expires after 10 minutes", async () => {
  const h = world();
  await setContact(h, { email: "ana@example.com" });
  await start(h, "email");
  const code = sentCode(h);
  h.advance(10 * 60_000 + 1);
  await assert.rejects(confirm(h, "email", code), (e) => codeOf(e) === "auth.expired");
  assert.equal((await status(h))["email"]!.verified, false);
  h.advance(60_000);
  await start(h, "email");
  h.advance(9 * 60_000);
  assert.deepEqual(await confirm(h, "email", sentCode(h)), { verified: true }, "a fresh code works inside its 10 minutes");
});

test("sends are limited: one every 30 seconds and three an hour", async () => {
  const h = world();
  await setContact(h, { email: "ana@example.com" });
  await start(h, "email");
  await assert.rejects(start(h, "email"), (e) => codeOf(e) === "rate_limit.exceeded");
  h.advance(31_000); await start(h, "email");
  h.advance(31_000); await start(h, "email");
  h.advance(31_000);
  await assert.rejects(start(h, "email"), (e) => codeOf(e) === "rate_limit.exceeded", "a fourth inside the hour");
  assert.equal(h.calls.filter((c) => c.cap === "mail.send").length, 3);
  h.advance(3_600_000);
  assert.equal((await start(h, "email")).sent, true, "the hour passed");
});

test("changing the value takes the tick away, and a code for the old value no longer works", async () => {
  const h = world();
  await setContact(h, { email: "ana@example.com" });
  await start(h, "email"); await confirm(h, "email", sentCode(h));
  assert.equal((await status(h))["email"]!.verified, true);
  await setContact(h, { email: "ana@example.com", phone: "+14155550123" });
  assert.equal((await status(h))["email"]!.verified, true, "an unrelated change keeps it");
  await setContact(h, { email: "ana@other.com" });
  assert.equal((await status(h))["email"]!.verified, false);
  assert.equal(h.events.some((e) => e.name === "settings.contact_unverified"), true);
  h.advance(31_000);
  await start(h, "email");
  const code = sentCode(h);
  await setContact(h, { email: "ana@third.com" });
  await assert.rejects(confirm(h, "email", code), (e) => codeOf(e) === "validation.precondition_failed");
  assert.equal((await status(h))["email"]!.verified, false);
});

test("with no phone line, Phone gives no Verify and a send is refused; the email still verifies", async () => {
  const h = world({ text: false });
  await setContact(h, { email: "ana@example.com", phone: "+14155550123" });
  assert.deepEqual((await status(h))["phone"], { verified: false, canVerify: false, pending: false });
  await assert.rejects(start(h, "phone"), (e) => codeOf(e) === "validation.precondition_failed");
  assert.equal(h.calls.some((c) => c.cap === "telephony.send_sms"), false);
  assert.equal((await status(h))["email"]!.canVerify, true);
});

test("the phone goes by the Space's telephony, and nothing is verified without a value", async () => {
  const h = world();
  await assert.rejects(start(h, "phone"), (e) => codeOf(e) === "validation.precondition_failed", "no number yet");
  await setContact(h, { phone: "+1 (415) 555-0123" });
  await start(h, "phone");
  const sms = h.calls.find((c) => c.cap === "telephony.send_sms")!.input as Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(sms["to"], "+14155550123");
  assert.equal(sms["numberId"], "num_1");
  assert.deepEqual(await confirm(h, "phone", sentCode(h)), { verified: true });
});

test("a send the provider refuses leaves no code and says so", async () => {
  const h = world();
  h.callee("mail.send", () => ({ status: "suppressed", suppressed: ["ana@example.com"] }));
  await setContact(h, { email: "ana@example.com" });
  await assert.rejects(start(h, "email"), (e) => codeOf(e) === "validation.precondition_failed");
  assert.equal((await status(h))["email"]!.pending, false);
});

test("audit rows say who, which channel and what happened, never the code or the address", async () => {
  const h = world();
  await setContact(h, { email: "ana@example.com" });
  await start(h, "email");
  const code = sentCode(h);
  await assert.rejects(confirm(h, "email", "999999").catch((e) => { throw e; }), () => true).catch(() => undefined);
  await confirm(h, "email", code).catch(() => undefined);
  const names = h.events.map((e) => e.name).filter((n) => n.startsWith("settings.contact_"));
  assert.ok(names.includes("settings.contact_code_sent"));
  const text = JSON.stringify(h.events.filter((e) => e.name.startsWith("settings.contact_")));
  assert.ok(!text.includes(code) && !text.includes("ana@example.com"), text);
});
