// A person imported from the directory who accepts their invitation is matched to their own Google mailbox with no admin step: the member.joined event runs the Space's matching for that address,
// and their own mail and calendar appear. Someone whose invitation address is not a Workspace address is left unmatched. Real invitations and real acceptance on a booted daemon; Google is a stand-in.
import test from "node:test";
import assert from "node:assert/strict";
import { bootWorld, OWNER } from "../../fixtures/suite/world.ts";
import type { ProviderApi, SeamApi } from "../../fixtures/suite/world.ts";

const DOMAIN = "firm.test";
const ADMIN = `olivia@${DOMAIN}`;
const NOAH = `noah@${DOMAIN}`;
const PERSONAL = "kim.berg@elsewhere.test";
const KEY_JSON = JSON.stringify({ type: "service_account", project_id: "firm-prod", client_id: "104857384729183746501", client_email: "vyre@firm-prod.iam.gserviceaccount.com", private_key: "unused-by-the-stand-in" }); // secret-scan: fake
const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const PASSWORD = "correct horse battery staple 9";

const seam: SeamApi = ({ url, body }) => {
  if (url !== "https://oauth2.googleapis.com/token") return undefined;
  const claims = JSON.parse(Buffer.from(String(new URLSearchParams(String(body)).get("assertion")).split(".")[1] ?? "", "base64url").toString("utf8")) as { sub: string; scope: string };
  return { json: { access_token: `at|${claims.sub}|${claims.scope.split(" ")[0]!.split("/").pop()}`, expires_in: 3600 } };
};
const asked: string[] = [];
const api: ProviderApi = ({ url, headers }) => {
  const sub = /^Bearer at\|([^|]+)\|/.exec(headers["authorization"] ?? "")?.[1];
  if (!sub) return { status: 401, json: { error: { code: 401 } } };
  asked.push(sub);
  const u = new URL(url);
  if (u.hostname === "gmail.googleapis.com") {
    if (u.pathname.endsWith("/profile")) return { json: { emailAddress: sub, historyId: "500" } };
    if (u.pathname.endsWith("/messages")) return { json: { messages: [{ id: `m-${sub}`, threadId: `t-${sub}` }] } };
    if (u.pathname.includes("/messages/")) {
      return { json: { id: `m-${sub}`, threadId: `t-${sub}`, labelIds: ["INBOX"], historyId: "400", internalDate: String(Date.UTC(2026, 9, 28, 15, 0)), snippet: `For ${sub}`,
        payload: { mimeType: "text/plain", headers: [{ name: "From", value: "Pat Lee <pat@acme.test>" }, { name: "To", value: sub }, { name: "Subject", value: `For ${sub}` }, { name: "Message-ID", value: `<m-${sub}@acme.test>` }], body: { data: Buffer.from("hello").toString("base64url") } } } };
    }
    return undefined;
  }
  if (u.hostname === "www.googleapis.com" && u.pathname.includes("/calendar/v3/calendars/")) {
    return { json: { items: [{ id: `ev-${sub}`, status: "confirmed", summary: `Call for ${sub}`, start: { dateTime: new Date(Date.now() - 3_600_000).toISOString() }, end: { dateTime: new Date(Date.now() - 1_800_000).toISOString() } }], nextSyncToken: "s1" } };
  }
  return undefined;
};

test("a directory person who accepts is matched to their own mailbox and calendar; a different address stays unmatched", async () => {
  const w = await bootWorld({ prefix: "automatch", api, seam, secrets: { "#Google_DWD": KEY_JSON } });
  try {
    const folder = await w.ok(OWNER, "vault.folders.create", { name: "Company connections", scope: "shared", idempotencyKey: w.idem() });
    await w.ok(OWNER, "access.labels.set", { resource: { type: "vault_folder", id: folder.folder.id }, label: "restricted" });   // as the setup page files it: Restricted, so only Owner and Admin reach the key (host/tests/sso-secret.live.test.ts)
    const dwd = await w.ok(OWNER, "vault.item.put", { folderId: folder.folder.id, name: "Google_DWD", kind: "other", fields: [{ key: "key", value: KEY_JSON, secret: true }], idempotencyKey: w.idem() });
    await w.ok(OWNER, "access.labels.set", { resource: { type: "vault_item", id: dwd.item.id }, label: "restricted" });
    await w.ok(OWNER, "google.dwd.setup", { vaultItem: "#Google_DWD", adminEmail: ADMIN, idempotencyKey: w.idem() });
    const roles = await w.ok(OWNER, "access.roles.list", {});
    const role = roles.roles.find((r: { id: string }) => r.id === "rol_member").id;

    const join = async (email: string, username: string): Promise<{ personId: string; token: string }> => {
      const inv = await w.ok(OWNER, "members.invites.create", { role, email, idempotencyKey: w.idem() });
      const code = decodeURIComponent(new URL(inv.link).pathname.split("/").pop() ?? "");
      const r = await fetch(`${w.d.url}/v1/members/accept`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, username, password: PASSWORD, deviceName: "Mac", deviceClass: "desktop", keys: KEYS }) });
      const body = (await r.json()) as { data?: { personId: string; token: string } };
      assert.equal(r.status, 200, JSON.stringify(body));
      return { personId: body.data!.personId, token: `tok-${body.data!.personId}` };
    };
    const noah = await join(NOAH, "noah");
    const kim = await join(PERSONAL, "kim");

    // the consumer runs after the accept; wait for Noah's mailbox without any admin call in between
    let boxes: { address: string; id: string }[] = [];
    for (let i = 0; i < 50 && boxes.length === 0; i++) {
      boxes = (await w.ok(noah.token, "mail.mailbox.list", {})).mailboxes.filter((b: { address: string }) => b.address === NOAH);
      if (boxes.length === 0) await new Promise((x) => setTimeout(x, 200));
    }
    assert.equal(boxes.length, 1, "Noah has his Google mailbox right after accepting");
    await w.ok(noah.token, "mail.sync_now", { mailboxId: boxes[0]!.id });
    const list = await w.ok(noah.token, "mail.message.list", { mailboxId: boxes[0]!.id });
    assert.deepEqual(list.messages.map((m: { subject: string }) => m.subject), [`For ${NOAH}`]);
    const cals = await w.ok(noah.token, "calendar.list_calendars", {});
    assert.ok(cals.calendars.some((c: { provider: string; ownerId: string }) => c.provider === "google" && c.ownerId === noah.personId), "Noah's Google calendar is in Calendar");

    // Kim's invitation address is not a Workspace address: nothing is matched or read, and the admin still sees the Match to... line
    assert.deepEqual((await w.ok(kim.token, "mail.mailbox.list", {})).mailboxes, []);
    const roster = await w.ok(OWNER, "google.dwd.members", {});
    assert.equal(roster.members.some((m: { userId?: string; mapped: boolean }) => m.userId === kim.personId && m.mapped), false);
    assert.equal(asked.some((s) => s.includes("elsewhere")), false, "Google was never asked about Kim's address");
    assert.equal((await w.ok(OWNER, "google.dwd.members", {})).members.some((m: { email: string; userId?: string }) => m.email === NOAH && m.userId === noah.personId), true);
  } finally { await w.stop(); }
});
