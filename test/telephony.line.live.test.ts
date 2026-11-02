// Calls follow the access rules for their number, here with the real rules on a booted daemon: the owner keeps the Calls view. The module's tests fake the answer, so a wrong one would blank the view for everyone and pass there.
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, connect, seededDir } from "./memory-live-kit.ts";

const NOAH = "tok-usr_noah";
const CALL_SID = "CA" + "1".repeat(32);

test("the owner sees a call on a number under the real access rules, and so does a member, who holds view on every number today", async () => {
  const twilio = ((url: string) => {
    const json = (body: unknown) => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve(JSON.stringify(body)) });
    if (/IncomingPhoneNumbers\.json/.test(url)) return json({ incoming_phone_numbers: [{ sid: "PN0001", phone_number: "+14155550777", friendly_name: "Main", capabilities: { voice: true, sms: true, mms: false } }], next_page_uri: null });
    if (/\/Calls\.json/.test(url)) return json({ sid: CALL_SID, status: "queued" });
    return json({ apps: { http: {} } });
  }) as never;
  const d = await boot(seededDir(), undefined, twilio, {
    session: (h: Record<string, unknown>) => {
      const token = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
      return token === NOAH ? { space: "spc_core", principal: { kind: "person", id: "usr_noah" }, device: "noah" } : { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "olivia" };
    },
  } as never);
  const asNoah = async (cap: string, input: unknown): Promise<{ status: number; data: any }> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${NOAH}` }, body: JSON.stringify(input) });
    const body = (await r.json()) as { data?: unknown };
    return { status: r.status, data: body.data ?? body };
  };
  try {
    await connect(d);
    const folderId = (await call(d, "vault.folders.list", { scope: "mine" })).data.folders[0].id as string;
    await call(d, "vault.item.put", { folderId, name: "Twilio_Account", kind: "login", fields: [{ key: "value", value: "AC" + "0".repeat(32), secret: true }], idempotencyKey: "line-a" });
    await call(d, "vault.item.put", { folderId, name: "Twilio_Auth", kind: "login", fields: [{ key: "value", value: "auth-token-xyz", secret: true }], idempotencyKey: "line-b" });
    const imported = await call(d, "telephony.number.import", { idempotencyKey: "line-import" });
    assert.equal(imported.status, 200, JSON.stringify(imported.data));
    const numberId = imported.data.numbers[0].id as string;
    const placed = await call(d, "telephony.dial", { numberId, to: "+14155550111", idempotencyKey: "line-dial" });
    assert.equal(placed.status, 200, JSON.stringify(placed.data));
    const callId = placed.data.callId as string;

    const seen = await call(d, "telephony.call.list", {});
    assert.equal(seen.status, 200, JSON.stringify(seen.data));
    assert.equal(seen.data.total, 1, "the owner keeps the Calls view");
    assert.equal((await call(d, "telephony.call.get", { callId })).status, 200);

    // today's access rules give every member view on every number, assigned or not, so the rule only bites where they deny. A private line is an owner decision; this pins the behaviour so a change shows up here.
    await call(d, "telephony.number.assign", { numberId, assigneeKind: "person", assigneeId: "usr_olivia", idempotencyKey: "line-assign" });
    assert.equal((await asNoah("telephony.call.list", {})).data.total, 1);
  } finally { await d.stop(); }
});
