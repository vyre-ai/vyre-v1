// @reads /testkit/providers/fixtures/gmail-page.json
// @reads /testkit/providers/fixtures/graph-page.json
// Recorded Gmail and Graph pages, plus the 200 ms LLM latency the send budget measures.
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { manualClock } from "../providers/clock.ts";
import {
  PROVIDER_NAMES,
  ReplayMiss,
  fakeLlm,
  fakeProviders,
  gmailListUrl,
  graphMessagesUrl,
  loadReplay,
  replayFetch,
} from "../providers/index.ts";

const gmailFile = fileURLToPath(new URL("../providers/fixtures/gmail-page.json", import.meta.url));
const graphFile = fileURLToPath(new URL("../providers/fixtures/graph-page.json", import.meta.url));
const tape = loadReplay(fileURLToPath(new URL("../providers/fixtures", import.meta.url)));

const GMAIL_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=2";
const GRAPH_URL = "https://graph.microsoft.com/v1.0/me/messages?$top=2";

test("replay of a recorded Gmail page", async () => {
  const fromFile = loadReplay(gmailFile);
  assert.equal(fromFile.exchanges.length, 1);
  assert.equal(tape.exchanges.length, 2);

  const fetch = replayFetch(fromFile);
  const res = await fetch(GMAIL_URL);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/json");
  const raw = JSON.parse(await res.text()) as {
    messages: { id: string; threadId: string }[];
    nextPageToken: string;
    resultSizeEstimate: number;
  };
  assert.equal(raw.messages[0]?.id, "18f0a1b2c3d4e5f6");
  assert.equal(raw.messages[0]?.threadId, "18f0a1b2c3d4e5f6");
  assert.equal(raw.messages[1]?.id, "18f0a1b2c3d4e5f7");
  assert.equal(raw.nextPageToken, "page-2");
  assert.equal(raw.resultSizeEstimate, 2);
  const again = JSON.parse(await (await fetch(GMAIL_URL)).text()) as { messages: { id: string }[] };
  assert.equal(again.messages[0]?.id, "18f0a1b2c3d4e5f6");

  const google = fakeProviders({ tapes: { google: fromFile } }).google;
  const page = await google.gmailListMessages({ maxResults: 2 });
  assert.equal(page.messages[0]?.id, "18f0a1b2c3d4e5f6");
  assert.equal(page.messages[0]?.threadId, "18f0a1b2c3d4e5f6");
  assert.equal(page.messages[1]?.threadId, "18f0bb00c3d4e5f7");
  assert.equal(page.nextPageToken, "page-2");
  assert.equal(page.resultSizeEstimate, 2);
  assert.equal(gmailListUrl({ maxResults: 2 }), GMAIL_URL);
});

test("replay of a recorded Graph page", async () => {
  const fromFile = loadReplay(graphFile);
  const fetch = replayFetch(fromFile);
  const encoded = graphMessagesUrl({ top: 2 });
  assert.equal(new URL(encoded).searchParams.get("$top"), "2");
  const res = await fetch(encoded);
  assert.equal(res.status, 200);
  const raw = JSON.parse(await res.text()) as {
    value: { id: string; subject: string }[];
    "@odata.nextLink": string;
  };
  assert.equal(raw.value[0]?.id, "AAMkAGI2-fake-1");
  assert.equal(raw.value[0]?.subject, "Welcome");
  assert.equal(raw.value[1]?.subject, "Invoice");
  assert.equal(raw["@odata.nextLink"], "https://graph.microsoft.com/v1.0/me/messages?$skiptoken=page-2");

  const microsoft = fakeProviders({ tapes: { microsoft: fromFile } }).microsoft;
  const page = await microsoft.mailListMessages({ top: 2 });
  assert.equal(page.value[0]?.id, "AAMkAGI2-fake-1");
  assert.equal(page.value[0]?.receivedDateTime, "2026-01-15T12:00:00Z");
  assert.equal(page.value[1]?.id, "AAMkAGI2-fake-2");
  assert.equal(page["@odata.nextLink"], "https://graph.microsoft.com/v1.0/me/messages?$skiptoken=page-2");
  const org = await microsoft.organization();
  assert.equal(org.displayName, "Fake Tenant");
  assert.equal(GRAPH_URL.includes("$top=2"), true);
});

test("fake LLM 200 ms latency injection", async () => {
  const llm = fakeLlm({
    latencyMs: 200,
    script: [{ type: "text", text: "hello from the fake" }, { type: "done" }],
  });
  const t0 = Date.now();
  const texts: string[] = [];
  let first = -1;
  for await (const ev of llm.stream({ messages: [{ role: "user", content: "hi" }] })) {
    if (first < 0) first = Date.now() - t0;
    if (ev.type === "text") texts.push(ev.text);
    assert.equal(ev.type === "error", false);
  }
  const elapsed = Date.now() - t0;
  assert.ok(first >= 200, `first token at ${first} ms`);
  assert.ok(elapsed < 5_000, `stream took ${elapsed} ms`);
  assert.deepEqual(texts, ["hello from the fake"]);

  const httpAt = Date.now();
  const res = await llm.fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "fake", messages: [{ role: "user", content: "hi" }] }),
  });
  const httpMs = Date.now() - httpAt;
  assert.equal(res.status, 200);
  assert.ok(httpMs >= 200, `http first byte at ${httpMs} ms`);
  assert.ok(httpMs < 5_000, `http took ${httpMs} ms`);
  const body = JSON.parse(await res.text()) as { choices: { message: { content: string } }[] };
  assert.equal(body.choices[0]?.message.content, "hello from the fake");
});

test("manual clock injects the same latency without a wall wait", async () => {
  const clock = manualClock(0);
  const llm = fakeLlm({
    latencyMs: 200,
    clock,
    script: [{ type: "text", text: "clock" }, { type: "done" }],
  });
  const t0 = Date.now();
  const iter = llm.stream({ messages: [{ role: "user", content: "hi" }] })[Symbol.asyncIterator]();
  const pending = iter.next();
  clock.advance(199);
  let early = false;
  pending.then(() => { early = true; }, () => { early = true; });
  await Promise.resolve();
  assert.equal(early, false);
  clock.advance(1);
  const step = await pending;
  assert.equal(step.value?.type, "text");
  if (step.value?.type === "text") assert.equal(step.value.text, "clock");
  const done = await iter.next();
  assert.equal(done.value?.type, "done");
  assert.ok(Date.now() - t0 < 190, "manual clock must not sleep on the wall");
});

test("one scripted fake per provider", async () => {
  const kit = fakeProviders({
    llm: { script: (turn) => [{ type: "text", text: turn.messages[0]?.content ?? "" }, { type: "done" }] },
  });
  for (const name of PROVIDER_NAMES) assert.equal(kit[name].name, name);

  const texts: string[] = [];
  for await (const ev of kit.llm.stream({ messages: [{ role: "user", content: "ping" }] })) {
    if (ev.type === "text") texts.push(ev.text);
  }
  assert.deepEqual(texts, ["ping"]);
  const routed = await kit.http("https://api.anthropic.com/v1/messages", {
    method: "POST",
    body: JSON.stringify({ messages: [{ role: "user", content: "ping" }] }),
  });
  const routedBody = JSON.parse(await routed.text()) as { content: { text: string }[] };
  assert.equal(routedBody.content[0]?.text, "ping");

  const mail = await kit.mail.send({ from: "a@example.com", to: ["b@example.com"], subject: "hi", text: "body" });
  assert.equal(mail.id.startsWith("email_"), true);
  assert.equal(kit.mail.sent().length, 1);
  const gun = await kit.mail.fetch("https://api.mailgun.net/v3/example.com/messages", {
    method: "POST",
    body: JSON.stringify({ from: "a@example.com", to: ["b@example.com"], subject: "s" }),
  });
  assert.equal(gun.status, 200);

  const health = await kit.twilio.health();
  assert.equal(health.status, "active");
  assert.equal(health.sid.startsWith("AC"), true);
  const sms = await kit.twilio.smsSend({ from: "+15550001", to: "+15550002", body: "hi" });
  assert.equal(sms.status, "queued");

  const app = await kit.github.getApp();
  assert.equal(app.slug, "vyre-fake");
  assert.deepEqual(await kit.github.listIssues("vyre/vyre"), []);

  const empty = await kit.google.gmailListMessages();
  assert.deepEqual(empty.messages, []);
  assert.equal(empty.resultSizeEstimate, 0);

  const org = await kit.microsoft.organization();
  assert.equal(org.id, "tenant-fake");
  assert.equal(org.displayName, "Fake Tenant");
  const blank = await kit.microsoft.mailListMessages();
  assert.deepEqual(blank.value, []);

  const bal = await kit.stripe.balance();
  assert.equal(bal.available[0]?.amount, 0);
  assert.equal(bal.available[0]?.currency, "usd");
  const cus = await kit.stripe.createCustomer({ email: "ada@example.com" });
  assert.equal(cus.id.startsWith("cus_"), true);
  assert.equal(cus.email, "ada@example.com");

  assert.equal((await kit.documenso.health()).status, "ok");
  const env = await kit.documenso.create({ title: "NDA", signers: [{ name: "Ada", email: "ada@example.com" }] });
  assert.equal(env.id.startsWith("env_"), true);
  assert.equal((await kit.documenso.status(env.id)).status, "pending");
  assert.equal((await kit.documenso.cancel(env.id)).cancelled, true);
  assert.equal((await kit.documenso.status(env.id)).status, "cancelled");
  const signed = await kit.documenso.fetchSigned(env.id);
  assert.ok(signed.pdf.byteLength > 0);
  assert.ok(signed.certificate.byteLength > 0);

  const me = await kit.zoom.me();
  assert.equal(me.email, "ada@example.com");
  const meeting = await kit.zoom.createMeeting({ topic: "Standup", durationMinutes: 15 });
  assert.equal(meeting.topic, "Standup");
  assert.equal(meeting.joinUrl.includes("zoom.us/j/"), true);

  const gh = await kit.http("https://api.github.com/app");
  assert.equal(gh.status, 200);
  await assert.rejects(() => kit.http("https://example.invalid/nope"), ReplayMiss);
  await assert.rejects(() => kit.http("not a url"), ReplayMiss);
});
