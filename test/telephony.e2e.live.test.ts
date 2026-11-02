// Telephony end to end on a booted daemon with the real access rules and a scripted Twilio (owner, 2 Nov). Paste the credentials, connect, every number comes in unassigned, an admin assigns them, and from there a number is private to the people on it.
// A text from a known contact also joins that contact's history, for whoever can open the record. Signatures are checked for real: the fake signs what Twilio would.
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { KEY, boot, call, connect, seededDir } from "./memory-live-kit.ts";

const AUTH = KEY;   // the kit's Vault answers this for every handle
const NOAH = "tok-usr_noah", SANA = "tok-usr_sana";
const LINE = "+14155550777", OTHER = "+14155550778", CLIENT = "+14155550111", STRANGER = "+14155550999";

function sign(url: string, params: Record<string, string>): string {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return createHmac("sha1", AUTH).update(data).digest("base64");
}

async function world() {
  const twilio = { configured: [] as string[], sent: [] as string[], accountOk: true };
  const fetchImpl = ((url: string, init?: { method?: string; body?: unknown }) => {
    const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 300, status, headers: { get: () => null }, text: () => Promise.resolve(JSON.stringify(body)) });
    if (/\/IncomingPhoneNumbers\.json/.test(url)) return json({ incoming_phone_numbers: [{ sid: "PN" + "1".repeat(32), phone_number: LINE, friendly_name: "Main", capabilities: { voice: true, sms: true, mms: false } }, { sid: "PN" + "2".repeat(32), phone_number: OTHER, friendly_name: "", capabilities: { voice: true, sms: true, mms: false } }], next_page_uri: null });
    if (/\/IncomingPhoneNumbers\/PN/.test(url)) { twilio.configured.push(url); return json({ sid: "PN" + "1".repeat(32), phone_number: LINE, capabilities: { voice: true, sms: true, mms: false } }); }
    if (/\/Messages\.json/.test(url)) { twilio.sent.push(String(init?.body ?? "")); return json({ sid: "SM" + "9".repeat(32), status: "sent" }); }
    if (/\/Calls\.json/.test(url)) return json({ sid: "CA" + "1".repeat(32), status: "queued" });
    if (/\/Applications/.test(url)) return json({ applications: [], sid: "AP" + "1".repeat(32) });
    if (/\/Accounts\/[^/]+\.json/.test(url)) return twilio.accountOk ? json({ status: "active" }) : json({ message: "Authenticate" }, 401);
    return json({ apps: { http: {} } });
  }) as never;
  const d = await boot(seededDir(), undefined, fetchImpl, {
    session: (h: Record<string, unknown>) => {
      const token = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
      const person = token === NOAH ? "usr_noah" : token === SANA ? "usr_sana" : "usr_olivia";
      return { space: "spc_core", principal: { kind: "person", id: person }, device: person };
    },
  } as never);
  const as = async (token: string, cap: string, input: unknown): Promise<{ status: number; data: any }> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(input) });
    const body = (await r.json()) as { data?: unknown };
    return { status: r.status, data: body.data ?? body };
  };
  await connect(d);
  const folderId = (await call(d, "vault.folders.list", { scope: "mine" })).data.folders[0].id as string;
  await call(d, "vault.item.put", { folderId, name: "Twilio_Account", kind: "login", fields: [{ key: "value", value: "AC" + "0".repeat(32), secret: true }], idempotencyKey: "e2e-a" });
  await call(d, "vault.item.put", { folderId, name: "Twilio_Auth", kind: "login", fields: [{ key: "value", value: AUTH, secret: true }], idempotencyKey: "e2e-b" });
  /** A text as Twilio delivers it, signed for the address it called. */
  const inbound = async (from: string, body: string, sid: string, tamper = false): Promise<number> => {
    const params = { MessageSid: sid, From: from, To: LINE, Body: body, NumMedia: "0" };
    const url = `${d.url}/hooks/twilio/sms`;
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": tamper ? "nonsense" : sign(url, params) }, body: new URLSearchParams(params).toString() });
    await d.hooks?.pump?.();
    return r.status;
  };
  return { d, twilio, as, inbound };
}

test("connect refuses bad credentials in plain words, then brings in every number unassigned with webhooks set", async () => {
  const w = await world();
  try {
    w.twilio.accountOk = false;
    const no = await call(w.d, "telephony.connect", { idempotencyKey: "e2e-no" });
    assert.equal(no.status, 200, JSON.stringify(no.data));
    assert.equal(no.data.connected, false);
    assert.match(no.data.detail, /did not accept/);
    w.twilio.accountOk = true;
    const yes = await call(w.d, "telephony.connect", { idempotencyKey: "e2e-yes" });
    assert.deepEqual([yes.data.connected, yes.data.total, yes.data.notSetUp], [true, 2, 0], JSON.stringify(yes.data));
    assert.equal(w.twilio.configured.length, 2, "no per-number setup");
    assert.ok(yes.data.numbers.every((n: { assignees: unknown[] }) => n.assignees.length === 0));
  } finally { await w.d.stop(); }
});

test("a number is private to the people on it, under the real access rules", async () => {
  const w = await world();
  try {
    const numbers = (await call(w.d, "telephony.connect", { idempotencyKey: "e2e-c" })).data.numbers as Array<{ id: string; e164: string }>;
    const line = numbers.find((n) => n.e164 === LINE)!.id;
    assert.equal((await w.as(NOAH, "telephony.number.list", {})).data.total, 0, "a member sees no unassigned number");
    assert.equal((await call(w.d, "telephony.number.list", {})).data.total, 2, "the owner runs them");
    assert.equal((await call(w.d, "telephony.number.set_assignees", { numberId: line, assignees: [{ kind: "person", id: "usr_noah" }], idempotencyKey: "e2e-set" })).status, 200);
    assert.equal((await w.as(NOAH, "telephony.number.mine", {})).data.numbers.length, 1);
    assert.equal((await w.as(SANA, "telephony.number.mine", {})).data.numbers.length, 0);

    assert.equal(await w.inbound(STRANGER, "Is this the office?", "SM" + "a".repeat(32), true), 401, "a bad signature is refused");
    assert.equal(await w.inbound(STRANGER, "Is this the office?", "SM" + "a".repeat(32)), 200);
    const unmatched = async (token: string): Promise<number> => (await w.as(token, "inbox.unmatched", {})).data.rows.length;
    assert.equal(await unmatched(NOAH), 1, "the person on the line sees it");
    assert.equal(await unmatched(SANA), 0, "someone else does not");
    assert.equal((await w.as(NOAH, "telephony.sms.list", {})).data.total, 1);
    assert.equal((await w.as(SANA, "telephony.sms.list", {})).data.total, 0);
    const conv = (await w.as(NOAH, "inbox.unmatched", {})).data.rows[0].id as string;
    assert.equal((await w.as(SANA, "inbox.thread", { conversationId: conv })).status, 404, "nor by id");

    const sana = await w.as(SANA, "telephony.send_sms", { numberId: line, to: STRANGER, body: "Hi", idempotencyKey: "e2e-sana" });
    assert.equal(sana.status, 403, JSON.stringify(sana.data));
    assert.equal(w.twilio.sent.length, 0, "nothing reached Twilio");

    assert.equal((await call(w.d, "telephony.number.set_assignees", { numberId: line, assignees: [{ kind: "person", id: "usr_sana" }], idempotencyKey: "e2e-swap" })).status, 200);
    assert.equal((await w.as(NOAH, "telephony.sms.list", {})).data.total, 0, "taking someone off cuts them off at once");
    assert.equal(await unmatched(NOAH), 0);
    assert.equal(await unmatched(SANA), 1);
  } finally { await w.d.stop(); }
});

test("a text from a known contact is in the assignee's Inbox and on the contact's history for anyone who can open the record", async () => {
  const w = await world();
  try {
    const numbers = (await call(w.d, "telephony.connect", { idempotencyKey: "e2e-h" })).data.numbers as Array<{ id: string; e164: string }>;
    await call(w.d, "telephony.number.set_assignees", { numberId: numbers.find((n) => n.e164 === LINE)!.id, assignees: [{ kind: "person", id: "usr_noah" }], idempotencyKey: "e2e-h2" });
    const made = await call(w.d, "records.create", { type: "contact", fields: { name: "Lee Pat", phone: CLIENT }, idempotencyKey: "e2e-rec" });
    assert.equal(made.status, 200, JSON.stringify(made.data));
    const contactId = made.data.record.id as string;
    assert.equal(await w.inbound(CLIENT, "On my way", "SM" + "b".repeat(32)), 200);
    // a text is in no search result, for anyone: search has no source for a line, so no one can read one by searching
    for (const token of [NOAH, SANA]) {
      const found = await w.as(token, "search.query", { q: "way" });
      assert.equal(found.status, 200, JSON.stringify(found.data));
      assert.deepEqual((found.data.hits as Array<{ title?: string }>).filter((h) => JSON.stringify(h).includes("On my way")), []);
    }
    const inbox = (await w.as(NOAH, "inbox.list_by_contact", {})).data.rows as Array<{ contactId?: string }>;
    assert.ok(inbox.some((r) => r.contactId === contactId), "the assignee's Inbox");
    const sana = (await w.as(SANA, "inbox.list_by_contact", {})).data.rows as Array<{ contactId?: string }>;
    assert.ok(!sana.some((r) => r.contactId === contactId), "not someone else's Inbox");
    const history = await w.as(SANA, "inbox.thread", { contactId });
    assert.equal(history.status, 200, JSON.stringify(history.data));
    assert.ok(history.data.items.some((i: { preview?: string }) => i.preview === "On my way"), "the contact's Conversation tab, with access to the record");
  } finally { await w.d.stop(); }
});
