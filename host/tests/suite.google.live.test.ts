// Google Workspace, end to end on a booted daemon: an admin pastes the service-account key into the Vault, sets up delegation, checks the connection (a missing scope is named), and then
// the members' Gmail reaches the Inbox, their Calendar reaches Calendar, a Meet transcript reaches Meetings and a Drive change reaches a mount. An excluded member is never read, a person
// cannot post a forged push, and the push address only takes Google's secret. Google is a stand-in: a scripted fetch behind the module's egress and a token endpoint behind the seam, which
// checks the RS256 signature of every delegated sign-in against the service account's public key.
import test from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, createSign, createVerify, generateKeyPairSync } from "node:crypto";
import { bootWorld, MEMBER, OTHER, OWNER } from "../../fixtures/suite/world.ts";
import type { Answer, ProviderApi, SeamApi } from "../../fixtures/suite/world.ts";

const DOMAIN = "firm.test";
const ADMIN = `olivia@${DOMAIN}`;
const NOAH = `noah@${DOMAIN}`;
const MIA = `mia@${DOMAIN}`;
const SANA = `sana@${DOMAIN}`;
const CLIENT_EMAIL = "vyre@firm-prod.iam.gserviceaccount.com";
const SCOPE = "https://www.googleapis.com/auth/";
const b64url = (s: string | Buffer): string => Buffer.from(s).toString("base64url");

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KEY_JSON = JSON.stringify({
  type: "service_account", project_id: "firm-prod", client_id: "104857384729183746501", client_email: CLIENT_EMAIL,
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
});
const verifier = createPublicKey(publicKey.export({ type: "spki", format: "pem" }));

/** The Google stand-in: what each member has, what the key may delegate, and every call it saw by member. */
function google() {
  const refused = new Set<string>();   // scopes the Admin console has not delegated yet
  const asked: { sub: string; scope: string; url: string }[] = [];
  const mail: Record<string, { id: string; subject: string; from: string; at: number }[]> = {
    [NOAH]: [{ id: "g-m1", subject: "Can we talk about the deed?", from: "Pat Lee <pat@acme.test>", at: Date.UTC(2026, 9, 28, 15, 0) }],
    [SANA]: [{ id: "g-s1", subject: "Sana only: payroll question", from: "Lee <lee@acme.test>", at: Date.UTC(2026, 9, 28, 16, 0) }],
  };
  const events: Record<string, Record<string, unknown>[]> = {};
  const files: Record<string, { id: string; name: string; mimeType: string; modifiedTime: string; parents: string[] }[]> = {};
  const START = Date.now() - 3_600_000, END = Date.now() - 1_800_000;
  const conferences: Record<string, unknown>[] = [];

  const claims = (headers: Record<string, string>): { sub: string; scope: string } | null => {
    const m = /^Bearer at\|([^|]+)\|(.+)$/.exec(headers["authorization"] ?? "");
    return m ? { sub: m[1]!, scope: m[2]! } : null;
  };

  const seam: SeamApi = ({ url, body, headers }) => {
    if (url.startsWith("https://www.googleapis.com/drive/v3/files/") && url.includes("alt=media")) {
      const who = claims(headers);
      const f = (files[who?.sub ?? ""] ?? []).find((x) => url.includes(`/files/${x.id}?`));
      return f ? { text: `Contents of ${f.name}` } : undefined;
    }
    if (url !== "https://oauth2.googleapis.com/token") return undefined;
    const form = new URLSearchParams(String(body));
    const [h, p, sig] = (form.get("assertion") ?? "").split(".");
    if (form.get("grant_type") !== "urn:ietf:params:oauth:grant-type:jwt-bearer" || !h || !p || !sig) return { status: 400, json: { error: "invalid_request" } };
    const ok = createVerify("RSA-SHA256").update(`${h}.${p}`).verify(verifier, Buffer.from(sig, "base64url"));
    if (!ok) return { status: 400, json: { error: "invalid_grant", error_description: "Invalid JWT Signature." } };
    const c = JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as { iss: string; sub: string; scope: string; aud: string };
    if (c.iss !== CLIENT_EMAIL || c.aud !== "https://oauth2.googleapis.com/token") return { status: 400, json: { error: "invalid_grant" } };
    if (!c.sub.endsWith(`@${DOMAIN}`)) return { status: 400, json: { error: "invalid_grant", error_description: "Invalid email or User ID" } };
    for (const s of c.scope.split(" ")) {
      if (refused.has(s)) return { status: 400, json: { error: "unauthorized_client", error_description: "Client is unauthorized to retrieve access tokens using this method, or client not authorized for any of the scopes requested." } };
    }
    return { json: { access_token: `at|${c.sub}|${c.scope.split(" ")[0]!.slice(SCOPE.length)}`, expires_in: 3600 } };
  };

  const api: ProviderApi = ({ method, url, headers }) => {
    const who = claims(headers);
    if (!who) return { status: 401, json: { error: { code: 401, errors: [{ reason: "authError" }] } } };
    asked.push({ sub: who.sub, scope: who.scope, url });
    const u = new URL(url);
    const msgs = mail[who.sub] ?? [];
    if (u.hostname === "gmail.googleapis.com") {
      if (u.pathname.endsWith("/profile")) return { json: { emailAddress: who.sub, historyId: "500" } };
      if (u.pathname.endsWith("/messages")) return { json: { messages: msgs.map((m) => ({ id: m.id, threadId: `t-${m.id}` })) } };
      const m = /\/messages\/([^/]+)$/.exec(u.pathname);
      const msg = m && msgs.find((x) => x.id === m[1]);
      if (msg) {
        return { json: {
          id: msg.id, threadId: `t-${msg.id}`, labelIds: ["INBOX", "UNREAD"], historyId: "400", internalDate: String(msg.at), snippet: msg.subject,
          payload: { mimeType: "text/plain", headers: [{ name: "From", value: msg.from }, { name: "To", value: who.sub }, { name: "Subject", value: msg.subject }, { name: "Message-ID", value: `<${msg.id}@acme.test>` }], body: { data: b64url("Hello, can we talk?") } },
        } };
      }
      if (u.pathname.endsWith("/history")) return { json: { history: msgs.slice(1).map((m) => ({ id: "h", messagesAdded: [{ message: { id: m.id, labelIds: ["INBOX"] } }] })), historyId: "600" } };
      return undefined;
    }
    if (u.hostname === "www.googleapis.com" && u.pathname.includes("/calendar/v3/calendars/")) return { json: { items: events[who.sub] ?? [], nextSyncToken: "sync-1" } };
    if (u.hostname === "www.googleapis.com" && u.pathname.endsWith("/drive/v3/files")) {
      const parent = /'([^']+)' in parents/.exec(u.searchParams.get("q") ?? "")?.[1];
      return { json: { files: (files[who.sub] ?? []).filter((f) => !parent || f.parents.includes(parent)) } };
    }
    if (u.hostname === "meet.googleapis.com") {
      if (u.pathname === "/v2/conferenceRecords") return { json: { conferenceRecords: who.sub === NOAH ? conferences : [] } };
      if (u.pathname === "/v2/spaces/s1") return { json: { name: "spaces/s1", meetingUri: "https://meet.google.com/abc-defg-hij" } };
      if (u.pathname.endsWith("/transcripts")) return { json: { transcripts: [{ name: "conferenceRecords/c1/transcripts/t1", state: "ENDED" }] } };
      if (u.pathname.endsWith("/participants")) return { json: { participants: [{ name: "conferenceRecords/c1/participants/p1", signedinUser: { displayName: "Noah Park" } }] } };
      if (u.pathname.endsWith("/entries")) {
        return { json: { transcriptEntries: [
          { text: "Thanks for joining the intake call.", participant: "conferenceRecords/c1/participants/p1", startTime: new Date(START + 2000).toISOString() },
          { text: "Let us start with the deed.", participant: "conferenceRecords/c1/participants/p1", startTime: new Date(START + 9000).toISOString() },
        ] } };
      }
    }
    return undefined;
  };

  return {
    api, seam, refused, asked, mail, events, files,
    conference() { conferences.push({ name: "conferenceRecords/c1", startTime: new Date(START).toISOString(), endTime: new Date(END).toISOString(), space: "spaces/s1" }); },
    times: { START, END },
  };
}

// the owner has no invitation email on record: setup maps the admin to the address it is given
const members = [{ userId: "usr_noah", email: NOAH }, { userId: "usr_mia", email: MIA }, { userId: "usr_sana", email: SANA }];

test("Google Workspace: setup, check, then mail, calendar, Meet and Drive reach the product; an excluded member is never read", async () => {
  const g = google();
  g.refused.add(`${SCOPE}drive`);   // the Admin console has not delegated Drive yet
  // the same call is on Noah's calendar and in Meet: Meetings merges them on the Meet link
  g.events[NOAH] = [{
    id: "ev1", status: "confirmed", summary: "Intake call", hangoutLink: "https://meet.google.com/abc-defg-hij", start: { dateTime: new Date(g.times.START).toISOString() }, end: { dateTime: new Date(g.times.END).toISOString() },
    attendees: [{ email: NOAH, responseStatus: "accepted" }, { email: "pat@acme.test", responseStatus: "needsAction" }],
  }];
  g.files[NOAH] = [{ id: "d-file1", name: "Engagement letter.pdf", mimeType: "application/pdf", modifiedTime: "2026-10-28T10:00:00Z", parents: ["root-folder"] }];
  g.conference();
  const w = await bootWorld({
    prefix: "google", api: g.api, seam: g.seam, members, secrets: { "#Google_DWD": KEY_JSON },
    sign: (data) => createSign("RSA-SHA256").update(data).sign(privateKey, "base64url"),
  });
  try {
    // 1 the key goes to the Vault by handle; the admin page reads status and scopes
    const folder = await w.ok(OWNER, "vault.folders.create", { name: "Company connections", scope: "shared", idempotencyKey: w.idem() });
    const item = await w.ok(OWNER, "vault.item.put", { folderId: folder.folder.id, name: "Google_DWD", kind: "other", fields: [{ key: "key", value: KEY_JSON, secret: true }], idempotencyKey: w.idem() });
    assert.equal(item.item.handle, "#Google_DWD");
    assert.equal(JSON.stringify(item).includes("PRIVATE KEY"), false, "the Vault never answers with the key");
    const before = await w.ok(OWNER, "google.dwd.status");
    assert.deepEqual(before, { configured: false, autoConnect: true, mappedMembers: 0, excluded: [] });
    const scopes = await w.ok(OWNER, "google.dwd.scopes");
    assert.equal(scopes.scopes.length, 6);

    // 2 Mia is excluded before setup: she is never mapped to a connection
    await w.ok(OWNER, "google.dwd.set_excluded", { email: MIA, excluded: true });

    // 3 setup works with Gmail delegated; the check names the scope that is missing
    const setup = await w.ok(OWNER, "google.dwd.setup", { vaultItem: "#Google_DWD", adminEmail: ADMIN, idempotencyKey: w.idem() });
    assert.deepEqual([setup.configured, setup.mappedMembers, setup.connected], [true, 3, 3]);
    const missing = await w.ok(OWNER, "google.dwd.probe", {});
    assert.equal(missing.ok, false);
    assert.deepEqual(missing.scopesMissing, [`${SCOPE}drive`]);
    g.refused.clear();
    const fixed = await w.ok(OWNER, "google.dwd.probe", {});
    assert.deepEqual([fixed.ok, fixed.scopesMissing, fixed.email], [true, [], ADMIN]);
    const status = await w.ok(OWNER, "google.dwd.status");
    assert.deepEqual([status.configured, status.lastProbeOk, status.mappedMembers, status.excluded], [true, true, 3, [MIA]]);
    assert.match(status.pushToken, /^[0-9a-f]{64}$/);
    const roster = await w.ok(OWNER, "google.dwd.members", {});
    assert.deepEqual(roster.members.map((m: { email: string; mapped: boolean; excluded: boolean }) => [m.email, m.mapped, m.excluded]).sort(), [[MIA, true, true], [NOAH, true, false], [SANA, true, false], [ADMIN, true, false]].sort());

    // 4 mail: Noah's mailbox was made pending; syncing it brings the message into the Inbox
    const boxes = await w.ok(MEMBER, "mail.mailbox.list", {});
    const mine = boxes.mailboxes.filter((b: { address: string }) => b.address === NOAH);
    assert.equal(mine.length, 1, "Noah has his Google mailbox");
    assert.equal(boxes.mailboxes.some((b: { address: string }) => b.address === MIA), false, "Mia has none");
    await w.ok(MEMBER, "mail.sync_now", { mailboxId: mine[0].id });
    const list = await w.ok(MEMBER, "mail.message.list", { mailboxId: mine[0].id });
    assert.deepEqual(list.messages.map((m: { subject: string }) => m.subject), ["Can we talk about the deed?"]);
    const threads = await w.ok(MEMBER, "inbox.list_by_thread", {});
    assert.ok(JSON.stringify(threads).includes("Can we talk about the deed?"), "the message is in the Inbox thread list");

    // 4b each person sees only their own mail: Sana syncs hers, and neither Inbox shows the other's
    const sanaBoxes = (await w.ok(OTHER, "mail.mailbox.list", {})).mailboxes.filter((b: { address: string }) => b.address === SANA);
    assert.equal(sanaBoxes.length, 1, "Sana has her own mailbox");
    await w.ok(OTHER, "mail.sync_now", { mailboxId: sanaBoxes[0].id });
    const sanaThreads = JSON.stringify(await w.ok(OTHER, "inbox.list_by_thread", {}));
    assert.ok(sanaThreads.includes("Sana only: payroll question"), "Sana sees her own mail");
    assert.equal(sanaThreads.includes("Can we talk about the deed?"), false, "Sana does not see Noah's mail");
    const noahThreads = JSON.stringify(await w.ok(MEMBER, "inbox.list_by_thread", {}));
    assert.equal(noahThreads.includes("Sana only"), false, "Noah does not see Sana's mail");
    assert.equal((await w.ok(OTHER, "mail.message.list", { mailboxId: mine[0].id })).messages.length, 0, "Sana cannot list Noah's mailbox");
    assert.equal((await w.ok(MEMBER, "mail.message.list", { mailboxId: sanaBoxes[0].id })).messages.length, 0, "Noah cannot list Sana's mailbox");

    // 5 calendar: the poll chain that the sync started made Noah's Google calendar and pulled his event
    const cals = await w.ok(MEMBER, "calendar.list_calendars", {});
    const gcal = cals.calendars.find((c: { provider: string }) => c.provider === "google");
    assert.ok(gcal, "Noah's Google calendar is in Calendar");
    assert.equal(gcal.ownerId, "usr_noah");
    const seen = await w.ok(MEMBER, "calendar.list_events", { from: Date.now() - 86_400_000, to: Date.now() + 86_400_000, calendarIds: [gcal.id] });
    assert.deepEqual(seen.events.map((e: { title: string }) => e.title), ["Intake call"]);
    const mia = await w.ok(OTHER, "calendar.list_calendars", {});
    assert.equal(mia.calendars.some((c: { id: string }) => c.id === gcal.id), false, "another member does not see Noah's calendar");

    // 6 Meet: the same pass handed the conference's transcript to Meetings
    const meetings = await w.ok(MEMBER, "meetings.list", {});
    assert.equal(meetings.meetings.length, 1, JSON.stringify(meetings));
    const transcript = await w.ok(MEMBER, "meetings.transcript.get", { meetingId: meetings.meetings[0].meetingId ?? meetings.meetings[0].id });
    assert.deepEqual(transcript.segments.map((s: { speaker?: string; text: string }) => [s.speaker, s.text]), [["Noah Park", "Thanks for joining the intake call."], ["Noah Park", "Let us start with the deed."]]);

    const sanaMeetings = await w.ok(OTHER, "meetings.list", {});
    assert.equal(sanaMeetings.meetings.length, 0, "Sana does not see Noah's meeting");

    // 7 Drive: Noah mounts a Drive folder in Files; a file of the folder arrives, and a change in Drive reaches the mount
    const tree = await w.ok(MEMBER, "files.tree", {});
    const into = tree.roots.find((r: { key: string; folderId?: string }) => r.key === "shared_knowledge" || r.key === "knowledge")?.folderId ?? tree.roots.find((r: { folderId?: string }) => r.folderId)?.folderId;
    assert.ok(into, "Noah has a Files folder to mount into");
    const added = await w.ok(MEMBER, "mounts.add", { into, source: { kind: "google_drive", connectionId: gcal.connectionId, ref: "root-folder" }, name: "Firm Drive", idempotencyKey: w.idem() });
    const listed = await w.ok(MEMBER, "files.list", { section: "space", folder: added.folderId });
    assert.deepEqual(listed.files.map((f: { name: string }) => f.name), ["Engagement letter.pdf"], JSON.stringify(listed));
    g.files[NOAH]!.push({ id: "d-file2", name: "Closing statement.pdf", mimeType: "application/pdf", modifiedTime: "2026-10-29T09:00:00Z", parents: ["root-folder"] });
    await w.ok(MEMBER, "mounts.sync_now", { mountId: added.mountId, idempotencyKey: w.idem() });
    const after = await w.ok(MEMBER, "files.list", { section: "space", folder: added.folderId });
    assert.deepEqual(after.files.map((f: { name: string }) => f.name).sort(), ["Closing statement.pdf", "Engagement letter.pdf"]);

    // 8 the push address takes only Google's secret, and no one can post a push themselves
    const connectionId = gcal.connectionId as string;
    const forged = await w.call(MEMBER, "google.receive_push", { kind: "gmail", messageId: "forged-1", mailbox: NOAH });
    assert.equal(forged.status, 403, forged.text);
    const owner = await w.call(OWNER, "google.receive_push", { kind: "gmail", messageId: "forged-2", mailbox: NOAH });
    assert.equal(owner.status, 403, "not even the owner can record a push; only the server does");
    const envelope = (id: string) => JSON.stringify({ message: { messageId: id, data: Buffer.from(JSON.stringify({ emailAddress: NOAH, historyId: 900 })).toString("base64") }, subscription: "projects/p/subscriptions/s" });
    const post = (query: string, body: string) => fetch(`${w.d.url}/hooks/google/gmail${query}`, { method: "POST", body, headers: { "content-type": "application/json" } });
    assert.equal((await post("", envelope("hook-1"))).status, 401, "no secret");
    assert.equal((await post("?token=guess", envelope("hook-2"))).status, 401, "a wrong secret");
    g.mail[NOAH]!.push({ id: "g-m2", subject: "Signed deed attached", from: "Pat Lee <pat@acme.test>", at: Date.UTC(2026, 9, 29, 9, 0) });
    const taken = await post(`?token=${status.pushToken}`, envelope("hook-3"));
    assert.equal(taken.status, 200, await taken.text());
    const afterPush = await w.ok(MEMBER, "mail.message.list", { mailboxId: mine[0].id });
    assert.deepEqual(afterPush.messages.map((m: { subject: string }) => m.subject).sort(), ["Can we talk about the deed?", "Signed deed attached"]);

    // 9 who may act as whom: a member cannot read another member's account, and nobody can act as an excluded member
    const asAdmin = await w.call(MEMBER, "google.gmail.get_profile", { connectionId, as: ADMIN });
    assert.ok(asAdmin.status >= 400, "Noah cannot act as the admin");
    const asMia = await w.call(OWNER, "google.gmail.get_profile", { connectionId, as: MIA });
    assert.equal(asMia.status, 403, "not even the admin can act as an excluded member");
    assert.equal((await w.call(MEMBER, "google.dwd.set_excluded", { email: NOAH, excluded: true })).status, 403, "a member cannot change who is excluded");
    assert.equal((await w.call(MEMBER, "google.dwd.setup", { vaultItem: "#Google_DWD", adminEmail: NOAH, idempotencyKey: w.idem() })).status, 403, "a member cannot set delegation up");

    // 10 nothing was ever asked of Google as Mia
    assert.equal(g.asked.some((a) => a.sub === MIA), false, "Mia's account was never read");
    assert.ok(g.asked.some((a) => a.sub === NOAH && a.url.includes("gmail")));
  } finally { await w.stop(); }
});
