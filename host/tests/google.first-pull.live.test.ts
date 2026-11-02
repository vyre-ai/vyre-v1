// The first pull of a newly connected Google mailbox and the calendar pull, on a booted daemon with a scripted Google. A mailbox that already holds mail from 3 days ago and from
// 100 days ago at connect time: the first pull brings in the recent one and not the old one, the next pull brings in nothing new and duplicates nothing. The member's connected
// calendar is pulled by the server's own scheduled job (calendar.pull_provider), and no pass logs a failed calendar sync.
import test from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, createSign, createVerify, generateKeyPairSync } from "node:crypto";
import { bootWorld, MEMBER, OWNER } from "../../fixtures/suite/world.ts";
import type { ProviderApi, SeamApi } from "../../fixtures/suite/world.ts";

const DOMAIN = "firm.test";
const ADMIN = `olivia@${DOMAIN}`;
const NOAH = `noah@${DOMAIN}`;
const CLIENT_EMAIL = "vyre@firm-prod.iam.gserviceaccount.com";
const SCOPE = "https://www.googleapis.com/auth/";
const b64url = (s: string | Buffer): string => Buffer.from(s).toString("base64url");

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KEY_JSON = JSON.stringify({
  type: "service_account", project_id: "firm-prod", client_id: "104857384729183746501", client_email: CLIENT_EMAIL,
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
});
const verifier = createPublicKey(publicKey.export({ type: "spki", format: "pem" }));


const DAY = 86_400_000;
const NOW = Date.now();

function google() {
  const mail: { id: string; subject: string; at: number }[] = [
    { id: "g-recent", subject: "Recent matter", at: NOW - 3 * DAY },
    { id: "g-old", subject: "Ancient matter", at: NOW - 100 * DAY },
  ];
  const claims = (headers: Record<string, string>): { sub: string } | null => {
    const m = /^Bearer at\|([^|]+)\|(.+)$/.exec(headers["authorization"] ?? "");
    return m ? { sub: m[1]! } : null;
  };
  const seam: SeamApi = ({ url, body }) => {
    if (url !== "https://oauth2.googleapis.com/token") return undefined;
    const form = new URLSearchParams(String(body));
    const [h, p, sig] = (form.get("assertion") ?? "").split(".");
    if (!h || !p || !sig || !createVerify("RSA-SHA256").update(`${h}.${p}`).verify(verifier, Buffer.from(sig, "base64url"))) return { status: 400, json: { error: "invalid_grant" } };
    const c = JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as { sub: string; scope: string };
    return { json: { access_token: `at|${c.sub}|${c.scope.split(" ")[0]!.slice(SCOPE.length)}`, expires_in: 3600 } };
  };
  const api: ProviderApi = ({ url, headers }) => {
    const who = claims(headers);
    if (!who) return { status: 401, json: { error: { code: 401 } } };
    const u = new URL(url);
    if (u.hostname === "gmail.googleapis.com") {
      if (u.pathname.endsWith("/profile")) return { json: { emailAddress: who.sub, historyId: "500" } };
      if (u.pathname.endsWith("/messages")) {
        const days = Number(/newer_than:(\d+)d/.exec(u.searchParams.get("q") ?? "")?.[1] ?? "100000");
        return { json: { messages: who.sub === NOAH ? mail.filter((m) => m.at >= NOW - days * DAY).map((m) => ({ id: m.id, threadId: `t-${m.id}` })) : [] } };
      }
      const m = /\/messages\/([^/]+)$/.exec(u.pathname);
      const msg = m && who.sub === NOAH ? mail.find((x) => x.id === m[1]) : undefined;
      if (msg) {
        return { json: {
          id: msg.id, threadId: `t-${msg.id}`, labelIds: ["INBOX"], historyId: "400", internalDate: String(msg.at), snippet: msg.subject,
          payload: { mimeType: "text/plain", headers: [{ name: "From", value: "Pat Lee <pat@acme.test>" }, { name: "To", value: who.sub }, { name: "Subject", value: msg.subject }, { name: "Message-ID", value: `<${msg.id}@acme.test>` }], body: { data: b64url("Hello") } },
        } };
      }
      if (u.pathname.endsWith("/history")) return { json: { history: [], historyId: "600" } };
      return undefined;
    }
    if (u.hostname === "www.googleapis.com" && u.pathname.includes("/calendar/v3/calendars/")) {
      return { json: { items: [{ id: "ev1", status: "confirmed", summary: "Intake call", start: { dateTime: new Date(NOW + DAY).toISOString() }, end: { dateTime: new Date(NOW + DAY + 3_600_000).toISOString() } }], nextSyncToken: "sync-1" } };
    }
    if (u.hostname === "admin.googleapis.com") return { json: { users: [{ primaryEmail: NOAH, name: { fullName: "Noah Berg" } }] } };
    return undefined;
  };
  return { api, seam };
}

const members = [{ userId: "usr_noah", email: NOAH }];

test("a newly connected mailbox brings in its recent mail once, and its calendar is pulled by the server without a refusal", async () => {
  const g = google();
  const w = await bootWorld({
    prefix: "googlefirst", api: g.api, seam: g.seam, members, secrets: { "#Google_DWD": KEY_JSON },
    sign: (data) => createSign("RSA-SHA256").update(data).sign(privateKey, "base64url"),
  });
  try {
    const folder = await w.ok(OWNER, "vault.folders.create", { name: "Company connections", scope: "shared", idempotencyKey: w.idem() });
    await w.ok(OWNER, "access.labels.set", { resource: { type: "vault_folder", id: folder.folder.id }, label: "restricted" });
    const item = await w.ok(OWNER, "vault.item.put", { folderId: folder.folder.id, name: "Google_DWD", kind: "other", fields: [{ key: "key", value: KEY_JSON, secret: true }], idempotencyKey: w.idem() });
    await w.ok(OWNER, "access.labels.set", { resource: { type: "vault_item", id: item.item.id }, label: "restricted" });
    await w.ok(OWNER, "google.dwd.setup", { vaultItem: "#Google_DWD", adminEmail: ADMIN, idempotencyKey: w.idem() });
    const boxes = await w.ok(MEMBER, "mail.mailbox.list", {});
    const box = boxes.mailboxes.find((b: { address: string }) => b.address === NOAH);
    assert.ok(box, "Noah has his Google mailbox");
    await w.d.hooks!.runPeriodic("google.adopt_polls");
    const subjects = async (): Promise<string[]> => (await w.ok(MEMBER, "mail.message.list", { mailboxId: box.id })).messages.map((m: { subject: string }) => m.subject);
    let first: string[] = [];
    for (let i = 0; i < 100 && first.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 200));
      first = await subjects();
    }
    assert.deepEqual(first, ["Recent matter"], `the first pull brings in the recent mail and not the old: ${JSON.stringify(w.logsLike(/google pull/))}`);
    await w.ok(MEMBER, "mail.sync_now", { mailboxId: box.id });
    assert.deepEqual(await subjects(), ["Recent matter"], "a second pull ingests nothing new and duplicates nothing");

    // the server's own scheduled pull lands the member's private Google calendar; nothing logs a refused sync
    await w.d.hooks!.runPeriodic("calendar.pull_provider");
    const cals = await w.ok(MEMBER, "calendar.list_calendars", {});
    const gcal = cals.calendars.find((c: { provider: string }) => c.provider === "google");
    assert.ok(gcal, "Noah's Google calendar is in Calendar");
    const seen = await w.ok(MEMBER, "calendar.list_events", { from: NOW - DAY, to: NOW + 2 * DAY, calendarIds: [gcal.id] });
    assert.deepEqual(seen.events.map((e: { title: string }) => e.title), ["Intake call"]);
    assert.deepEqual(w.logsLike(/google calendar sync failed|calendar sync failed/), [], "no refused calendar sync");
  } finally {
    await w.stop();
  }
});
