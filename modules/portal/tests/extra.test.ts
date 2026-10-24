// portal extras: portal.file_link and portal.post (spec 3.6 Client portal; ARCH 7.6, 8.4).
// The accounts, sign-in and rules come from accounts.ts (P-L8_04); this file scripts the records, files and chat neighbours and checks the two new calls.
// The migration is data: @reads keeps ci-select on this test instead of the whole suite.
// @reads /modules/portal/migrations/0001_portal_accounts.sql

import test from "node:test";
import assert from "node:assert/strict";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { RowRule } from "../handlers/accounts.ts";
import { sha256hex } from "../handlers/accounts.ts";
import { extraHandlers, redeemFileLink } from "../handlers/extra/index.ts";
import { handlers } from "../impl.ts";
import { SITE, harness } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";

type Fn = (ctx: Ctx, input: unknown) => Promise<unknown>;
const run = async <T>(ctx: Ctx, cap: keyof typeof handlers, input: unknown): Promise<T> => (await (handlers[cap] as Fn)(ctx, input)) as T;
const extra = async <T>(ctx: Ctx, cap: keyof typeof extraHandlers, input: unknown): Promise<T> => (await (extraHandlers[cap] as Fn)(ctx, input)) as T;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof VyreErr) return e.error.code;
    throw e;
  }
  return "none";
}

const MINUTE = 60_000;
const RULES: RowRule[] = [
  { recordType: "contact", fields: ["name", "documents"] },
  { recordType: "matter", via: "client", linkedType: "contact", fields: ["title", "contract"] },
];

interface FileInfo { label: number; deletedAt?: number }

function rig() {
  const w: World = harness();
  w.addRecord({ id: "rec_dana", type: "contact", fields: { name: "Dana", documents: ["fil_a", "fil_conf", "fil_gone"], private_note: "fil_hidden" } });
  w.addRecord({ id: "rec_sam", type: "contact", fields: { name: "Sam", documents: ["fil_sam"] } });
  w.addRecord({ id: "rec_m1", type: "matter", fields: { client: "rec_dana", title: "Estate plan", contract: "fil_c", channel: "chn_m1" } });
  w.addRecord({ id: "rec_m2", type: "matter", fields: { client: "rec_dana", title: "No channel yet", contract: "fil_c2" } });
  w.addRecord({ id: "rec_m3", type: "matter", fields: { client: "rec_dana", title: "Closed", channel: "chn_closed" } });
  w.addRecord({ id: "rec_other", type: "matter", fields: { client: "rec_sam", title: "Sam's matter", contract: "fil_other", channel: "chn_other" } });
  const files = new Map<string, FileInfo>([
    ["fil_a", { label: 0 }], ["fil_conf", { label: 2 }], ["fil_gone", { label: 0, deletedAt: 5 }], ["fil_hidden", { label: 0 }], ["fil_c", { label: 1 }], ["fil_c2", { label: 0 }],
    ["fil_other", { label: 0 }], ["fil_sam", { label: 0 }],
  ]);
  const channels = new Map<string, { mainThreadId: string; archived: boolean }>([
    ["chn_m1", { mainThreadId: "thr_m1", archived: false }], ["chn_closed", { mainThreadId: "thr_closed", archived: true }], ["chn_other", { mainThreadId: "thr_other", archived: false }],
  ]);
  const posts: { threadId: string; body: string; principal: string }[] = [];
  const state = { failPost: false };
  const base = w.ctx.call.bind(w.ctx);
  w.ctx.call = async (cap, input, opts) => {
    const i = input as Record<string, unknown>;
    switch (cap) {
      case "records.query": {
        const filter = i.filter as { and: { field: string; value: unknown }[] };
        const rows = [...w.records.values()].filter((r) => r.type === i.type && filter.and.every((f) => r.fields[f.field] === f.value));
        return { rows: rows.map((r) => ({ id: r.id, type: r.type, fields: r.fields })) };
      }
      case "files.get": {
        const f = files.get(String(i.fileId));
        if (!f) throw new VyreErr({ code: "validation.not_found", message: "no file", retryable: false, traceId: "0123456789abcdef0123456789abcdef", next: [{ kind: "edit_input", label: "Fix the input" }] });
        return { file: { fileId: i.fileId, label: f.label, ...(f.deletedAt ? { deletedAt: f.deletedAt } : {}) } };
      }
      case "channels.get": {
        const c = channels.get(String(i.channelId));
        return { channel: { channelId: i.channelId, ...(c ?? { mainThreadId: "thr_x", archived: false }) } };
      }
      case "chat.post": {
        if (state.failPost) throw new Error("chat is down");
        posts.push({ threadId: String(i.threadId), body: String(i.body), principal: w.ctx.principal.id });
        return { message: { messageId: `msg_${posts.length}` } };
      }
      default:
        return base(cap, input, opts);
    }
  };
  return { w, files, posts, state };
}

type Rig = ReturnType<typeof rig>;

async function linked(r: Rig, rules: RowRule[] = RULES, email = "dana@client.example"): Promise<string> {
  const { w } = r;
  const acct = (await run<{ account: { accountId: string } }>(w.ctx, "portal.account_create", { siteId: SITE, email, method: "magic_link" })).account;
  await run(w.ctx, "portal.sign_in", { siteId: SITE, email, token: w.mailer.last().token });
  for (const rowRule of rules) await run(w.ctx, "portal.link_record", { accountId: acct.accountId, recordId: "rec_dana", rowRule });
  return acct.accountId;
}

const link = (r: Rig, accountId: string, fileId: string, expiresInMinutes = 30) => extra<{ url: string; expiresAt: number }>(r.w.ctx, "portal.file_link", { accountId, fileId, expiresInMinutes });
const post = (r: Rig, accountId: string, recordId: string, body = "Hello, a question about the plan.") => extra<{ messageId: string }>(r.w.ctx, "portal.post", { accountId, recordId, body });

// ---- file_link -----------------------------------------------------------------------------------------------

test("file_link: a file named by the linked record or a row it may see gets a short-lived link; only the token's hash is stored", async () => {
  const r = rig();
  const id = await linked(r);
  const a = await link(r, id, "fil_a", 30);
  assert.match(a.url, /^\/portal\/files\/[A-Za-z0-9_-]{43}$/);
  assert.equal(a.expiresAt, r.w.ctx.now() + 30 * MINUTE);
  const c = await link(r, id, "fil_c", 5);
  assert.equal(c.expiresAt, r.w.ctx.now() + 5 * MINUTE);
  const token = a.url.split("/").pop()!;
  const rows = r.w.db.rows("portal_magic").filter((m) => String(m.purpose).startsWith("file:"));
  assert.deepEqual(rows.map((m) => m.purpose).sort(), ["file:fil_a", "file:fil_c"]);
  for (const row of rows) for (const v of Object.values(row)) assert.notEqual(v, token);
  assert.equal(rows.find((m) => m.purpose === "file:fil_a")!.token_hash, await sha256hex(token));
  assert.deepEqual(await redeemFileLink(r.w.ctx, token), { fileId: "fil_a", accountId: id });
  assert.equal(r.w.names().length, 0, "no event: opening files is read access");
});

test("file_link: a file no visible record names is not found, however it was guessed", async () => {
  const r = rig();
  const id = await linked(r);
  assert.equal(await code(link(r, id, "fil_other")), "permission.not_found", "another client's matter");
  assert.equal(await code(link(r, id, "fil_sam")), "permission.not_found", "another client's record");
  assert.equal(await code(link(r, id, "fil_hidden")), "permission.not_found", "named only in a field the row rule hides");
  assert.equal(await code(link(r, id, "fil_unknown")), "permission.not_found");
  assert.equal(await code(link(r, id, "not-a-file")), "validation.bad_input");
  assert.equal(r.w.db.rows("portal_magic").filter((m) => String(m.purpose).startsWith("file:")).length, 0);
  const narrow = await linked(r, [{ recordType: "contact", fields: ["name"] }], "sam@client.example");
  assert.equal(await code(link(r, narrow, "fil_a")), "permission.not_found", "the rule cuts the documents field");
});

test("file_link: Confidential and Restricted files are never linked, and a deleted file is gone", async () => {
  const r = rig();
  const id = await linked(r);
  assert.equal(await code(link(r, id, "fil_conf")), "permission.above_clearance");
  assert.equal(await code(link(r, id, "fil_gone")), "validation.not_found");
  r.files.set("fil_a", { label: 3 });
  assert.equal(await code(link(r, id, "fil_a")), "permission.above_clearance");
});

test("file_link: invited, disabled, unlinked and unknown accounts get nothing", async () => {
  const r = rig();
  const { w } = r;
  const invited = (await run<{ account: { accountId: string } }>(w.ctx, "portal.account_create", { siteId: SITE, email: "new@client.example", method: "magic_link" })).account.accountId;
  assert.equal(await code(link(r, invited, "fil_a")), "permission.no_grant");
  const active = (await run<{ account: { accountId: string } }>(w.ctx, "portal.account_create", { siteId: SITE, email: "free@client.example", method: "magic_link" })).account.accountId;
  await run(w.ctx, "portal.sign_in", { siteId: SITE, email: "free@client.example", token: w.mailer.last().token });
  assert.equal(await code(link(r, active, "fil_a")), "validation.precondition_failed");
  assert.equal(await code(link(r, "pac_missing", "fil_a")), "validation.not_found");
  const id = await linked(r);
  await run(w.ctx, "portal.account_disable", { accountId: id });
  assert.equal(await code(link(r, id, "fil_a")), "permission.suspended");
});

test("file_link: lifetime is 1 minute to 24 hours", async () => {
  const r = rig();
  const id = await linked(r);
  for (const bad of [0, -5, 1441, 1.5, "30", null]) assert.equal(await code(extra(r.w.ctx, "portal.file_link", { accountId: id, fileId: "fil_a", expiresInMinutes: bad })), "validation.bad_input", String(bad));
  assert.equal((await link(r, id, "fil_a", 1)).expiresAt, r.w.ctx.now() + MINUTE);
  assert.equal((await link(r, id, "fil_a", 1440)).expiresAt, r.w.ctx.now() + 1440 * MINUTE);
  assert.equal(await code(extra(r.w.ctx, "portal.file_link", { accountId: id, fileId: "fil_a" })), "validation.bad_input");
});

test("redeemFileLink: expired, unknown, wrong-purpose and disabled-account links are all the same refusal", async () => {
  const r = rig();
  const id = await linked(r);
  const first = await link(r, id, "fil_a", 10);
  const token = first.url.split("/").pop()!;
  assert.equal((await redeemFileLink(r.w.ctx, token)).fileId, "fil_a");
  assert.equal((await redeemFileLink(r.w.ctx, token)).fileId, "fil_a", "a link can be opened again until it expires");
  assert.equal(await code(redeemFileLink(r.w.ctx, "nonsense")), "auth.invalid_code");
  assert.equal(await code(redeemFileLink(r.w.ctx, "")), "auth.invalid_code");
  assert.equal(await code(redeemFileLink(r.w.ctx, "x".repeat(300))), "auth.invalid_code");
  const invite = r.w.mailer.sent[0]!.token;
  assert.equal(await code(redeemFileLink(r.w.ctx, invite)), "auth.invalid_code", "a sign-in token is not a file link");
  r.w.advance(10 * MINUTE);
  assert.equal(await code(redeemFileLink(r.w.ctx, token)), "auth.invalid_code");
  const fresh = (await link(r, id, "fil_a", 10)).url.split("/").pop()!;
  await run(r.w.ctx, "portal.account_disable", { accountId: id });
  assert.equal(await code(redeemFileLink(r.w.ctx, fresh)), "auth.invalid_code");
});

test("file_link: expired links of the account are dropped on the next call", async () => {
  const r = rig();
  const id = await linked(r);
  await link(r, id, "fil_a", 1);
  await link(r, id, "fil_c", 60);
  r.w.advance(5 * MINUTE);
  await link(r, id, "fil_a", 30);
  assert.deepEqual(r.w.db.rows("portal_magic").filter((m) => String(m.purpose).startsWith("file:")).map((m) => m.purpose).sort(), ["file:fil_a", "file:fil_c"]);
  assert.equal(r.w.db.rows("portal_magic").filter((m) => m.purpose === "invite").length, 1, "other tokens are left alone");
});

// ---- post -----------------------------------------------------------------------------------------------------

test("post: lands in the record's channel main thread, names the outside account, and fires portal.message_posted", async () => {
  const r = rig();
  const id = await linked(r);
  const out = await post(r, id, "rec_m1", "  Can you check clause 4?  ");
  assert.equal(out.messageId, "msg_1");
  assert.equal(r.posts.length, 1);
  assert.equal(r.posts[0]!.threadId, "thr_m1");
  assert.equal(r.posts[0]!.body, "From dana@client.example (client portal)\n\nCan you check clause 4?");
  assert.equal(r.posts[0]!.principal, "usr_owner", "the call runs as the site identity, not as a Space member named after the visitor");
  assert.deepEqual(r.w.events.map((e) => [e.name, e.subject, e.payload]), [["portal.message_posted", "record/rec_m1", { accountId: id, recordId: "rec_m1", messageId: "msg_1" }]]);
});

test("post: only the account's own record or rows its rules show; anything else is not found", async () => {
  const r = rig();
  const id = await linked(r);
  assert.equal(await code(post(r, id, "rec_other")), "permission.not_found");
  assert.equal(await code(post(r, id, "rec_sam")), "permission.not_found");
  assert.equal(await code(post(r, id, "rec_missing")), "permission.not_found");
  assert.equal(r.posts.length, 0);
  const only = await linked(r, [{ recordType: "contact" }], "sam@client.example");
  assert.equal(await code(post(r, only, "rec_m1")), "permission.not_found", "no rule shows matters to this account");
});

test("post: a record with no channel, or a closed one, has no conversation to post into", async () => {
  const r = rig();
  const id = await linked(r);
  assert.equal(await code(post(r, id, "rec_m2")), "validation.precondition_failed");
  assert.equal(await code(post(r, id, "rec_m3")), "validation.precondition_failed");
  assert.equal(r.posts.length, 0);
  assert.equal(r.w.events.length, 0);
});

test("post: empty, oversized and NUL bodies are refused; invited, disabled and unlinked accounts cannot post", async () => {
  const r = rig();
  const id = await linked(r);
  for (const body of ["", "   ", "x".repeat(10_001), "a\u0000b"]) assert.equal(await code(post(r, id, "rec_m1", body)), "validation.bad_input");
  assert.equal(await code(extra(r.w.ctx, "portal.post", { accountId: id, recordId: "rec_m1" })), "validation.bad_input");
  const invited = (await run<{ account: { accountId: string } }>(r.w.ctx, "portal.account_create", { siteId: SITE, email: "new@client.example", method: "magic_link" })).account.accountId;
  assert.equal(await code(post(r, invited, "rec_m1")), "permission.no_grant");
  await run(r.w.ctx, "portal.account_disable", { accountId: id });
  assert.equal(await code(post(r, id, "rec_m1")), "permission.suspended");
  assert.equal(r.posts.length, 0);
});

test("post: 20 posts in 15 minutes per account; refused calls do not count; the window passes", async () => {
  const r = rig();
  const id = await linked(r);
  for (let n = 0; n < 5; n++) assert.equal(await code(post(r, id, "rec_other")), "permission.not_found");
  for (let n = 0; n < 20; n++) await post(r, id, "rec_m1", `message ${n}`);
  assert.equal(await code(post(r, id, "rec_m1")), "rate_limit.exceeded");
  assert.equal(r.posts.length, 20);
  r.w.advance(15 * MINUTE);
  await post(r, id, "rec_m1", "after the window");
  assert.equal(r.posts.length, 21);
});

test("post: another account has its own allowance", async () => {
  const r = rig();
  const a = await linked(r);
  for (let n = 0; n < 20; n++) await post(r, a, "rec_m1", `message ${n}`);
  const b = await linked(r, RULES, "dana2@client.example");
  assert.equal(await code(post(r, a, "rec_m1")), "rate_limit.exceeded");
  await post(r, b, "rec_m1", "from the second login");
});

test("post: a chat failure posts nothing, fires nothing and uses no allowance", async () => {
  const r = rig();
  const id = await linked(r);
  r.state.failPost = true;
  for (let n = 0; n < 25; n++) await assert.rejects(post(r, id, "rec_m1"), /chat is down/);
  r.state.failPost = false;
  assert.equal(r.w.events.length, 0);
  assert.equal((await post(r, id, "rec_m1")).messageId, "msg_1");
});
