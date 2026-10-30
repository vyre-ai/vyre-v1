// Microsoft 365, end to end on a booted daemon: an admin pastes the app credentials into the Vault, sets up, gets the consent link and the access-policy script, checks the connection (a
// missing application permission is named), and then the members' Outlook mail reaches the Inbox, their calendar reaches Calendar, a Teams transcript reaches Meetings and a OneDrive
// change reaches a mount. An excluded member is never read, a person cannot post a forged notification, and the notification address only takes a notice whose subscription and client state
// are ours. Microsoft is a stand-in: a scripted fetch behind the module's egress and a token endpoint behind the seam that checks the client id and secret.
import test from "node:test";
import assert from "node:assert/strict";
import { bootWorld, MEMBER, OTHER, OWNER } from "../../fixtures/suite/world.ts";
import type { ProviderApi, SeamApi } from "../../fixtures/suite/world.ts";

const DOMAIN = "firm.test";
const NOAH = `noah@${DOMAIN}`;
const MIA = `mia@${DOMAIN}`;
const TENANT = "tenant-guid-1234";
const CLIENT_ID = "11111111-2222-3333-4444-555555555555";
const CLIENT_SECRET = "s3cr3t-value~abcdef";
const APP_JSON = JSON.stringify({ tenantId: TENANT, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
const ALL_ROLES = ["Mail.ReadWrite", "Mail.Send", "Calendars.ReadWrite", "Files.ReadWrite.All", "User.Read.All", "OnlineMeetingRecording.Read.All", "OnlineMeetingTranscript.Read.All"];
const GRAPH = "https://graph.microsoft.com/v1.0";

const OID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const THREAD = "19:meeting_NzAxMDAx@thread.v2";
const JOIN = `https://teams.microsoft.com/l/meetup-join/${encodeURIComponent(THREAD)}/0?context=${encodeURIComponent(JSON.stringify({ Tid: TENANT, Oid: OID }))}`;
const MID = Buffer.from(`1*${OID}*0**${THREAD}`).toString("base64");
const VTT = "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n<v Noah Berg>Thanks for joining the intake call.</v>\n\n00:00:04.500 --> 00:00:08.000\n<v Noah Berg>Let us start with the deed.</v>\n";

const fakeJwt = (roles: string[]): string => `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify({ roles })).toString("base64url")}.sig`;
const graphTime = (ms: number): { dateTime: string; timeZone: string } => ({ dateTime: new Date(ms).toISOString().replace("Z", "0000"), timeZone: "UTC" });

function microsoft() {
  let roles = ALL_ROLES.filter((r) => r !== "OnlineMeetingTranscript.Read.All");   // consent not granted for transcripts yet
  const asked: string[] = [];
  const mail: Record<string, { id: string; subject: string; from: string; at: number }[]> = { [NOAH]: [{ id: "ms-m1", subject: "Can we talk about the deed?", from: "pat@acme.test", at: Date.UTC(2026, 9, 28, 15, 0) }] };
  const START = Date.now() - 3_600_000, END = Date.now() - 1_800_000;
  const files: Record<string, { id: string; name: string }[]> = { [NOAH]: [{ id: "od-1", name: "Engagement letter.docx" }] };

  const seam: SeamApi = ({ url, body, headers }) => {
    if (url === `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`) {
      const f = new URLSearchParams(String(body));
      if (f.get("grant_type") !== "client_credentials" || f.get("client_id") !== CLIENT_ID || f.get("client_secret") !== CLIENT_SECRET || f.get("scope") !== "https://graph.microsoft.com/.default") {
        return { status: 400, json: { error: "invalid_client" } };
      }
      return { json: { access_token: fakeJwt(roles), expires_in: 3600 } };
    }
    const m = /\/users\/([^/]+)\/drive\/items\/([^/]+)\/content$/.exec(decodeURIComponent(url));
    if (m) {
      asked.push(url);
      const f = (files[m[1]!] ?? []).find((x) => x.id === m[2]);
      return f ? { text: `Contents of ${f.name}` } : undefined;
    }
    void headers;
    return undefined;
  };

  let clientState = "";
  const api: ProviderApi = ({ method, url, headers, body }) => {
    if (!/^Bearer .+\..+\..+$/.test(headers["authorization"] ?? "")) return { status: 401, json: { error: { code: "InvalidAuthenticationToken" } } };
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname).replace(/^\/v1\.0/, "");
    asked.push(path);
    if (path === "/organization") return { json: { value: [{ id: TENANT }] } };
    if (path === "/users") return { json: { value: [{ displayName: "Noah Berg", mail: NOAH, accountEnabled: true }, { displayName: "Kim Ito", mail: `kim@${DOMAIN}`, accountEnabled: true }] } };
    if (method === "POST" && path === "/subscriptions") {
      const b = JSON.parse(String(body)) as { expirationDateTime: string; clientState: string };
      clientState = b.clientState;
      return { status: 201, json: { id: "graph-sub-1", expirationDateTime: b.expirationDateTime } };
    }
    const um = /^\/users\/([^/]+)(\/.*)?$/.exec(path);
    if (!um) return undefined;
    const user = um[1]!, rest = um[2] ?? "";
    if (rest === "/mailFolders/inbox") return { json: { id: "inbox" } };
    const msgs = mail[user] ?? [];
    const delta = /^\/mailFolders\/(inbox|sentitems)\/messages\/delta$/.exec(rest);
    if (delta) {
      const resumed = u.searchParams.has("$deltatoken");
      const list = delta[1] === "inbox" ? (resumed ? msgs.slice(1) : msgs.slice(0, 1)) : [];
      return { json: { value: list.map((x) => ({ id: x.id })), "@odata.deltaLink": `${GRAPH}/users/${user}/mailFolders/${delta[1]}/messages/delta?$deltatoken=d${msgs.length}` } };
    }
    const one = /^\/messages\/([^/]+)$/.exec(rest);
    if (one) {
      const x = msgs.find((y) => y.id === one[1]);
      return x ? { json: {
        id: x.id, internetMessageId: `<${x.id}@acme.test>`, conversationId: `c-${x.id}`, subject: x.subject, from: { emailAddress: { address: x.from, name: "Pat Lee" } },
        toRecipients: [{ emailAddress: { address: user } }], ccRecipients: [], receivedDateTime: new Date(x.at).toISOString(), isDraft: false, body: { contentType: "text", content: "Hello, can we talk?" },
      } } : { status: 404, json: { error: { code: "ErrorItemNotFound" } } };
    }
    const ev = {
      id: "oev1", subject: "Intake call", isCancelled: false, start: graphTime(START), end: graphTime(END), organizer: { emailAddress: { address: user, name: "Noah Berg" } },
      attendees: [{ emailAddress: { address: user, name: "Noah Berg" }, status: { response: "accepted" }, type: "required" }, { emailAddress: { address: "pat@acme.test", name: "Pat Lee" }, status: { response: "none" }, type: "required" }],
      onlineMeeting: { joinUrl: JOIN },
    };
    if (rest === "/calendar/calendarView/delta") return user === NOAH ? { json: { value: [ev], "@odata.deltaLink": `${GRAPH}/users/${user}/calendar/calendarView/delta?$deltatoken=c1` } } : { json: { value: [], "@odata.deltaLink": `${GRAPH}/users/${user}/calendar/calendarView/delta?$deltatoken=c0` } };
    if (rest === "/calendar/calendarView") return { json: { value: user === NOAH ? [ev] : [] } };
    if (rest === `/onlineMeetings/${MID}/transcripts`) return user === NOAH ? { json: { value: [{ id: "tr1", createdDateTime: new Date(END).toISOString() }] } } : { status: 404, json: { error: { code: "NotFound" } } };
    if (rest === `/onlineMeetings/${MID}/transcripts/tr1/content`) return { text: VTT };
    if (rest === "/drive/root/delta") {
      return { json: { value: [{ id: "root", name: "root", folder: {}, parentReference: {} }, ...(files[user] ?? []).map((f) => ({ id: f.id, name: f.name, size: 20, file: {}, parentReference: { id: "root" }, lastModifiedDateTime: "2026-10-28T10:00:00Z" }))], "@odata.deltaLink": `${GRAPH}/users/${user}/drive/root/delta?token=t${(files[user] ?? []).length}` } };
    }
    return undefined;
  };
  return { api, seam, asked, mail, files, clientState: () => clientState, grantTranscripts() { roles = ALL_ROLES; }, times: { START, END } };
}

const members = [{ userId: "usr_olivia", email: `olivia@${DOMAIN}` }, { userId: "usr_noah", email: NOAH }, { userId: "usr_mia", email: MIA }];

test("Microsoft 365: setup, consent, check, then mail, calendar, Teams and OneDrive reach the product; an excluded member is never read", async () => {
  const g = microsoft();
  const w = await bootWorld({ prefix: "ms", api: g.api, seam: g.seam, members, secrets: { "#Microsoft_App": APP_JSON } });
  try {
    // 1 the credentials go to the Vault by handle; the page reads status before anything is set up
    const folder = await w.ok(OWNER, "vault.folders.create", { name: "Company connections", scope: "shared", idempotencyKey: w.idem() });
    const item = await w.ok(OWNER, "vault.item.put", { folderId: folder.folder.id, name: "Microsoft_App", kind: "other", fields: [{ key: "key", value: APP_JSON, secret: true }], idempotencyKey: w.idem() });
    assert.equal(item.item.handle, "#Microsoft_App");
    assert.equal(JSON.stringify(item).includes(CLIENT_SECRET), false, "the Vault never answers with the secret");
    const before = await w.ok(OWNER, "ms.consent.status");
    assert.deepEqual([before.configured, before.consentGiven, before.mappedMembers], [false, false, 0]);
    const nolink = await w.call(OWNER, "ms.consent.link", {});
    assert.equal(nolink.status, 422, "the consent link needs the app first");

    // 2 Mia is excluded before setup; setup connects the others
    await w.ok(OWNER, "ms.consent.set_excluded", { email: MIA, excluded: true });
    const setup = await w.ok(OWNER, "ms.consent.setup", { vaultItem: "#Microsoft_App", tenantId: TENANT, domain: DOMAIN, idempotencyKey: w.idem() });
    assert.deepEqual([setup.configured, setup.mappedMembers, setup.connected], [true, 2, 2]);
    const link = await w.ok(OWNER, "ms.consent.link", {});
    assert.equal(link.url, `https://login.microsoftonline.com/${TENANT}/adminconsent?client_id=${CLIENT_ID}`);
    assert.deepEqual([...link.permissions].sort(), [...ALL_ROLES].sort());
    const snippet = await w.ok(OWNER, "ms.consent.policy_snippet", {});
    assert.ok(snippet.snippet.includes(CLIENT_ID) && snippet.snippet.includes(NOAH) && snippet.snippet.includes("Grant-CsApplicationAccessPolicy"));
    assert.equal(snippet.snippet.includes(MIA), false, "the script limits the app to the members you include, never the excluded one");

    // 3 the check names the application permission the tenant admin has not consented to; after consent it passes
    const missing = await w.ok(OWNER, "ms.consent.verify", {});
    assert.equal(missing.ok, false);
    assert.deepEqual(missing.missingPermissions, ["OnlineMeetingTranscript.Read.All"]);
    g.grantTranscripts();
    const fixed = await w.ok(OWNER, "ms.consent.verify", { policyConfirmed: true });
    assert.deepEqual([fixed.ok, fixed.missingPermissions], [true, []]);
    const status = await w.ok(OWNER, "ms.consent.status");
    assert.deepEqual([status.configured, status.consentGiven, status.policyConfirmed, status.mappedMembers, status.excluded], [true, true, true, 2, [MIA]]);

    // 4 mail
    const boxes = await w.ok(MEMBER, "mail.mailbox.list", {});
    const mine = boxes.mailboxes.filter((b: { address: string }) => b.address === NOAH);
    assert.equal(mine.length, 1);
    assert.equal(boxes.mailboxes.some((b: { address: string }) => b.address === MIA), false, "Mia has none");
    await w.ok(MEMBER, "mail.sync_now", { mailboxId: mine[0].id });
    const list = await w.ok(MEMBER, "mail.message.list", { mailboxId: mine[0].id });
    assert.deepEqual(list.messages.map((m: { subject: string }) => m.subject), ["Can we talk about the deed?"]);
    const threads = await w.ok(MEMBER, "inbox.list_by_thread", {});
    assert.ok(JSON.stringify(threads).includes("Can we talk about the deed?"), "the message is in the Inbox thread list");

    // 5 calendar
    const cals = await w.ok(MEMBER, "calendar.list_calendars", {});
    const mcal = cals.calendars.find((c: { provider: string }) => c.provider === "microsoft");
    assert.ok(mcal, "Noah's Outlook calendar is in Calendar");
    assert.equal(mcal.ownerId, "usr_noah");
    const seen = await w.ok(MEMBER, "calendar.list_events", { from: Date.now() - 86_400_000, to: Date.now() + 86_400_000, calendarIds: [mcal.id] });
    assert.deepEqual(seen.events.map((e: { title: string }) => e.title), ["Intake call"]);
    const other = await w.ok(OTHER, "calendar.list_calendars", {});
    assert.equal(other.calendars.some((c: { id: string }) => c.id === mcal.id), false, "another member does not see Noah's calendar");

    // 6 Teams: the transcript, read as the organizer, lands in the Meeting the calendar event made
    const meetings = await w.ok(MEMBER, "meetings.list", {});
    assert.equal(meetings.meetings.length, 1, JSON.stringify(meetings));
    const transcript = await w.ok(MEMBER, "meetings.transcript.get", { meetingId: meetings.meetings[0].id });
    assert.deepEqual(transcript.segments.map((s: { speaker?: string; text: string }) => [s.speaker, s.text]), [["Noah Berg", "Thanks for joining the intake call."], ["Noah Berg", "Let us start with the deed."]]);

    // 7 OneDrive: Noah mounts his drive in Files; the file arrives, and a later change reaches it on sync
    const tree = await w.ok(MEMBER, "files.tree", {});
    const into = tree.roots.find((r: { key: string; folderId?: string }) => r.key === "shared_knowledge" || r.key === "knowledge")?.folderId ?? tree.roots.find((r: { folderId?: string }) => r.folderId)?.folderId;
    const added = await w.ok(MEMBER, "mounts.add", { into, source: { kind: "onedrive", connectionId: mcal.connectionId }, name: "My OneDrive", idempotencyKey: w.idem() });
    const listed = await w.ok(MEMBER, "files.list", { section: "space", folder: added.folderId });
    assert.deepEqual(listed.files.map((f: { name: string }) => f.name), ["Engagement letter.docx"], JSON.stringify(listed));
    g.files[NOAH]!.push({ id: "od-2", name: "Closing statement.docx" });
    await w.ok(MEMBER, "mounts.sync_now", { mountId: added.mountId, idempotencyKey: w.idem() });
    const after = await w.ok(MEMBER, "files.list", { section: "space", folder: added.folderId });
    assert.deepEqual(after.files.map((f: { name: string }) => f.name).sort(), ["Closing statement.docx", "Engagement letter.docx"]);

    // 8 the notification address: nobody can post a notice themselves; Graph's handshake is answered; a forged or foreign notice is refused
    const connectionId = mcal.connectionId as string;
    const forged = await w.call(MEMBER, "ms.receive_notification", { notificationId: "forged-1", subscriptionId: "poll", resource: `users/${NOAH}/messages`, changeType: "created", clientStateOk: true });
    assert.equal(forged.status, 403, forged.text);
    assert.equal((await w.call(OWNER, "ms.receive_notification", { notificationId: "forged-2", subscriptionId: "poll", resource: `users/${NOAH}/messages`, changeType: "created", clientStateOk: true })).status, 403, "not even the owner can record a notice");
    const hook = (query: string, body: unknown) => fetch(`${w.d.url}/hooks/microsoft${query}`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json" } });
    const handshake = await hook("?validationToken=Validation%3A+abc123", "");
    assert.equal(handshake.status, 200);
    assert.equal(handshake.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.equal(await handshake.text(), "Validation: abc123");
    assert.equal((await hook("", { value: [{ subscriptionId: "sub-not-ours", clientState: "x", changeType: "created", resource: `users/${NOAH}/messages/1` }] })).status, 401, "a subscription we never made");
    const sub = await w.ok(MEMBER, "ms.mail.subscribe", { connectionId, folderId: "inbox", notificationUrl: "https://space.firm.test/hooks/microsoft", idempotencyKey: w.idem() });
    assert.equal((await hook("", { value: [{ subscriptionId: sub.subscriptionId, clientState: "wrong", changeType: "created", resource: `users/${NOAH}/messages/1` }] })).status, 401, "the right subscription with a wrong client state");

    g.mail[NOAH]!.push({ id: "ms-m2", subject: "Signed deed attached", from: "pat@acme.test", at: Date.UTC(2026, 9, 29, 9, 0) });
    const taken = await hook("", { value: [{ subscriptionId: sub.subscriptionId, clientState: g.clientState(), changeType: "created", resource: `users/${NOAH}/messages/ms-m2`, resourceData: { id: "ms-m2" }, tenantId: TENANT }] });
    assert.equal(taken.status, 200, await taken.text());
    const afterNotice = await w.ok(MEMBER, "mail.message.list", { mailboxId: mine[0].id });
    assert.deepEqual(afterNotice.messages.map((m: { subject: string }) => m.subject).sort(), ["Can we talk about the deed?", "Signed deed attached"]);

    // 9 who may act as whom
    assert.equal((await w.call(MEMBER, "ms.consent.set_excluded", { email: NOAH, excluded: true })).status, 403, "a member cannot change who is excluded");
    assert.equal((await w.call(MEMBER, "ms.consent.setup", { vaultItem: "#Microsoft_App", tenantId: TENANT, idempotencyKey: w.idem() })).status, 403, "a member cannot set the connection up");
    assert.equal((await w.call(OWNER, "ms.mail.list_folders", { connectionId, as: MIA })).status, 403, "not even the owner can act as an excluded member");

    // 9b the directory: only an admin lists it, imports and matches
    assert.equal((await w.call(MEMBER, "ms.directory.list", {})).status, 403, "a member cannot list the directory");
    const dir = await w.ok(OWNER, "ms.directory.list", {});
    assert.deepEqual(dir.people.map((p: { email: string; userId?: string }) => [p.email, p.userId]), [[NOAH, "usr_noah"], [`kim@${DOMAIN}`, undefined]]);
    const imported = await w.ok(OWNER, "ms.directory.import", { people: [{ email: `kim@${DOMAIN}`, role: "rol_member" }, { email: NOAH, role: "rol_member" }], idempotencyKey: w.idem() });
    assert.deepEqual([imported.invited.map((i: { email: string }) => i.email), imported.skipped.map((i: { email: string }) => i.email)], [[`kim@${DOMAIN}`], [NOAH]]);
    assert.equal((await w.call(MEMBER, "ms.consent.map_member", { email: `kim@${DOMAIN}`, userId: "usr_noah", idempotencyKey: w.idem() })).status, 403, "a member cannot match addresses");
    const matched = await w.ok(OWNER, "ms.consent.map_member", { email: `kim@${DOMAIN}`, userId: "usr_adam", idempotencyKey: w.idem() });
    assert.deepEqual([matched.mapped, matched.connected], [true, true]);

    // 10 Microsoft was never asked anything about Mia
    assert.equal(g.asked.some((p) => p.includes(MIA) || p.includes(encodeURIComponent(MIA))), false, "Mia's mailbox, calendar and drive were never read");
  } finally { await w.stop(); }
});
