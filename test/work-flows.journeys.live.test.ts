// The real app, four rc.9 work flows, started the way a person starts them, with a picture of every step in light and dark, desktop and phone. Same harness as the personal mail journeys
// (test/support/mail-browser.ts): needs Node 24, a Chromium and the production web export (VYRE_APP_DIST); with VYRE_REQUIRE_CHROME=1 (CI) it fails instead of skipping.
//   5 Add as a client (Personal): a stranger writes with two attachments; one tap on the Unmatched line makes the contact, files both attachments in its folder and puts a Reply task on the list.
//   6 A record shows everything (Team): Bo opens a record and sees its comment, task and shared mail in one feed, and nothing of Olivia's private chat about it.
//   7 Home says what changed (Team): Bo opens Home and the first line says what waits on him; the part about tasks opens Needs you.
//   8 One-tap send (Personal): an agent's email is held; Needs you shows the draft beside its record; Ask for changes sends it back with a note and nothing goes out.
import test from "node:test";
import assert from "node:assert/strict";
import { ask, makeAgent, connectClaude, unlockVault, until } from "./support/mail-world.ts";
import type { MailWorld, Person } from "./support/mail-world.ts";
import { bootScreens, browserOrSkip, open, seat, shoot } from "./support/mail-browser.ts";
import { standIn } from "./memory-live-kit.ts";

const OUT = "shots-evidence/work-flows";

/** A message from a stranger into a shared mailbox everyone can see, with attachments that are real files in the Space. */
async function strangerWrites(w: MailWorld, who: Person, o: { subject: string; text: string; attachments?: { name: string; text: string }[] }): Promise<{ conversationId: string; mailboxId: string }> {
  const box = (await who.ok("mail.mailbox.create", { kind: "shared", address: "hello@acme.test", title: "Hello", privacy: "space" })).mailbox as { id: string };
  const attachments: { name: string; mime: string; size: number; blobId: string }[] = [];
  for (const a of o.attachments ?? []) {
    const bytes = Buffer.from(a.text);
    const slot = await who.ok("files.upload_url", { size: bytes.length, mime: "text/plain" });
    await w.d.hooks!.call("files.put_upload", { blobId: slot.blobId, token: new URL(slot.url, "http://vyred").searchParams.get("token"), base64: bytes.toString("base64") });
    attachments.push({ name: a.name, mime: "text/plain", size: bytes.length, blobId: slot.blobId as string });
  }
  const landed = await who.ok("mail.ingest", {
    source: "imap", mailboxId: box.id, providerId: `p-${o.subject}`, rfcMessageId: `<${o.subject.replace(/\W/g, "")}@fox.test>`, direction: "in", from: { address: "dana@fox.test", name: "Dana Fox" },
    to: [{ address: "hello@acme.test" }], subject: o.subject, text: o.text, receivedAt: w.clock.t, ...(attachments.length ? { attachments } : {}),
  });
  await w.d.hooks?.pump?.();
  assert.ok(landed.conversationId, "the message opened a conversation");
  return { conversationId: landed.conversationId as string, mailboxId: box.id };
}

test("journey 5, add as a client: one tap makes the contact, files both attachments and puts a Reply task on the list", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  const s = await bootScreens({ kind: "personal" }, env);
  const dir = `${OUT}/5-add-client`;
  try {
    const w = s.world;
    const { conversationId } = await strangerWrites(w, w.owner, { subject: "Engagement papers", text: "My ID and the signed letter are attached.", attachments: [{ name: "id.txt", text: "ID PAPER" }, { name: "letter.txt", text: "SIGNED LETTER" }] });
    const me = await seat(s, w.owner, "Owner");
    await open(me, s, "/mail#screen=inbox.unmatched");
    await me.page.getByTestId(`add-client-${conversationId}`).waitFor({ timeout: 30_000 });
    await shoot(me.page, dir, "unmatched-line");
    await me.page.getByTestId(`add-client-${conversationId}`).click();
    await me.page.getByText(/added as a client\. 2 files filed\. Reply task on your list/).first().waitFor({ timeout: 30_000 });
    await shoot(me.page, dir, "added", { phone: false });

    const conv = (await w.owner.ok("inbox.thread", { conversationId })).conversation as { contactId?: string };
    assert.ok(conv.contactId, "the conversation is matched to a new contact");
    const folder = (await w.owner.ok("projects.files_folder", { type: "contact", recordId: conv.contactId, create: false })).folderId as string;
    const names = ((await w.owner.ok("files.list", { folder })).files as { name: string }[]).map((f) => f.name).sort();
    assert.deepEqual(names, ["id.txt", "letter.txt"]);
    const tasks = (await w.owner.ok("tasks.list", { scope: "record", recordId: conv.contactId })).tasks as { title: string }[];
    assert.ok(tasks.some((x) => /^Reply to/.test(x.title)), "the Reply task is there");
    assert.deepEqual(me.errors, [], "no page errors");
  } finally { await s.close(); }
});

test("journey 6, a record shows everything: Bo sees the comment, the task and the shared mail in one feed, and nothing of Olivia's private chat", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  const s = await bootScreens({ kind: "team", engineOpenSession: standIn }, env);
  const dir = `${OUT}/6-everything`;
  try {
    const w = s.world;
    await unlockVault(w);
    const account = await connectClaude(w);
    const bo = await w.join("bo");
    const rec = (await w.owner.ok("records.create", { type: "contact", fields: { name: "Dana Fox", email: "dana@fox.test" } })).record as { id: string };
    await w.owner.ok("records.comments.add", { type: "contact", recordId: rec.id, text: "Dana wants the Friday slot", mentions: [] });
    await w.owner.ok("tasks.create", { title: "Call Dana back", assigned: { kind: "person", id: bo.id }, recordId: rec.id });
    await w.owner.ok("contacts.address.add", { contactId: rec.id, kind: "email", value: "dana@fox.test" });
    await strangerWrites(w, w.owner, { subject: "Friday works", text: "Friday at ten is fine." });
    const helper = await makeAgent(w.owner, "Olivia helper", account);
    await w.owner.ok("chat.start", { kind: "chat", agentIds: [helper], recordId: rec.id, title: "Private notes on Dana" });
    await w.d.hooks?.pump?.();

    const seatBo = await seat(s, bo, "Member");
    await open(seatBo, s, `/records#subject=record:${rec.id}`);
    await seatBo.page.getByTestId("pane-everything").waitFor({ timeout: 30_000 });
    const feed = await seatBo.page.getByTestId("pane-everything").innerText();
    assert.match(feed, /Dana wants the Friday slot/);
    assert.match(feed, /Call Dana back/);
    assert.match(feed, /Friday works/);
    assert.ok(!/Private notes on Dana/.test(feed), "Olivia's private chat is not in Bo's feed");
    await shoot(seatBo.page, dir, "feed-bo");
    const seatOlivia = await seat(s, w.owner, "Owner");
    await open(seatOlivia, s, `/records#subject=record:${rec.id}`);
    await seatOlivia.page.getByTestId("pane-everything").waitFor({ timeout: 30_000 });
    assert.match(await seatOlivia.page.getByTestId("pane-everything").innerText(), /Private notes on Dana/, "the owner's own chat is in her feed");
    await shoot(seatOlivia.page, dir, "feed-olivia", { phone: false });
    assert.deepEqual([...seatBo.errors, ...seatOlivia.errors], [], "no page errors");
  } finally { await s.close(); }
});

test("journey 7, Home says what changed: the first line names what waits on Bo, and the task part opens Needs you", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  const s = await bootScreens({ kind: "team" }, env);
  const dir = `${OUT}/7-home-since`;
  try {
    const w = s.world;
    const bo = await w.join("bo");
    const seatBo = await seat(s, bo, "Member");
    await seatBo.ctx.addInitScript(() => { try { localStorage.setItem("vyre.home.lastVisit", String(Date.now() - 3 * 86_400_000)); } catch { /* blocked */ } });
    await open(seatBo, s, "/home");
    await seatBo.page.getByTestId("home-since").waitFor({ timeout: 30_000 }).catch(() => undefined);
    await shoot(seatBo.page, dir, "all-quiet");
    const quiet = await seatBo.page.getByTestId("home-since").innerText().catch(() => "");
    assert.match(quiet, /All quiet since/, "nothing happened yet");

    await w.owner.ok("tasks.create", { kind: "approve", title: "Approve the Dana letter", assigned: { kind: "person", id: bo.id } });
    await strangerWrites(w, w.owner, { subject: "Hello from Dana", text: "Hi" });
    await open(seatBo, s, "/home");
    await seatBo.page.getByTestId("since-waiting").waitFor({ timeout: 30_000 });
    const line = await seatBo.page.getByTestId("home-since").innerText();
    assert.match(line, /Since .*1 task waits on you.*1 unread message/s);
    await shoot(seatBo.page, dir, "line");
    await seatBo.page.getByTestId("since-waiting").click();
    await seatBo.page.getByText("Approve the Dana letter").first().waitFor({ timeout: 20_000 });
    await shoot(seatBo.page, dir, "needs-you", { phone: false });
    assert.deepEqual(seatBo.errors, [], "no page errors");
  } finally { await s.close(); }
});

test("journey 8, one-tap send: an agent's email is held, Needs you shows the draft beside its record, and Ask for changes sends nothing", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  const s = await bootScreens({ kind: "personal", engineOpenSession: standIn }, env);
  const dir = `${OUT}/8-held-send`;
  try {
    const w = s.world;
    await unlockVault(w);
    const account = await connectClaude(w);
    const rec = (await w.owner.ok("records.create", { type: "contact", fields: { name: "Dana Fox", email: "dana@fox.test" } })).record as { id: string };
    const { mailboxId } = await strangerWrites(w, w.owner, { subject: "Question", text: "Can you send the letter?" });
    const helper = await makeAgent(w.owner, "Drafter", account);
    const draft = { mailboxId, to: [{ address: "dana@fox.test", name: "Dana Fox", contactId: rec.id }], subject: "Your engagement letter", text: "Dear Dana, the letter is attached. Please sign by Friday.", contactId: rec.id, idempotencyKey: "j8-send" };
    void ask(w, w.owner, helper, `TOOL mail_send ${JSON.stringify(draft)}`).catch(() => undefined);
    const held = await until(async () => {
      await w.d.hooks?.pump?.();
      return (((await w.owner.ok("tasks.needs_you", {})).items as { task: { id: string; title: string; kind: string } }[]).find((i) => i.task.kind === "approve")?.task) ?? null;
    }, "the held send in Needs you");

    const me = await seat(s, w.owner, "Owner");
    await open(me, s, "/home");
    await me.page.getByText(held.title).first().waitFor({ timeout: 30_000 });
    await me.page.getByText(held.title).first().click();
    await me.page.getByTestId("held-mail").waitFor({ timeout: 20_000 });
    assert.match(await me.page.getByTestId("held-subject").innerText(), /Your engagement letter/);
    assert.match(await me.page.getByTestId("held-body").innerText(), /Please sign by Friday/);
    await me.page.getByTestId("held-record").getByText("Dana Fox").first().waitFor({ timeout: 20_000 });
    assert.equal(await me.page.getByTestId("needs-primary").innerText().then((x) => x.replace(/\s*A$/, "")), "Send");
    await shoot(me.page, dir, "held-draft");
    await me.page.getByTestId("needs-sendback").click();
    await me.page.getByTestId("needs-compose").locator("textarea, input").first().fill("Add the fee to the letter");
    await shoot(me.page, dir, "ask-for-changes", { phone: false });
    await me.page.getByTestId("needs-send").click();
    await until(async () => (((await w.owner.ok("gate.holds.list", { states: ["held"] })).holds as unknown[]).length === 0 ? true : null), "the hold is closed");
    const out = ((await w.owner.ok("mail.message.list", { mailboxId })).messages as { direction: string }[]).filter((m) => m.direction === "out");
    assert.equal(out.length, 0, "nothing was sent");
    assert.deepEqual(me.errors, [], "no page errors");
  } finally { await s.close(); }
});
