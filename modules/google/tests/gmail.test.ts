// google.gmail.* and the mailbox pull, replayed from recorded Gmail responses (fixtures/gmail): history pages, the first-sync listing, an
// expired cursor, drafts and spam left out, attachments, and the error mapping every Google call shares. No socket is opened.
// The @reads lines put the recordings in the import graph, so a change to them selects this file:
// @reads /modules/google/fixtures/gmail/profile.json
// @reads /modules/google/fixtures/gmail/history-page1.json
// @reads /modules/google/fixtures/gmail/history-page2.json
// @reads /modules/google/fixtures/gmail/history-expired.json
// @reads /modules/google/fixtures/gmail/message-m1.json
// @reads /modules/google/fixtures/gmail/message-m2.json
// @reads /modules/google/fixtures/gmail/message-m3.json
// @reads /modules/google/fixtures/gmail/message-draft.json
// @reads /modules/google/fixtures/gmail/message-nosender.json
// @reads /modules/google/fixtures/gmail/attachment.json
// @reads /modules/google/fixtures/gmail/list-messages.json
import test from "node:test";
import assert from "node:assert/strict";
import {
  createDraft, getAttachment, getMessage, getProfile, getThread, listHistory, listLabels, listMessages, modifyLabels, parseAddresses, pollInterval, pullMailbox, sendMessage,
  stopWatch, trashMessage, watch,
} from "../handlers/gmail.ts";
import { act, codeOf, CONN, contractErrors, fixture, harness, NOW, seedDelegation } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAYA = "maya@vyre.test";

function ready(): Harness {
  const h = harness();
  seedDelegation(h);
  h.on("GET", `${BASE}/profile`, { body: fixture("gmail/profile.json") });
  return h;
}

function mailbox(h: Harness, historyId: string | null): void {
  h.ctx.db.run(
    `INSERT INTO google_mailbox (email, "connectionId", "historyId", "lastPolledAt", "lastActivityAt", "watchExpiresAt", "pubsubTopic", "nextPollAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    MAYA, CONN, historyId, null, null, null, null, null,
  );
}

function messages(h: Harness, names: Record<string, string>): void {
  for (const [id, file] of Object.entries(names)) h.on("GET", `${BASE}/messages/${id}?`, { body: fixture(`gmail/${file}`) });
}

const raw = (body: unknown): string => Buffer.from(String((body as { raw?: string }).raw), "base64url").toString("utf8");
const q = (url: string, key: string): string | null => new URL(url).searchParams.get(key);

// ---- the pull

test("history pages: new mail lands once, in order, with its parts; drafts and the deleted are left out; the cursor moves", async () => {
  const h = ready();
  mailbox(h, "1000");
  h.on("GET", /\/history\?/, { body: fixture("gmail/history-page1.json") });
  h.on("GET", /\/history\?.*pageToken=p2/, { body: fixture("gmail/history-page2.json") });
  messages(h, { m1: "message-m1.json", m2: "message-m2.json", m3: "message-m3.json", d1: "message-draft.json" });
  h.on("GET", `${BASE}/messages/m1/attachments/att1`, { body: fixture("gmail/attachment.json") });

  const pull = await pullMailbox(h.ctx, { connectionId: CONN, mailbox: MAYA });
  assert.deepEqual([pull.ingested, pull.deduped, pull.skipped, pull.complete, pull.bootstrapped], [3, 0, 1, true, false]);
  assert.equal(pull.historyId, "1003");
  assert.deepEqual(h.ingests.map((i) => i.providerId), ["m1", "m2", "m3"]);   // m1 appears on both pages and lands once

  const [m1, m2, m3] = h.ingests;
  assert.deepEqual(m1, {
    source: "google", envelopeTo: MAYA, providerId: "m1", rfcMessageId: "<abc123@acme.test>", threadKey: "t1", direction: "in",
    from: { address: "pat@acme.test", name: "Pat Lee" },
    to: [{ address: MAYA, name: "Vyre, Maya" }, { address: "sam@vyre.test" }], cc: [{ address: "kim@acme.test" }],
    subject: "Can we talk?", receivedAt: 1_760_000_000_000, text: "Hello Maya, ", html: "<p>Hello Maya,</p>",
    attachments: [{ name: "terms.pdf", mime: "application/pdf", size: 5, blobId: "blb_5b" }],   // huge.zip is over the size cap and stays in Gmail
    headers: { "in-reply-to": "<prev@vyre.test>", references: "<first@vyre.test> <prev@vyre.test>" },
  });
  assert.equal(m2!.rfcMessageId, "<gmail-m2@mail.gmail.com>");   // no Message-ID header: a stable one is made
  assert.equal(m3!.direction, "out");
  assert.equal(h.hits(/\/history\?/).length, 2);
  assert.equal(q(h.hits(/\/history\?/)[0]!.url, "startHistoryId"), "1000");
  assert.equal(q(h.hits(/\/history\?/)[0]!.url, "pageToken"), null);
  assert.equal(q(h.hits(/\/history\?/)[1]!.url, "pageToken"), "p2");
  assert.equal(q(h.hits(/\/history\?/)[1]!.url, "startHistoryId"), "1000");   // the second page is asked from the same position

  const state = h.rows(`SELECT * FROM google_mailbox WHERE email = ?`, MAYA)[0]!;
  assert.deepEqual([state.historyId, state.lastPolledAt, state.lastActivityAt], ["1003", NOW, NOW]);
  assert.equal(pull.nextPollMs, 2 * 60_000);
});

test("every Google call writes a read log row for the member it reached, bulk reads marked", async () => {
  const h = ready();
  mailbox(h, "1000");
  h.on("GET", /\/history\?/, { body: fixture("gmail/history-page2.json") });
  messages(h, { m1: "message-m1.json", m3: "message-m3.json", d1: "message-draft.json" });
  h.on("GET", `${BASE}/messages/m1/attachments/att1`, { body: fixture("gmail/attachment.json") });
  await pullMailbox(h.ctx, { connectionId: CONN, mailbox: MAYA });
  const log = h.rows(`SELECT subject, actor, cap, bulk FROM google_read_log`);
  assert.equal(log.length, h.requests.length);
  assert.ok(log.every((r) => r.subject === MAYA && r.actor === "usr_maya01"));
  assert.ok(log.filter((r) => r.cap === "google.gmail.list_history").every((r) => r.bulk === 1));
  assert.equal(log.filter((r) => r.cap === "google.gmail.get_profile").length, 1);
});

test("a mailbox with no cursor starts from the last 90 days, oldest first, and takes the profile position from before the listing", async () => {
  const h = ready();
  mailbox(h, null);
  h.on("GET", /\/messages\?/, { body: fixture("gmail/list-messages.json") });
  messages(h, { m1: "message-m1.json", m2: "message-m2.json" });
  h.on("GET", `${BASE}/messages/m1/attachments/att1`, { body: fixture("gmail/attachment.json") });
  const pull = await pullMailbox(h.ctx, { connectionId: CONN, mailbox: MAYA });
  assert.deepEqual([pull.bootstrapped, pull.ingested, pull.historyId], [true, 2, "1000"]);
  assert.deepEqual(h.ingests.map((i) => i.providerId), ["m1", "m2"]);   // the listing is newest first; mail lands oldest first
  assert.equal(q(h.hits(/\/messages\?/)[0]!.url, "q"), "newer_than:90d -in:spam -in:trash");
  assert.equal(h.hits(/\/history\?/).length, 0);
});

test("an expired history cursor starts over from the recent mail and the current position", async () => {
  const h = ready();
  mailbox(h, "1");
  h.on("GET", /\/history\?/, { status: 404, body: fixture("gmail/history-expired.json") });
  h.on("GET", /\/messages\?/, { body: fixture("gmail/list-messages.json") });
  messages(h, { m1: "message-m1.json", m2: "message-m2.json" });
  h.on("GET", `${BASE}/messages/m1/attachments/att1`, { body: fixture("gmail/attachment.json") });
  const pull = await pullMailbox(h.ctx, { connectionId: CONN, mailbox: MAYA });
  assert.deepEqual([pull.bootstrapped, pull.ingested, pull.historyId], [true, 2, "1000"]);
  const history = await listHistory(h.ctx, { ...act, as: MAYA, startHistoryId: "1" });
  assert.deepEqual([history.expired, history.history, history.historyId], [true, [], "1000"]);
  assert.deepEqual(contractErrors("google.gmail.list_history", "out", history), []);
});

test("when mail.ingest cannot take a message the cursor stays, so nothing is lost", async () => {
  const h = ready();
  mailbox(h, "1000");
  h.on("GET", /\/history\?/, { body: fixture("gmail/history-page2.json") });
  messages(h, { m1: "message-m1.json", m3: "message-m3.json", d1: "message-draft.json" });
  h.on("GET", `${BASE}/messages/m1/attachments/att1`, { body: fixture("gmail/attachment.json") });
  h.ingestState.fail = true;
  const pull = await pullMailbox(h.ctx, { connectionId: CONN, mailbox: MAYA });
  assert.deepEqual([pull.ingested, pull.complete], [0, false]);
  const state = h.rows(`SELECT "historyId", "lastPolledAt", "lastActivityAt" FROM google_mailbox`)[0]!;
  assert.deepEqual([state.historyId, state.lastPolledAt, state.lastActivityAt], ["1000", NOW, null]);
  h.ingestState.fail = false;
  const again = await pullMailbox(h.ctx, { connectionId: CONN, mailbox: MAYA });
  assert.deepEqual([again.ingested, again.complete, again.historyId], [2, true, "1003"]);
});

test("a message already known counts as deduped; a sender-less message and a vanished one are skipped", async () => {
  const h = ready();
  mailbox(h, "1000");
  h.on("GET", /\/history\?/, { body: { history: [{ id: "1", messagesAdded: [{ message: { id: "m2" } }, { message: { id: "ns" } }, { message: { id: "vanished" } }] }], historyId: "1001" } });
  messages(h, { m2: "message-m2.json", ns: "message-nosender.json" });
  h.ingestState.deduped.add("m2");
  const pull = await pullMailbox(h.ctx, { connectionId: CONN, mailbox: MAYA });
  assert.deepEqual([pull.ingested, pull.deduped, pull.skipped, pull.complete], [0, 1, 2, true]);
  assert.equal(h.rows(`SELECT "lastActivityAt" FROM google_mailbox`)[0]?.lastActivityAt, null);   // nothing new: the mailbox is not active
});

test("polling slows as a mailbox quiets: 2 minutes active, 15 idle, an hour dormant or watched", () => {
  const H = 3_600_000;
  assert.equal(pollInterval(NOW, NOW - 5 * 60_000, false), 2 * 60_000);
  assert.equal(pollInterval(NOW, NOW - 2 * H, false), 15 * 60_000);
  assert.equal(pollInterval(NOW, NOW - 25 * H, false), H);
  assert.equal(pollInterval(NOW, null, false), 15 * 60_000);
  assert.equal(pollInterval(NOW, NOW, true), H);
});

test("address lists split on commas outside quotes and brackets, and drop what is not an address", () => {
  assert.deepEqual(parseAddresses('"Lee, Pat" <PAT@acme.test>, kim@acme.test, <sam@acme.test>, nobody, Pat <not valid>'), [
    { address: "pat@acme.test", name: "Lee, Pat" }, { address: "kim@acme.test" }, { address: "sam@acme.test" },
  ]);
  assert.deepEqual(parseAddresses(undefined), []);
});

// ---- the calls

test("profile, labels and message listings are mapped to the contract", async () => {
  const h = ready();
  h.on("GET", `${BASE}/labels`, { body: { labels: [{ id: "INBOX", name: "INBOX", type: "system" }, { id: "Label_1", name: "Clients" }] } });
  h.on("GET", /\/messages\?/, (r) => (q(r.url, "pageToken") ? { body: { resultSizeEstimate: 0 } } : { body: { messages: [{ id: "m1", threadId: "t1" }], nextPageToken: "n2", resultSizeEstimate: 9 } }));
  const profile = await getProfile(h.ctx, { ...act });
  assert.deepEqual(profile, { emailAddress: MAYA, historyId: "1000", messagesTotal: 5 });
  const labels = await listLabels(h.ctx, act);
  assert.deepEqual(labels.labels, [{ id: "INBOX", name: "INBOX", type: "system" }, { id: "Label_1", name: "Clients" }]);
  const page = await listMessages(h.ctx, { ...act, q: "from:pat", labelIds: ["INBOX", "UNREAD"], maxResults: 5 });
  assert.deepEqual(page, { messages: [{ id: "m1", threadId: "t1" }], nextPageToken: "n2", resultSizeEstimate: 9 });
  const url = new URL(h.hits(/\/messages\?/)[0]!.url);
  assert.deepEqual([url.searchParams.get("q"), url.searchParams.getAll("labelIds"), url.searchParams.get("maxResults")], ["from:pat", ["INBOX", "UNREAD"], "5"]);
  assert.deepEqual((await listMessages(h.ctx, { ...act, pageToken: "n2" })).messages, []);
  for (const [cap, out] of [["google.gmail.get_profile", profile], ["google.gmail.list_labels", labels], ["google.gmail.list_messages", page]] as const) assert.deepEqual(contractErrors(cap, "out", out), [], cap);
});

test("one message and one thread come back with ids, labels and the structured payload", async () => {
  const h = ready();
  messages(h, { m1: "message-m1.json" });
  h.on("GET", `${BASE}/threads/t1`, { body: { id: "t1", messages: [fixture("gmail/message-m1.json"), fixture("gmail/message-m3.json")] } });
  const one = await getMessage(h.ctx, { ...act, messageId: "m1" });
  assert.deepEqual([one.message.id, one.message.threadId, one.message.labelIds, one.message.internalDate, one.message.snippet], ["m1", "t1", ["INBOX", "UNREAD"], 1_760_000_000_000, "Can we talk?"]);
  assert.equal(q(h.hits(`${BASE}/messages/m1`)[0]!.url, "format"), "full");
  const thread = await getThread(h.ctx, { ...act, threadId: "t1" });
  assert.deepEqual([thread.threadId, thread.messages.map((m) => m.id)], ["t1", ["m1", "m3"]]);
  assert.deepEqual(contractErrors("google.gmail.get_message", "out", one), []);
  assert.deepEqual(contractErrors("google.gmail.get_thread", "out", thread), []);
});

test("labels change, a message is trashed, an attachment becomes a blob", async () => {
  const h = ready();
  h.on("POST", `${BASE}/messages/m1/modify`, { body: { id: "m1", threadId: "t1", labelIds: ["STARRED"] } });
  h.on("POST", `${BASE}/messages/m1/trash`, { body: { id: "m1", threadId: "t1", labelIds: ["TRASH"] } });
  h.on("GET", `${BASE}/messages/m1/attachments/att1`, { body: fixture("gmail/attachment.json") });
  const mod = await modifyLabels(h.ctx, { ...act, messageId: "m1", add: ["STARRED"] });
  assert.deepEqual(h.hits(`${BASE}/messages/m1/modify`)[0]!.body, { addLabelIds: ["STARRED"], removeLabelIds: [] });
  assert.deepEqual(mod.message.labelIds, ["STARRED"]);
  assert.deepEqual(await trashMessage(h.ctx, { ...act, messageId: "m1" }), { trashed: true });
  const blob = await getAttachment(h.ctx, { ...act, messageId: "m1", attachmentId: "att1" });
  assert.deepEqual(blob, { blobId: "blb_5b", size: 5 });
  assert.deepEqual(contractErrors("google.gmail.get_attachment", "out", blob), []);
});

test("a draft and a send are RFC 822 with the recipients checked and the headers kept clean", async () => {
  const h = ready();
  h.on("POST", `${BASE}/drafts`, { body: { id: "dr1", message: { id: "m9" } } });
  h.on("POST", `${BASE}/messages/send`, { body: { id: "m10", threadId: "t10", labelIds: ["SENT"] } });
  const d = await createDraft(h.ctx, { ...act, to: ["pat@acme.test"], cc: ["kim@acme.test"], subject: "Hello\r\nBcc: evil@x.test", text: "Hi Pat", threadId: "t1" });
  assert.deepEqual(d, { draftId: "dr1" });
  const draftReq = h.hits(`${BASE}/drafts`)[0]!.body as { message: { raw: string; threadId: string } };
  assert.equal(draftReq.message.threadId, "t1");
  const draft = raw(draftReq.message);
  assert.match(draft, /^To: pat@acme\.test\r\nCc: kim@acme\.test\r\nSubject: Hello Bcc: evil@x\.test\r\nMIME-Version: 1\.0\r\nContent-Type: text\/plain; charset=UTF-8\r\n/);
  assert.ok(!/^Bcc:/m.test(draft));   // the injected line stayed inside the subject
  assert.match(draft, new RegExp(`\\r\\n\\r\\n${Buffer.from("Hi Pat").toString("base64")}$`));

  const sent = await sendMessage(h.ctx, { ...act, to: ["pat@acme.test"], bcc: ["boss@vyre.test"], subject: "Café menu", text: "plain", html: "<b>rich</b>", attachments: ["fil_menu"] });
  assert.deepEqual(sent, { id: "m10", threadId: "t10" });
  const mime = raw(h.hits(`${BASE}/messages/send`)[0]!.body);
  assert.match(mime, /^To: pat@acme\.test\r\nBcc: boss@vyre\.test\r\nSubject: =\?UTF-8\?B\?/);
  assert.match(mime, /Content-Type: multipart\/mixed; boundary="/);
  assert.match(mime, /Content-Type: multipart\/alternative; boundary="/);
  assert.match(mime, /Content-Disposition: attachment; filename="fil_menu\.txt"/);
  assert.ok(mime.includes(Buffer.from("file body").toString("base64")));
  assert.ok(mime.includes(Buffer.from("<b>rich</b>").toString("base64")));
  assert.deepEqual(contractErrors("google.gmail.send_message", "out", sent), []);
});

test("a send needs a valid recipient and a body", async () => {
  const h = ready();
  for (const bad of [{ to: [] }, { to: ["not an address"] }, { to: ["a@b.test"], cc: ["x y@b.test"] }, { to: ["a@b.test"], text: undefined }]) {
    await assert.rejects(
      () => sendMessage(h.ctx, { ...act, subject: "s", text: "t", ...(bad as object) } as Parameters<typeof sendMessage>[1]),
      (e) => codeOf(e) === "validation.bad_input", JSON.stringify(bad),
    );
  }
  assert.equal(h.hits(`${BASE}/messages/send`).length, 0);
});

test("watch records the topic and the expiry for the member; stop clears them", async () => {
  const h = ready();
  h.on("POST", `${BASE}/watch`, { body: { historyId: "1000", expiration: "1760604800000" } });
  h.on("POST", `${BASE}/stop`, { status: 204 });
  const w = await watch(h.ctx, { ...act, topicName: "projects/p/topics/gmail", labelIds: ["INBOX"] });
  assert.deepEqual(w, { historyId: "1000", expiration: 1_760_604_800_000 });
  assert.deepEqual(h.rows(`SELECT "pubsubTopic", "watchExpiresAt" FROM google_mailbox`), [{ pubsubTopic: "projects/p/topics/gmail", watchExpiresAt: 1_760_604_800_000 }]);
  assert.deepEqual(h.hits(`${BASE}/watch`)[0]!.body, { topicName: "projects/p/topics/gmail", labelIds: ["INBOX"] });
  assert.deepEqual(await stopWatch(h.ctx, act), { stopped: true });
  assert.deepEqual(h.rows(`SELECT "pubsubTopic", "watchExpiresAt" FROM google_mailbox`), [{ pubsubTopic: null, watchExpiresAt: null }]);
});

// ---- tokens and errors

test("a call carries a delegated token for the member and the narrowest scope; tokens are reused until close to expiry", async () => {
  const h = ready();
  await getProfile(h.ctx, act);
  await getProfile(h.ctx, act);
  assert.deepEqual(h.minted, [{ sub: MAYA, scopes: ["https://www.googleapis.com/auth/gmail.modify"] }]);
  assert.match(h.requests[0]!.headers.authorization ?? "", /^Bearer tok-maya@vyre\.test-1$/);
  assert.equal(h.requests[1]!.headers.authorization, h.requests[0]!.headers.authorization);
  h.advance(3_600_000 - 30_000);   // inside the last minute
  await getProfile(h.ctx, act);
  assert.equal(h.minted.length, 2);
});

test("a 401 mints a new token once; a second 401 is an answer", async () => {
  const h = ready();
  let n = 0;
  h.on("GET", `${BASE}/labels`, () => (++n === 1 ? { status: 401, body: { error: { code: 401 } } } : { body: { labels: [] } }));
  assert.deepEqual(await listLabels(h.ctx, act), { labels: [] });
  assert.equal(h.minted.length, 2);
  h.on("GET", `${BASE}/threads/t1`, { status: 401, body: { error: { code: 401 } } });
  await assert.rejects(() => getThread(h.ctx, { ...act, threadId: "t1" }), (e) => codeOf(e) === "provider.auth_failed");
  assert.equal(h.minted.length, 3);
});

test("Google's refusals map to the error catalogue without passing Google's text on", async () => {
  const h = ready();
  const cases: [number, string | undefined, string][] = [
    [403, "rateLimitExceeded", "provider.rate_limited"], [403, "insufficientPermissions", "provider.auth_failed"], [403, "forbidden", "permission.no_grant"],
    [404, "notFound", "validation.not_found"], [400, "invalid", "validation.bad_input"], [410, undefined, "validation.precondition_failed"], [429, undefined, "provider.rate_limited"],
    [503, undefined, "provider.unavailable"], [418, undefined, "provider.bad_response"],
  ];
  for (const [status, reason, code] of cases) {
    h.on("GET", `${BASE}/labels`, { status, body: { error: { code: status, message: "private text from the request", ...(reason ? { errors: [{ reason }] } : {}) } } });
    await assert.rejects(() => listLabels(h.ctx, act), (e) => {
      assert.equal(codeOf(e), code, `${status} ${reason}`);
      assert.ok(!JSON.stringify(e).includes("private text"));
      return true;
    });
  }
  h.on("GET", `${BASE}/labels`, { throws: true });
  await assert.rejects(() => listLabels(h.ctx, act), (e) => codeOf(e) === "provider.network");
  h.on("GET", `${BASE}/labels`, { body: "<html>not json</html>" });
  await assert.rejects(() => listLabels(h.ctx, act), (e) => codeOf(e) === "provider.bad_response");
});
