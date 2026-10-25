// Saved blocks and the spacer, social and saved block kinds (P-CC_30): save, list, who may change one, and how each kind compiles.
// @reads /modules/email-builder-api/migrations/0002_saved_blocks.sql
// Run on the final commit of this packet, after merging main, so the CI log lists the file as ok.
import test from "node:test";
import assert from "node:assert/strict";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { handlers } from "../impl.ts";
import { compileHtml, compileText } from "../handlers/index.ts";
import type { Block, EmailDoc } from "../handlers/index.ts";
import { harness } from "../fixtures/world.ts";

type Fn = (ctx: Ctx, input: unknown) => Promise<unknown>;
const run = async <T>(ctx: Ctx, cap: keyof typeof handlers, input: unknown): Promise<T> => (await (handlers[cap] as Fn)(ctx, input)) as T;
const code = async (p: Promise<unknown>): Promise<string> => { try { await p; } catch (e) { if (e instanceof VyreErr) return e.error.code; throw e; } return "none"; };
type Saved = { blockId: string; name: string; block: Block; shared: boolean; updatedAt: number };

const social: Block = { type: "social", props: { links: [{ network: "linkedin", url: "https://linkedin.com/company/acme" }, { network: "x", url: "javascript:alert(1)" }], align: "center" } };
const doc = (blocks: Block[]): EmailDoc => ({ emailId: "eml_x", name: "n", mode: "blocks", blocks });

test("save then list: a saved block is mine, shared ones are seen by the Space, and the save says so once", async () => {
  const w = harness();
  const ana = w.as("usr_ana");
  const mine = (await run<{ block: Saved }>(w.ctx, "email_builder.saved_blocks.save", { name: "Signature social", block: social })).block;
  assert.match(mine.blockId, /^blk_[a-z0-9]+$/);
  assert.equal(mine.shared, false);
  assert.deepEqual(mine.block, social);
  assert.deepEqual(w.events.map((e) => [e.name, (e.payload as { shared: boolean }).shared]), [["email_block.saved", false]]);
  const shared = (await run<{ block: Saved }>(w.ctx, "email_builder.saved_blocks.save", { name: "Footer", block: { type: "footer", props: { text: "Acme", unsub: true } }, shared: true })).block;
  const names = async (c: Ctx) => (await run<{ blocks: Saved[] }>(c, "email_builder.saved_blocks.list", {})).blocks.map((b) => b.name);
  assert.deepEqual(await names(w.ctx), ["Footer", "Signature social"]);
  assert.deepEqual(await names(ana), ["Footer"], "a private block is not seen by someone else");
  w.advance(1000);
  const edited = (await run<{ block: Saved }>(w.ctx, "email_builder.saved_blocks.save", { blockId: mine.blockId, name: "Social row", block: social })).block;
  assert.equal(edited.blockId, mine.blockId);
  assert.equal(edited.name, "Social row");
  assert.ok(edited.updatedAt > mine.updatedAt);
  assert.equal((await run<{ blocks: Saved[] }>(w.ctx, "email_builder.saved_blocks.list", {})).blocks.length, 2, "an edit is not a copy");
  void shared;
});

test("a person without access is refused: someone else's private block is not found, a shared one is not theirs to change", async () => {
  const w = harness();
  const ana = w.as("usr_ana");
  const priv = (await run<{ block: Saved }>(w.ctx, "email_builder.saved_blocks.save", { name: "Private", block: social })).block;
  const shared = (await run<{ block: Saved }>(w.ctx, "email_builder.saved_blocks.save", { name: "Shared", block: social, shared: true })).block;
  assert.equal(await code(run(ana, "email_builder.saved_blocks.save", { blockId: priv.blockId, name: "Mine now", block: social })), "validation.not_found");
  assert.equal(await code(run(ana, "email_builder.saved_blocks.save", { blockId: shared.blockId, name: "Mine now", block: social })), "permission.no_grant");
  assert.equal((await run<{ blocks: Saved[] }>(w.ctx, "email_builder.saved_blocks.list", {})).blocks.find((b) => b.blockId === shared.blockId)?.name, "Shared", "the refused edit changed nothing");
});

test("bad input is refused: a name, a block of an unknown type, a saved block inside a saved block, bad social links", async () => {
  const w = harness();
  const save = (input: unknown) => code(run(w.ctx, "email_builder.saved_blocks.save", input));
  assert.equal(await save({ name: " ", block: social }), "validation.bad_input");
  assert.equal(await save({ name: "x", block: { type: "carousel", props: {} } }), "validation.bad_input");
  assert.equal(await save({ name: "x", block: { type: "saved", props: { block: social } } }), "validation.bad_input");
  assert.equal(await save({ name: "x", block: { type: "social", props: { links: [{ network: "myspace", url: "https://x.test" }] } } }), "validation.bad_input");
  assert.equal(w.events.length, 0);
});

test("spacer is a gap of its size, clamped; social keeps safe links only; saved renders the block it holds", () => {
  const sp = compileHtml(doc([{ type: "spacer", props: { size: 40 } }]));
  assert.match(sp, /height:40px/);
  assert.match(compileHtml(doc([{ type: "spacer", props: { size: 9999 } }])), /height:200px/);
  assert.match(compileHtml(doc([{ type: "spacer", props: {} }])), /height:24px/);
  const so = compileHtml(doc([social]));
  assert.match(so, /href="https:\/\/linkedin\.com\/company\/acme"[^>]*>LinkedIn</);
  assert.equal(so.includes("javascript:"), false, "an unsafe address is dropped");
  assert.equal(compileHtml(doc([{ type: "social", props: { links: [] } }])).includes("data-b=\"social\""), false, "no links, no row");
  const saved: Block = { type: "saved", props: { savedId: "blk_1", block: { type: "heading", props: { text: "Hello <b>", size: 30 } } } };
  const sv = compileHtml(doc([saved]));
  assert.match(sv, /<h1[^>]*font:700 30px/);
  assert.match(sv, /Hello &lt;b&gt;/);
  assert.equal(compileHtml(doc([{ type: "saved", props: {} }])).includes("<h1"), false, "a saved block with nothing in it is empty");
});

test("footer with unsub carries the links, and the plain text lists the social links and the saved block's words", () => {
  const html = compileHtml(doc([{ type: "footer", props: { text: "Acme, 410 Market", unsub: true } }]));
  assert.match(html, /\{\{unsubscribe_url\}\}/);
  assert.match(html, /\{\{preferences_url\}\}/);
  const text = compileText(doc([social, { type: "saved", props: { block: { type: "heading", props: { text: "Big news" } } } }]));
  assert.match(text, /LinkedIn: https:\/\/linkedin\.com\/company\/acme/);
  assert.match(text, /Big news/);
});
