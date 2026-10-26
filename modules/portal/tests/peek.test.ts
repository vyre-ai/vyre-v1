// portal.peek (peekLink): what the landing page of an invitation link may learn without spending the link. Used, expired, wrong-site, wrong-token and disabled-account links are all the same
// answer, null. The token is stored as a hash and the peek never changes a row.
// @reads /modules/portal/migrations/0001_portal_accounts.sql
import test from "node:test";
import assert from "node:assert/strict";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { handlers } from "../impl.ts";
import { peekLink } from "../handlers/extra/peek.ts";
import { NOW, OTHER_SITE, SITE, harness } from "../fixtures/world.ts";

type Fn = (ctx: Ctx, input: unknown) => Promise<unknown>;
const call = <T>(ctx: Ctx, cap: keyof typeof handlers, input: unknown): Promise<T> => (handlers[cap] as Fn)(ctx, input) as Promise<T>;

async function invited(w: ReturnType<typeof harness>, email = "pat@client.test") {
  const { account } = await call<{ account: { accountId: string } }>(w.ctx, "portal.account_create", { siteId: SITE, email, method: "magic_link" });
  return { accountId: account.accountId, token: w.mailer.last().token };
}

test("a good link tells who it is for and what is shared, and changes nothing", async () => {
  const w = harness();
  const { accountId, token } = await invited(w);
  const before = JSON.stringify(w.db.all("SELECT * FROM portal_magic"));
  const p = await peekLink(w.ctx, NOW, SITE, token);
  assert.ok(p);
  assert.deepEqual({ accountId: p.accountId, siteId: p.siteId, email: p.email, method: p.method, state: p.state, purpose: p.purpose }, { accountId, siteId: SITE, email: "pat@client.test", method: "magic_link", state: "invited", purpose: "invite" });
  assert.deepEqual(p.shared, { linked: false, recordTypes: [], fileLinks: 0 });
  assert.equal(JSON.stringify(w.db.all("SELECT * FROM portal_magic")), before, "peeking does not use the link up");
  assert.ok(await peekLink(w.ctx, NOW, SITE, token), "and it can be done again");
});

test("the token is stored hashed: no row, event or warning holds it", async () => {
  const w = harness();
  const { token } = await invited(w);
  const stored = JSON.stringify([w.db.all("SELECT * FROM portal_magic"), w.db.all("SELECT * FROM portal_account"), w.events, w.warnings]);
  assert.ok(!stored.includes(token));
});

test("an expired, wrong-site, wrong-token, used or disabled link is null, the same answer for every cause", async () => {
  const w = harness();
  const { accountId, token } = await invited(w);
  const expiresAt = (w.db.all("SELECT expires_at FROM portal_magic") as { expires_at: number }[])[0]!.expires_at;
  assert.equal(await peekLink(w.ctx, expiresAt, SITE, token), null, "at its expiry");
  assert.equal(await peekLink(w.ctx, expiresAt + 1, SITE, token), null, "after it");
  assert.equal(await peekLink(w.ctx, NOW, OTHER_SITE, token), null, "the right token on another site");
  assert.equal(await peekLink(w.ctx, NOW, SITE, `${token.slice(0, -1)}x`), null, "a wrong token");
  assert.equal(await peekLink(w.ctx, NOW, SITE, ""), null);
  assert.equal(await peekLink(w.ctx, NOW, SITE, "x".repeat(300)), null);
  await call(w.ctx, "portal.account_disable", { accountId });
  assert.equal(await peekLink(w.ctx, NOW, SITE, token), null, "a disabled account");
  const second = harness();
  const b = await invited(second, "sam@client.test");
  await call(second.ctx, "portal.sign_in", { siteId: SITE, email: "sam@client.test", token: b.token });
  assert.equal(await peekLink(second.ctx, NOW, SITE, b.token), null, "a used link");
});

test("a link is bound to its own account: another account's token on the same site does not reveal this one", async () => {
  const w = harness();
  const a = await invited(w, "a@client.test");
  const b = await invited(w, "b@client.test");
  assert.equal((await peekLink(w.ctx, NOW, SITE, a.token))?.email, "a@client.test");
  assert.equal((await peekLink(w.ctx, NOW, SITE, b.token))?.email, "b@client.test");
});
