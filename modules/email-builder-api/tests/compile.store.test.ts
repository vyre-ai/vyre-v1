// The email builder's capabilities over a hand-built Ctx: designs and versions, preview and render, test send, merge fields, snippets, the Ask diff.
// @reads /modules/email-builder-api/migrations/0001_email_builder.sql
// @reads /modules/email-builder-api/migrations/0002_saved_blocks.sql

import test from "node:test";
import assert from "node:assert/strict";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { configureEmailBuilder, handlers, inline, consumers } from "../impl.ts";
import type { AskDriver, Block, EmailDoc } from "../handlers/index.ts";
import { seed } from "../fixtures/seed.ts";
import { harness } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";

type Fn = (ctx: Ctx, input: unknown) => Promise<unknown>;
const run = async <T>(ctx: Ctx, cap: keyof typeof handlers, input: unknown): Promise<T> => (await (handlers[cap] as Fn)(ctx, input)) as T;
const code = async (p: Promise<unknown>): Promise<string> => { try { await p; } catch (e) { if (e instanceof VyreErr) return e.error.code; throw e; } return "none"; };

const text = (html: string): Block => ({ type: "text", props: { html } });
const unsub: Block = { type: "merge", props: { key: "unsubscribe_url" } };

async function newEmail(w: World, name = "Spring note", mode = "blocks"): Promise<EmailDoc> {
  return (await run<{ email: EmailDoc }>(w.ctx, "email_builder.create", { name, mode, idempotencyKey: `k-${name}` })).email;
}
const save = (w: World, email: EmailDoc, ctx: Ctx = w.ctx) => run<{ version: number }>(ctx, "email_builder.save", { emailId: email.emailId, email, idempotencyKey: `s-${w.db.statements}` });

test("create: a design of each mode starts as version 1 with an empty body; names are checked", async () => {
  const w = harness();
  const blocks = await newEmail(w, "Welcome");
  assert.match(blocks.emailId, /^eml_[a-z0-9]+$/);
  assert.deepEqual(blocks, { emailId: blocks.emailId, name: "Welcome", mode: "blocks", blocks: [{ type: "text", props: { html: "" } }] });
  const html = await newEmail(w, "Raw", "html");
  assert.equal(html.html, "");
  assert.equal(html.blocks, undefined);
  const plain = await newEmail(w, "Note", "plain");
  assert.equal(plain.plain, "");
  assert.equal(w.db.rows("email_builder_api_version").length, 3);
  assert.deepEqual(w.db.rows("email_builder_api_version").map((r) => [r.version, r.author]), [[1, "usr_alex"], [1, "usr_alex"], [1, "usr_alex"]]);
  assert.equal(await code(run(w.ctx, "email_builder.create", { name: " ", mode: "blocks" })), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "email_builder.create", { name: "x", mode: "pdf" })), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "email_builder.create", { name: "x".repeat(121), mode: "blocks" })), "validation.bad_input");
  assert.deepEqual((await run<{ email: EmailDoc }>(w.ctx, "email_builder.get", { emailId: blocks.emailId })).email, blocks);
  assert.equal(await code(run(w.ctx, "email_builder.get", { emailId: "eml_nope" })), "validation.not_found");
});

test("list: every design of the Space, newest change first", async () => {
  const w = harness();
  const a = await newEmail(w, "Alpha");
  w.advance(1000);
  const b = await newEmail(w, "Beta");
  w.advance(1000);
  await save(w, { ...a, subject: "Changed" });
  const listed = (await run<{ emails: { emailId: string; name: string; updatedAt: number }[] }>(w.as("usr_other"), "email_builder.list", {})).emails;
  assert.deepEqual(listed.map((e) => e.name), ["Alpha", "Beta"]);
  assert.equal(listed[0]?.emailId, a.emailId);
  assert.equal(listed[1]?.emailId, b.emailId);
  assert.equal(listed[0]?.updatedAt, 1_760_000_002_000);
});

test("save: each change is a version and an event; an autosave with nothing new is not; restore brings an old one back as a new version", async () => {
  const w = harness();
  const email = await newEmail(w);
  const v2 = await save(w, { ...email, subject: "Hello", blocks: [text("One"), unsub] });
  assert.equal(v2.version, 2);
  assert.deepEqual(w.events.at(-1), { name: "email_template.saved", subject: `entity/${email.emailId}`, payload: { emailId: email.emailId, version: 2 } });
  const again = await save(w, { ...email, blocks: [text("One"), unsub], subject: "Hello" });   // the same design, keys in another order
  assert.equal(again.version, 2);
  assert.equal(w.events.filter((e) => e.name === "email_template.saved").length, 1);
  w.advance(5000);
  const v3 = await save(w, { ...email, subject: "Hello again", blocks: [text("Two"), unsub] }, w.as("usr_ana"));
  assert.equal(v3.version, 3);
  const list = (await run<{ versions: { version: number; at: number; by: string }[] }>(w.ctx, "email_builder.versions", { emailId: email.emailId })).versions;
  assert.deepEqual(list.map((v) => [v.version, v.by]), [[3, "usr_ana"], [2, "usr_alex"], [1, "usr_alex"]]);
  assert.equal(list[0]?.at, 1_760_000_005_000);

  const restored = (await run<{ email: EmailDoc }>(w.ctx, "email_builder.restore_version", { emailId: email.emailId, version: 2 })).email;
  assert.equal(restored.subject, "Hello");
  assert.equal(restored.blocks?.[0]?.props.html, "One");
  assert.equal((await run<{ versions: unknown[] }>(w.ctx, "email_builder.versions", { emailId: email.emailId })).versions.length, 4, "a restore is a new version, nothing is lost");
  assert.deepEqual(w.events.at(-1)?.payload, { emailId: email.emailId, version: 4 });
  assert.equal(await code(run(w.ctx, "email_builder.restore_version", { emailId: email.emailId, version: 9 })), "validation.not_found");
  assert.equal(await code(run(w.ctx, "email_builder.restore_version", { emailId: email.emailId, version: 0 })), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "email_builder.restore_version", { emailId: "eml_nope", version: 1 })), "validation.not_found");
});

test("save: a design for another email, or past the limits, is refused and changes nothing", async () => {
  const w = harness();
  const email = await newEmail(w);
  const other = await newEmail(w, "Other");
  assert.equal(await code(save(w, { ...other })), "none");
  assert.equal(await code(run(w.ctx, "email_builder.save", { emailId: email.emailId, email: { ...email, emailId: other.emailId } })), "validation.bad_input");
  assert.equal(await code(save(w, { ...email, blocks: [{ type: "video", props: {} } as unknown as Block] })), "validation.bad_input");
  assert.equal(await code(save(w, { ...email, html: "x".repeat(1024 * 1024 + 1) })), "validation.too_large");
  assert.equal(await code(run(w.ctx, "email_builder.save", { emailId: "eml_nope", email })), "validation.not_found");
  assert.equal(w.db.rows("email_builder_api_version").filter((r) => r.email_id === email.emailId).length, 1);
});

test("html_set: an agent's HTML replaces the design, as a new version; the same HTML again is not one", async () => {
  const w = harness();
  const email = await newEmail(w);
  assert.deepEqual(await run(w.ctx, "email_builder.html_set", { emailId: email.emailId, html: "<p>Hello {{first_name|there}}</p>" }), { ok: true });
  const got = (await run<{ email: EmailDoc }>(w.ctx, "email_builder.get", { emailId: email.emailId })).email;
  assert.equal(got.mode, "html");
  assert.equal(got.html, "<p>Hello {{first_name|there}}</p>");
  assert.equal(got.blocks, undefined);
  assert.equal(w.events.filter((e) => e.name === "email_template.saved").length, 1);
  await run(w.ctx, "email_builder.html_set", { emailId: email.emailId, html: "<p>Hello {{first_name|there}}</p>" });
  assert.equal(w.events.filter((e) => e.name === "email_template.saved").length, 1);
  assert.equal(await code(run(w.ctx, "email_builder.html_set", { emailId: email.emailId, html: 5 })), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "email_builder.html_set", { emailId: email.emailId, html: "x".repeat(1024 * 1024 + 1) })), "validation.too_large");
  assert.equal(await code(run(w.ctx, "email_builder.html_set", { emailId: "eml_nope", html: "x" })), "validation.not_found");
});

test("render: desktop, mobile, dark and plain previews; warnings list what a send would trip on; a record fills the fields", async () => {
  const w = harness();
  const email = await newEmail(w);
  await save(w, { ...email, subject: "Hi {{first_name|there}}", blocks: [text("Dear {{first_name|friend}}, welcome."), { type: "button", props: { label: "Open", href: "https://x.example/o" } }] });
  w.scripts.records["rec_dana"] = { first_name: "Dana", company: "Rivera" };
  const render = (variant: string, extra: object = {}) => run<{ html: string; warnings: string[] }>(w.ctx, "email_builder.render", { emailId: email.emailId, variant, ...extra });

  const desktop = await render("desktop");
  assert.match(desktop.html, /Dear friend, welcome\./, "with no record the fallback reads");
  assert.match(desktop.html, /<title>Hi there<\/title>/);
  assert.deepEqual(desktop.warnings, ["Missing. Required by law and by mailbox providers.", "The plain-text part has no unsubscribe link"]);
  const dana = await render("desktop", { asRecordId: "rec_dana" });
  assert.match(dana.html, /Dear Dana, welcome\./);
  assert.match(dana.html, /<title>Hi Dana<\/title>/);
  assert.deepEqual(w.calls.at(-1), { cap: "records.get", input: { recordId: "rec_dana" } });
  const mobile = await render("mobile"), dark = await render("dark");
  assert.ok(mobile.html.split(".col{display:block!important").length === 3);
  assert.ok(dark.html.split("background:#0F0F11!important").length === 3);
  const plain = await render("plain", { asRecordId: "rec_dana" });
  assert.equal(plain.html, "Dear Dana, welcome.\n\nOpen: https://x.example/o\n");
  assert.equal(await code(render("print")), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "email_builder.render", { emailId: "eml_nope", variant: "desktop" })), "validation.not_found");

  await save(w, { ...email, subject: "Hi", blocks: [text("Dear all"), unsub] });
  const clean = await render("desktop");
  assert.match(clean.html, /<a href="https:\/\/preview\.invalid\/unsubscribe"/, "a preview link, never a real recipient's");
  assert.deepEqual(clean.warnings, []);
  assert.match((await render("plain")).html, /Unsubscribe: https:\/\/preview\.invalid\/unsubscribe/);
});

test("send_test: goes only to the author's own address, through the single send API, and says whether it went", async () => {
  const w = harness();
  const email = await newEmail(w);
  await save(w, { ...email, subject: "Hello {{first_name|there}}", blocks: [text("Body"), unsub] });
  assert.deepEqual(await run(w.ctx, "email_builder.send_test", { emailId: email.emailId, to: "Alex@Example.com" }), { sent: true });
  const send = w.calls.find((c) => c.cap === "mail.send")?.input as { mailboxId: string; to: { address: string }[]; subject: string; text: string; html: string; idempotencyKey: string };
  assert.equal(send.mailboxId, "mbx_mine");
  assert.deepEqual(send.to, [{ address: "Alex@Example.com" }]);
  assert.equal(send.subject, "[Test] Hello there");
  assert.match(send.text, /Body\n\nUnsubscribe: https:\/\/preview\.invalid\/unsubscribe/);
  assert.match(send.html, /<!doctype html>/);
  assert.match(send.idempotencyKey, /^email-test-eml_/);
  assert.deepEqual(w.calls.find((c) => c.cap === "mail.mailbox.list")?.input, { scope: "mine" });
  assert.deepEqual(w.events.at(-1), { name: "email_template.test_sent", subject: `entity/${email.emailId}`, payload: { emailId: email.emailId } });

  const before = w.calls.filter((c) => c.cap === "mail.send").length;
  assert.equal(await code(run(w.ctx, "email_builder.send_test", { emailId: email.emailId, to: "someone@else.example" })), "validation.precondition_failed");
  assert.equal(await code(run(w.ctx, "email_builder.send_test", { emailId: email.emailId, to: "not an address" })), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "email_builder.send_test", { emailId: "eml_nope", to: "alex@example.com" })), "validation.not_found");
  assert.equal(w.calls.filter((c) => c.cap === "mail.send").length, before, "nothing went to anyone else");

  w.scripts.sendStatus = "held";
  const events = w.events.length;
  assert.deepEqual(await run(w.ctx, "email_builder.send_test", { emailId: email.emailId, to: "alex@example.com" }), { sent: false });
  assert.equal(w.events.length, events, "a held send is not reported as sent");
  w.scripts.sendStatus = "queued";
  assert.deepEqual(await run(w.ctx, "email_builder.send_test", { emailId: email.emailId, to: "alex@example.com" }), { sent: true });
});

test("merge fields: the system fields first, then the record type's, once each, and only keys a token can name", async () => {
  const w = harness();
  w.scripts.types["contact"] = [{ key: "first_name", title: "First name" }, { key: "Company", title: "" }, { key: "unsubscribe_url", title: "Dup" }, { key: "has space", title: "Bad" }, { key: "2fast", title: "Bad" }, { key: "first_name", title: "Again" }];
  const got = (await run<{ fields: { key: string; title: string }[] }>(w.ctx, "email_builder.merge_fields", { type: "contact" })).fields;
  assert.deepEqual(got, [
    { key: "unsubscribe_url", title: "Unsubscribe link" }, { key: "preferences_url", title: "Preferences link" }, { key: "owner_name", title: "Owner name" },
    { key: "first_name", title: "First name" }, { key: "Company", title: "Company" },
  ]);
  assert.deepEqual(w.calls.at(-1), { cap: "schema.types.get", input: { type: "contact" } });
});

test("snippets: mine and shared with the Space, shortcuts unique per person, only the owner changes or deletes", async () => {
  const w = harness();
  const ana = w.as("usr_ana");
  type Snip = { snippetId: string; name: string; body: string; shortcut?: string; shared: boolean; updatedAt: number };
  const mine = (await run<{ snippet: Snip }>(w.ctx, "email_builder.snippets.save", { name: "Thanks", body: "Thank you for your time.", shortcut: "ty" })).snippet;
  assert.match(mine.snippetId, /^snp_[a-z0-9]+$/);
  assert.deepEqual({ ...mine, snippetId: "", updatedAt: 0 }, { snippetId: "", name: "Thanks", body: "Thank you for your time.", shortcut: "ty", shared: false, updatedAt: 0 });
  const shared = (await run<{ snippet: Snip }>(w.ctx, "email_builder.snippets.save", { name: "Address", body: "410 Market Street", shared: true })).snippet;
  assert.equal(shared.shared, true);
  assert.equal(shared.shortcut, undefined);
  const hers = (await run<{ snippet: Snip }>(ana, "email_builder.snippets.save", { name: "Hers", body: "private" })).snippet;

  const names = async (c: Ctx) => (await run<{ snippets: Snip[] }>(c, "email_builder.snippets.list", {})).snippets.map((s) => s.name);
  assert.deepEqual(await names(w.ctx), ["Address", "Thanks"]);
  assert.deepEqual(await names(ana), ["Address", "Hers"], "a private snippet is not seen by others, a shared one is");

  w.advance(1000);
  const edited = (await run<{ snippet: Snip }>(w.ctx, "email_builder.snippets.save", { snippetId: mine.snippetId, name: "Thanks!", body: "Thanks again.", shortcut: "ty" })).snippet;
  assert.equal(edited.snippetId, mine.snippetId);
  assert.equal(edited.name, "Thanks!");
  assert.equal(edited.shared, false, "sharing is kept when the change does not say");
  assert.equal(edited.updatedAt, 1_760_000_001_000);
  assert.equal((await run<{ snippet: Snip }>(w.ctx, "email_builder.snippets.save", { snippetId: mine.snippetId, name: "Thanks!", body: "x", shortcut: "ty", shared: true })).snippet.shared, true);

  assert.equal(await code(run(w.ctx, "email_builder.snippets.save", { name: "Dup", body: "x", shortcut: "ty" })), "validation.duplicate");
  assert.equal((await run<{ snippet: Snip }>(ana, "email_builder.snippets.save", { name: "Hers too", body: "x", shortcut: "ty" })).snippet.shortcut, "ty", "another person may use the same shortcut");
  assert.equal(await code(run(w.ctx, "email_builder.snippets.save", { name: "Bad", body: "x", shortcut: "no spaces" })), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "email_builder.snippets.save", { name: "Big", body: "x".repeat(16 * 1024 + 1) })), "validation.too_large");
  assert.equal(await code(run(w.ctx, "email_builder.snippets.save", { name: "", body: "x" })), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "email_builder.snippets.save", { name: "Bad", body: "x", shared: "yes" })), "validation.bad_input");
  assert.equal(await code(run(ana, "email_builder.snippets.save", { snippetId: mine.snippetId, name: "Stolen", body: "x" })), "validation.not_found", "another person cannot change it, even a shared one");
  assert.equal(await code(run(w.ctx, "email_builder.snippets.save", { snippetId: "snp_nope", name: "x", body: "x" })), "validation.not_found");

  assert.deepEqual(await run(ana, "email_builder.snippets.delete", { snippetId: shared.snippetId }), { deleted: false });
  assert.deepEqual(await run(w.ctx, "email_builder.snippets.delete", { snippetId: shared.snippetId }), { deleted: true });
  assert.deepEqual(await run(w.ctx, "email_builder.snippets.delete", { snippetId: shared.snippetId }), { deleted: false });
  assert.deepEqual(await names(ana), ["Hers", "Hers too", "Thanks!"], "her own two and the one shared with the Space");
  void hers;
});

test("ask diff: the agent's proposal becomes per-change differences the author accepts one by one", async () => {
  const w = harness();
  const email = await newEmail(w);
  await save(w, { ...email, subject: "Hello", blocks: [text("Dear customer"), { type: "button", props: { label: "Open", href: "https://x.example" } }] });
  assert.equal(await code(run(w.ctx, "email_builder.ask_diff", { emailId: email.emailId, instruction: "make it warmer" })), "validation.precondition_failed", "no agent connected");

  const seen: { instruction: string; agentId: string | null; doc: EmailDoc }[] = [];
  const driver: AskDriver = {
    async propose(req) {
      seen.push(req);
      req.doc.name = "mutated copy";   // the driver gets a copy: nothing it does to it reaches the store
      return { subject: "Hello, friend", blocks: [text("Dear friend, thank you"), { type: "button", props: { label: "Open now", href: "https://x.example" } }, unsub] };
    },
  };
  configureEmailBuilder({ ask: driver });
  const changes = (await run<{ changes: { path: string; before: unknown; after: unknown }[] }>(w.ctx, "email_builder.ask_diff", { emailId: email.emailId, instruction: "make it warmer", agentId: "agt_writer" })).changes;
  assert.equal(seen[0]?.instruction, "make it warmer");
  assert.equal(seen[0]?.agentId, "agt_writer");
  assert.equal(seen[0]?.doc.subject, "Hello");
  assert.deepEqual(changes.map((c) => c.path), ["/subject", "/blocks/0/props/html", "/blocks/1/props/label", "/blocks/2"]);
  assert.deepEqual(changes[0], { path: "/subject", before: "Hello", after: "Hello, friend" });
  assert.equal((await run<{ email: EmailDoc }>(w.ctx, "email_builder.get", { emailId: email.emailId })).email.name, "Spring note");
  assert.equal(w.db.rows("email_builder_api_version").filter((r) => r.email_id === email.emailId).length, 2, "asking changes nothing until the author saves");

  configureEmailBuilder({ ask: { propose: async () => ({ blocks: [{ type: "video", props: {} } as unknown as Block] }) } });
  assert.equal(await code(run(w.ctx, "email_builder.ask_diff", { emailId: email.emailId, instruction: "x" })), "validation.bad_input", "a proposal is held to the rules of a save");
  assert.equal(await code(run(w.ctx, "email_builder.ask_diff", { emailId: email.emailId, instruction: "x".repeat(4001) })), "validation.too_large");
  assert.equal(await code(run(w.ctx, "email_builder.ask_diff", { emailId: email.emailId, instruction: "" })), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "email_builder.ask_diff", { emailId: "eml_nope", instruction: "x" })), "validation.not_found");
  configureEmailBuilder({ ask: { propose: async () => ({}) } });
  assert.deepEqual((await run<{ changes: unknown[] }>(w.ctx, "email_builder.ask_diff", { emailId: email.emailId, instruction: "leave it" })).changes, [], "no change asked, none made");
});

test("module: every capability the manifest names has a handler; seed and projections add nothing", () => {
  const caps = ["create", "get", "list", "save", "versions", "restore_version", "render", "html_set", "ask_diff", "send_test", "merge_fields", "snippets.list", "snippets.save", "snippets.delete", "saved_blocks.list", "saved_blocks.save"].map((c) => `email_builder.${c}`);
  assert.deepEqual(Object.keys(handlers).sort(), caps.sort());
  assert.equal(seed.rows.length, 0);
  assert.deepEqual([inline, consumers], [{}, {}]);
});

// Run on the final commit of this packet, after merging main, so the CI log lists this file as ok.

test("create: emits email.created for the new design, with the folder it goes into when one is given", async () => {
  const w = harness();
  const top = await newEmail(w, "Top level");
  assert.deepEqual(w.events.at(-1), { name: "email.created", subject: `email/${top.emailId}`, payload: { emailId: top.emailId } });
  const inFolder = (await run<{ email: EmailDoc }>(w.ctx, "email_builder.create", { name: "In a folder", mode: "plain", folderId: "fld_a1", idempotencyKey: "k-folder" })).email;
  assert.deepEqual(w.events.at(-1), { name: "email.created", subject: `email/${inFolder.emailId}`, payload: { emailId: inFolder.emailId, folderId: "fld_a1" } });
  assert.equal(w.events.filter((e) => e.name === "email.created").length, 2, "one event per design");
});
