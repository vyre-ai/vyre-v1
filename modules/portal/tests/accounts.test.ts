// portal: outside accounts of a site, sign-in (magic link and password), record links with row rules, and what an account can see (spec 2.20, 3.6; ARCH 7.6).
// The migration is data: @reads keeps ci-select on this test instead of the whole suite.
// @reads /modules/portal/migrations/0001_portal_accounts.sql

import test from "node:test";
import assert from "node:assert/strict";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { configurePortal, filterRecords, resolveSession, sha256hex, verifyPassword } from "../handlers/accounts.ts";
import type { PortalRecord, RowRule } from "../handlers/accounts.ts";
import { handlers } from "../impl.ts";
import { OTHER_SITE, SITE, harness } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";

type Fn = (ctx: Ctx, input: unknown) => Promise<unknown>;
const call = (cap: keyof typeof handlers): Fn => handlers[cap] as Fn;

async function run<T>(ctx: Ctx, cap: keyof typeof handlers, input: unknown): Promise<T> {
  return (await call(cap)(ctx, input)) as T;
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof VyreErr) return e.error.code;
    throw e;
  }
  return "none";
}

interface AccountOut { accountId: string; siteId: string; email: string; state: string; recordId?: string }

async function create(w: World, email = "dana@client.example", method: "magic_link" | "password" = "magic_link", siteId = SITE): Promise<AccountOut> {
  return (await run<{ account: AccountOut }>(w.ctx, "portal.account_create", { siteId, email, method })).account;
}

/** Create an account and finish the invite so it can sign in. */
async function active(w: World, email = "dana@client.example", method: "magic_link" | "password" = "magic_link", password?: string): Promise<AccountOut> {
  const a = await create(w, email, method);
  const input: Record<string, unknown> = { siteId: a.siteId, email, token: w.mailer.last().token };
  if (password !== undefined) input.password = password;
  await run(w.ctx, "portal.sign_in", input);
  return { ...a, state: "active" };
}

const PASSWORD = "correct horse battery";

function allStrings(w: World): string[] {
  const out: string[] = [];
  for (const t of ["portal_account", "portal_link", "portal_magic", "portal_session", "portal_attempt"]) {
    for (const row of w.db.rows(t)) for (const v of Object.values(row)) if (typeof v === "string") out.push(v);
  }
  return out;
}

// ---- account_create -----------------------------------------------------------------------------------------

test("account_create: an invited account, one invite link mailed, event on the site, no password yet", async () => {
  const w = harness();
  const a = await create(w, "  Dana@Client.Example ");
  assert.match(a.accountId, /^pac_[a-z0-9]+$/);
  assert.equal(a.email, "dana@client.example");
  assert.equal(a.siteId, SITE);
  assert.equal(a.state, "invited");
  assert.equal(a.recordId, undefined);
  assert.equal(w.mailer.sent.length, 1);
  const m = w.mailer.last();
  assert.deepEqual({ siteId: m.siteId, accountId: m.accountId, email: m.email, purpose: m.purpose }, { siteId: SITE, accountId: a.accountId, email: "dana@client.example", purpose: "invite" });
  assert.equal(m.expiresAt, w.ctx.now() + 7 * 24 * 3600_000);
  assert.deepEqual(w.events.map((e) => [e.name, e.subject, e.payload]), [["portal.account_created", `site/${SITE}`, { accountId: a.accountId, siteId: SITE }]]);
  const row = w.db.rows("portal_account")[0]!;
  assert.equal(row.password_hash, null);
  assert.equal(row.created_by, "usr_owner");
});

test("account_create: the same email is allowed on another site, refused twice on one, and a bad address, method or site is refused", async () => {
  const w = harness();
  await create(w);
  assert.equal(await code(create(w, "DANA@client.example")), "validation.duplicate");
  await create(w, "dana@client.example", "password", OTHER_SITE);
  assert.equal(w.db.rows("portal_account").length, 2);
  for (const bad of ["", "dana", "dana@", "@client.example", "a b@client.example", "dana@client", "x".repeat(250) + "@client.example"]) {
    assert.equal(await code(create(w, bad)), "validation.bad_input", bad);
  }
  assert.equal(await code(run(w.ctx, "portal.account_create", { siteId: SITE, email: "x@client.example", method: "sms" })), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "portal.account_create", { siteId: "sit_gone0000", email: "x@client.example", method: "password" })), "validation.not_found");
  assert.equal(w.db.rows("portal_account").length, 2, "refused calls leave nothing behind");
});

test("account_create: a mail failure leaves no account and no link; no mailer is a precondition", async () => {
  const w = harness();
  w.mailer.failWith = "smtp down";
  assert.equal(await code(create(w)), "validation.precondition_failed");
  assert.equal(w.db.rows("portal_account").length, 0);
  assert.equal(w.db.rows("portal_magic").length, 0);
  assert.equal(w.names().length, 0);
  assert.ok(w.warnings.some((x) => x.includes("link email failed")));
  const bare = harness({ configure: false });
  assert.equal(await code(create(bare)), "validation.precondition_failed");
  assert.equal(await code(run(bare.ctx, "portal.sign_in", { siteId: SITE, email: "a@b.example" })), "validation.precondition_failed");
});

// ---- sign_in: magic link ------------------------------------------------------------------------------------

test("sign_in with the invite token: the account is active, a session is returned, the link works once", async () => {
  const w = harness();
  const a = await create(w);
  const token = w.mailer.last().token;
  const out = await run<{ session: string }>(w.ctx, "portal.sign_in", { siteId: SITE, email: "dana@client.example", token });
  assert.match(out.session, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(w.db.rows("portal_account")[0]!.state, "active");
  assert.deepEqual(w.events.filter((e) => e.name === "portal.signed_in").map((e) => e.payload), [{ accountId: a.accountId, siteId: SITE }]);
  assert.equal(await code(run(w.ctx, "portal.sign_in", { siteId: SITE, email: "dana@client.example", token })), "auth.invalid_code");
  const scope = await resolveSession(w.ctx, out.session);
  assert.equal(scope.accountId, a.accountId);
  assert.equal(scope.siteId, SITE);
});

test("sign_in with a token: wrong, expired, another account's and another site's tokens are refused the same way", async () => {
  const w = harness();
  const a = await create(w, "a@client.example");
  const tokenA = w.mailer.last().token;
  await create(w, "b@client.example");
  const tokenB = w.mailer.last().token;
  const signIn = (email: string, token: string, siteId = SITE) => code(run(w.ctx, "portal.sign_in", { siteId, email, token }));
  assert.equal(await signIn("a@client.example", "nope"), "auth.invalid_code");
  assert.equal(await signIn("a@client.example", tokenB), "auth.invalid_code");
  assert.equal(await signIn("a@client.example", tokenA, OTHER_SITE), "auth.invalid_code");
  assert.equal(await signIn("nobody@client.example", tokenA), "auth.invalid_code");
  w.advance(7 * 24 * 3600_000 + 1);
  assert.equal(await signIn("a@client.example", tokenA), "auth.invalid_code");
  assert.equal(w.db.rows("portal_account").find((r) => r.id === a.accountId)!.state, "invited");
});

test("sign_in: a link account cannot be given a password, and a password account must choose one", async () => {
  const w = harness();
  await create(w, "link@client.example", "magic_link");
  assert.equal(await code(run(w.ctx, "portal.sign_in", { siteId: SITE, email: "link@client.example", token: w.mailer.last().token, password: PASSWORD })), "validation.bad_input");
  assert.equal(w.db.rows("portal_magic")[0]!.used_at, null, "a refused call does not use up the link");
  await create(w, "pw@client.example", "password");
  const token = w.mailer.last().token;
  assert.equal(await code(run(w.ctx, "portal.sign_in", { siteId: SITE, email: "pw@client.example", token })), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "portal.sign_in", { siteId: SITE, email: "pw@client.example", token, password: "short" })), "validation.bad_input");
  const ok = await run<{ session: string }>(w.ctx, "portal.sign_in", { siteId: SITE, email: "pw@client.example", token, password: PASSWORD });
  assert.ok(ok.session);
});

test("sign_in with no secret sends a link, and says the same thing for an address with no account", async () => {
  const w = harness();
  await active(w, "dana@client.example");
  const before = w.mailer.sent.length;
  const known = await run<{ session: string }>(w.ctx, "portal.sign_in", { siteId: SITE, email: "dana@client.example" });
  const unknown = await run<{ session: string }>(w.ctx, "portal.sign_in", { siteId: SITE, email: "ghost@client.example" });
  assert.deepEqual(known, { session: "" });
  assert.deepEqual(unknown, { session: "" });
  assert.equal(w.mailer.sent.length, before + 1, "only the real account got mail");
  const m = w.mailer.last();
  assert.equal(m.purpose, "sign_in");
  assert.equal(m.expiresAt, w.ctx.now() + 15 * 60_000);
  const session = await run<{ session: string }>(w.ctx, "portal.sign_in", { siteId: SITE, email: "dana@client.example", token: m.token });
  assert.ok(session.session);
});

test("sign_in: link requests are rate limited per address, real or not, and the window ends", async () => {
  const w = harness();
  await active(w);
  for (let i = 0; i < 5; i++) await run(w.ctx, "portal.sign_in", { siteId: SITE, email: "ghost@client.example" });
  assert.equal(await code(run(w.ctx, "portal.sign_in", { siteId: SITE, email: "ghost@client.example" })), "rate_limit.exceeded");
  assert.equal(await code(run(w.ctx, "portal.sign_in", { siteId: SITE, email: "dana@client.example" })), "none", "another address has its own count");
  w.advance(15 * 60_000);
  assert.equal(await code(run(w.ctx, "portal.sign_in", { siteId: SITE, email: "ghost@client.example" })), "none");
});

// ---- sign_in: password --------------------------------------------------------------------------------------

test("password account: the invite sets the password, then it signs in; wrong password and unknown email look the same", async () => {
  const w = harness();
  const a = await active(w, "dana@client.example", "password", PASSWORD);
  const stored = String(w.db.rows("portal_account")[0]!.password_hash);
  assert.match(stored, /^pbkdf2-sha256\$1000\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  assert.ok(!stored.includes(PASSWORD));
  assert.equal(await verifyPassword(PASSWORD, stored), true);
  assert.equal(await verifyPassword("wrong password!!", stored), false);
  const ok = await run<{ session: string }>(w.ctx, "portal.sign_in", { siteId: SITE, email: "DANA@client.example", password: PASSWORD });
  assert.equal((await resolveSession(w.ctx, ok.session)).accountId, a.accountId);
  const wrong = await code(run(w.ctx, "portal.sign_in", { siteId: SITE, email: "dana@client.example", password: "not the password" }));
  const ghost = await code(run(w.ctx, "portal.sign_in", { siteId: SITE, email: "ghost@client.example", password: PASSWORD }));
  assert.equal(wrong, "auth.bad_credentials");
  assert.equal(ghost, "auth.bad_credentials");
});

test("password account: five wrong tries lock the address for the window, a right password clears the count, a reset link sets a new one", async () => {
  const w = harness();
  await active(w, "dana@client.example", "password", PASSWORD);
  const bad = () => code(run(w.ctx, "portal.sign_in", { siteId: SITE, email: "dana@client.example", password: "wrong password!!" }));
  for (let i = 0; i < 4; i++) assert.equal(await bad(), "auth.bad_credentials");
  assert.equal((await run<{ session: string }>(w.ctx, "portal.sign_in", { siteId: SITE, email: "dana@client.example", password: PASSWORD })).session.length > 0, true);
  for (let i = 0; i < 5; i++) assert.equal(await bad(), "auth.bad_credentials");
  assert.equal(await bad(), "rate_limit.exceeded");
  assert.equal(await code(run(w.ctx, "portal.sign_in", { siteId: SITE, email: "dana@client.example", password: PASSWORD })), "rate_limit.exceeded", "even the right password waits");
  w.advance(15 * 60_000);
  assert.equal(await code(run(w.ctx, "portal.sign_in", { siteId: SITE, email: "dana@client.example", password: PASSWORD })), "none");
  // forgot password: a link, then a new password
  await run(w.ctx, "portal.sign_in", { siteId: SITE, email: "dana@client.example" });
  assert.equal(w.mailer.last().purpose, "reset");
  await run(w.ctx, "portal.sign_in", { siteId: SITE, email: "dana@client.example", token: w.mailer.last().token, password: "a brand new password" });
  assert.equal(await code(run(w.ctx, "portal.sign_in", { siteId: SITE, email: "dana@client.example", password: PASSWORD })), "auth.bad_credentials");
  assert.equal(await code(run(w.ctx, "portal.sign_in", { siteId: SITE, email: "dana@client.example", password: "a brand new password" })), "none");
});

test("password sign-in for a link account or an account that never finished its invite is refused", async () => {
  const w = harness();
  await active(w, "link@client.example", "magic_link");
  await create(w, "new@client.example", "password");
  for (const email of ["link@client.example", "new@client.example"]) {
    assert.equal(await code(run(w.ctx, "portal.sign_in", { siteId: SITE, email, password: PASSWORD })), "auth.bad_credentials", email);
  }
});

// ---- link_record and row rules ------------------------------------------------------------------------------

const CLIENT_RULE = { recordType: "matter", via: "client", linkedType: "contact" };

test("link_record: the account is linked to a contact with a row rule; the record is checked and the event names it", async () => {
  const w = harness();
  const a = await active(w);
  w.addRecord({ id: "rec_dana", type: "contact", fields: { name: "Dana" } });
  const out = await run<{ ok: boolean }>(w.ctx, "portal.link_record", { accountId: a.accountId, recordId: "rec_dana", rowRule: CLIENT_RULE });
  assert.deepEqual(out, { ok: true });
  assert.deepEqual(w.calls.filter((c) => c.cap === "records.get").map((c) => c.input), [{ type: "contact", recordId: "rec_dana" }]);
  assert.equal(w.db.rows("portal_account")[0]!.record_id, "rec_dana");
  assert.deepEqual(w.events.filter((e) => e.name === "portal.record_linked").map((e) => [e.subject, e.payload]), [["record/rec_dana", { accountId: a.accountId, recordId: "rec_dana" }]]);
  const listed = await run<{ accounts: AccountOut[] }>(w.ctx, "portal.accounts", { siteId: SITE });
  assert.equal(listed.accounts[0]!.recordId, "rec_dana");
  const rules = await run<{ rules: { accountId: string; recordType: string; rule: RowRule }[] }>(w.ctx, "portal.rules", { siteId: SITE });
  assert.deepEqual(rules.rules, [{ accountId: a.accountId, recordType: "matter", rule: CLIENT_RULE }]);
});

test("link_record: a rule for the same type replaces the old one, another type adds, another record starts over", async () => {
  const w = harness();
  const a = await active(w);
  w.addRecord({ id: "rec_dana", type: "contact", fields: {} });
  w.addRecord({ id: "rec_sam", type: "contact", fields: {} });
  const link = (recordId: string, rowRule: unknown) => run(w.ctx, "portal.link_record", { accountId: a.accountId, recordId, rowRule });
  await link("rec_dana", CLIENT_RULE);
  await link("rec_dana", { ...CLIENT_RULE, fields: ["title", "status"] });
  await link("rec_dana", { recordType: "contact" });
  assert.deepEqual(w.db.rows("portal_link").map((r) => r.record_type).sort(), ["contact", "matter"]);
  assert.deepEqual(JSON.parse(String(w.db.rows("portal_link").find((r) => r.record_type === "matter")!.rule)).fields, ["title", "status"]);
  await link("rec_sam", { recordType: "contact" });
  assert.deepEqual(w.db.rows("portal_link").map((r) => r.record_type), ["contact"], "the old record's rules are gone");
  assert.equal(w.db.rows("portal_account")[0]!.record_id, "rec_sam");
});

test("link_record: bad rules, a missing record, a missing account and a disabled account are refused and change nothing", async () => {
  const w = harness();
  const a = await active(w);
  w.addRecord({ id: "rec_dana", type: "contact", fields: {} });
  const link = (accountId: string, recordId: string, rowRule: unknown) => code(run(w.ctx, "portal.link_record", { accountId, recordId, rowRule }));
  for (const bad of [null, "matter", [], {}, { recordType: "Matter" }, { recordType: "matter", via: "client" }, { recordType: "matter", via: "x", linkedType: "contact", extra: 1 },
    { recordType: "matter", fields: [] }, { recordType: "matter", fields: [1] }, { recordType: "matter", via: "a;b", linkedType: "contact" }]) {
    assert.equal(await link(a.accountId, "rec_dana", bad), "validation.bad_input", JSON.stringify(bad));
  }
  assert.equal(await link(a.accountId, "rec_missing", CLIENT_RULE), "validation.not_found");
  assert.equal(await link(a.accountId, "rec_dana", { recordType: "matter", via: "client", linkedType: "company" }), "validation.not_found", "the record has another type");
  assert.equal(await link("pac_gone", "rec_dana", CLIENT_RULE), "validation.not_found");
  await run(w.ctx, "portal.account_disable", { accountId: a.accountId });
  assert.equal(await link(a.accountId, "rec_dana", CLIENT_RULE), "validation.precondition_failed");
  assert.equal(w.db.rows("portal_link").length, 0);
  assert.equal(w.db.rows("portal_account")[0]!.record_id, null);
  assert.equal(w.names().includes("portal.record_linked"), false);
});

const MATTERS: PortalRecord[] = [
  { id: "rec_m1", type: "matter", fields: { title: "Estate of Dana", status: "open", client: "rec_dana", fee: 5000 } },
  { id: "rec_m2", type: "matter", fields: { title: "Sam closing", status: "open", client: "rec_sam", fee: 900 } },
  { id: "rec_m3", type: "matter", fields: { title: "Joint trust", status: "open", client: ["rec_dana", "rec_sam"], fee: 1200 } },
  { id: "rec_dana", type: "contact", fields: { name: "Dana", phone: "555-0101" } },
  { id: "rec_sam", type: "contact", fields: { name: "Sam", phone: "555-0102" } },
  { id: "rec_t1", type: "task", fields: { client: "rec_dana", title: "Internal note" } },
];

test("portal account sees only linked records", async () => {
  const w = harness();
  const dana = await active(w, "dana@client.example");
  const sam = await active(w, "sam@client.example");
  w.addRecord({ id: "rec_dana", type: "contact", fields: {} });
  w.addRecord({ id: "rec_sam", type: "contact", fields: {} });
  const rules = [CLIENT_RULE, { recordType: "contact" }];
  for (const r of rules) await run(w.ctx, "portal.link_record", { accountId: dana.accountId, recordId: "rec_dana", rowRule: r });
  for (const r of rules) await run(w.ctx, "portal.link_record", { accountId: sam.accountId, recordId: "rec_sam", rowRule: r });
  const session = async (email: string): Promise<string> => {
    await run(w.ctx, "portal.sign_in", { siteId: SITE, email });
    return (await run<{ session: string }>(w.ctx, "portal.sign_in", { siteId: SITE, email, token: w.mailer.last().token })).session;
  };
  const d = await resolveSession(w.ctx, await session("dana@client.example"));
  const s = await resolveSession(w.ctx, await session("sam@client.example"));
  assert.equal(d.recordId, "rec_dana");
  const ids = (scope: typeof d) => filterRecords(scope.rules, scope.recordId, MATTERS).map((r) => r.id);
  assert.deepEqual(ids(d), ["rec_m1", "rec_m3", "rec_dana"], "own matters (also the joint one) and own contact, nothing of Sam's, no tasks");
  assert.deepEqual(ids(s), ["rec_m2", "rec_m3", "rec_sam"]);
  assert.equal(filterRecords(d.rules, d.recordId, MATTERS).some((r) => r.id === "rec_t1"), false, "a type with no rule is invisible");
});

test("row rules: field allow lists cut fields, no linked record means nothing, a rule never reaches across types", () => {
  const rules: RowRule[] = [{ recordType: "matter", via: "client", linkedType: "contact", fields: ["title", "status"] }];
  const out = filterRecords(rules, "rec_dana", MATTERS);
  assert.deepEqual(out.map((r) => [r.id, Object.keys(r.fields)]), [["rec_m1", ["title", "status"]], ["rec_m3", ["title", "status"]]]);
  assert.deepEqual(filterRecords(rules, null, MATTERS), []);
  assert.deepEqual(filterRecords([], "rec_dana", MATTERS), []);
  // filtering copies: the source rows are not changed
  assert.equal(MATTERS[0]!.fields.fee, 5000);
  const self = filterRecords([{ recordType: "contact" }], "rec_dana", MATTERS);
  assert.deepEqual(self.map((r) => r.id), ["rec_dana"]);
  assert.deepEqual(self[0]!.fields, { name: "Dana", phone: "555-0101" });
});

// ---- sessions -----------------------------------------------------------------------------------------------

test("sessions: separate rows from Space members; unknown, expired and revoked tokens are refused", async () => {
  const w = harness();
  const a = await active(w);
  w.calls.length = 0;
  await run(w.ctx, "portal.sign_in", { siteId: SITE, email: "dana@client.example" });
  const { session } = await run<{ session: string }>(w.ctx, "portal.sign_in", { siteId: SITE, email: "dana@client.example", token: w.mailer.last().token });
  assert.equal(w.calls.length, 0, "signing in calls no Space module: there is no principal to resolve");
  const hash = await sha256hex(session);
  const row = w.db.rows("portal_session").find((r) => r.token_hash === hash)!;
  assert.deepEqual(Object.keys(row).sort(), ["account_id", "created_at", "expires_at", "revoked_at", "site_id", "token_hash"]);
  assert.equal(row.account_id, a.accountId);
  assert.equal(await code(resolveSession(w.ctx, "made-up")), "auth.unauthenticated");
  w.advance(14 * 24 * 3600_000 + 1);
  assert.equal(await code(resolveSession(w.ctx, session)), "auth.expired");
});

test("disable: sessions end, pending links die, sign-in is refused, and doing it twice is fine", async () => {
  const w = harness();
  const a = await active(w);
  const request = async (): Promise<string> => {
    await run(w.ctx, "portal.sign_in", { siteId: SITE, email: "dana@client.example" });
    return w.mailer.last().token;
  };
  const unused = await request();
  const { session } = await run<{ session: string }>(w.ctx, "portal.sign_in", { siteId: SITE, email: "dana@client.example", token: await request() });
  assert.ok(await resolveSession(w.ctx, session));
  assert.deepEqual(await run(w.ctx, "portal.account_disable", { accountId: a.accountId }), { ok: true });
  assert.equal(await code(resolveSession(w.ctx, session)), "auth.unauthenticated");
  assert.equal(await code(run(w.ctx, "portal.sign_in", { siteId: SITE, email: "dana@client.example", token: unused })), "auth.invalid_code");
  const before = w.mailer.sent.length;
  assert.deepEqual(await run(w.ctx, "portal.sign_in", { siteId: SITE, email: "dana@client.example" }), { session: "" });
  assert.equal(w.mailer.sent.length, before, "a disabled account gets no link");
  assert.deepEqual(await run(w.ctx, "portal.account_disable", { accountId: a.accountId }), { ok: true });
  assert.equal(w.db.rows("portal_account")[0]!.state, "disabled");
  assert.equal(await code(run(w.ctx, "portal.account_disable", { accountId: "pac_gone" })), "validation.not_found");
});

// ---- lists --------------------------------------------------------------------------------------------------

test("accounts: a site's accounts in creation order with paging; rules are per site", async () => {
  const w = harness();
  for (let i = 0; i < 5; i++) {
    await create(w, `p${i}@client.example`);
    w.advance(1000);
  }
  await create(w, "other@client.example", "magic_link", OTHER_SITE);
  const page1 = await run<{ accounts: AccountOut[]; next?: string; total: number }>(w.ctx, "portal.accounts", { siteId: SITE, limit: 2 });
  assert.deepEqual(page1.accounts.map((a) => a.email), ["p0@client.example", "p1@client.example"]);
  assert.equal(page1.total, 5);
  assert.equal(page1.next, "2");
  const page3 = await run<{ accounts: AccountOut[]; next?: string }>(w.ctx, "portal.accounts", { siteId: SITE, limit: 2, cursor: "4" });
  assert.deepEqual(page3.accounts.map((a) => a.email), ["p4@client.example"]);
  assert.equal(page3.next, undefined);
  assert.equal(await code(run(w.ctx, "portal.accounts", { siteId: SITE, cursor: "x" })), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "portal.accounts", { siteId: SITE, limit: 0 })), "validation.bad_input");
  assert.deepEqual((await run<{ rules: unknown[] }>(w.ctx, "portal.rules", { siteId: SITE })).rules, []);
  assert.equal(await code(run(w.ctx, "portal.rules", { siteId: "sit_gone0000" })), "validation.not_found");
});

// ---- secrets ------------------------------------------------------------------------------------------------

test("no token or password is stored in the clear: links and sessions are SHA-256 hashes, the password is PBKDF2", async () => {
  const w = harness();
  await create(w, "dana@client.example", "password");
  const invite = w.mailer.last().token;
  await run(w.ctx, "portal.sign_in", { siteId: SITE, email: "dana@client.example", token: invite, password: PASSWORD });
  const { session } = await run<{ session: string }>(w.ctx, "portal.sign_in", { siteId: SITE, email: "dana@client.example", password: PASSWORD });
  const stored = allStrings(w);
  for (const secret of [invite, session, PASSWORD]) assert.equal(stored.some((s) => s.includes(secret)), false);
  assert.ok(stored.includes(await sha256hex(invite)));
  assert.ok(stored.includes(await sha256hex(session)));
  assert.equal(JSON.stringify(w.events).includes(invite), false, "events carry no token");
});

test("cleanup", () => {
  configurePortal(null);
});
