// A refreshed CLI sign-in is saved back only when it is still a sign-in of the same account and newer than what the Vault holds now: a refresh is saved, an unchanged file is not, another account and a
// sign-out are refused, and of two turns that refreshed at once the newest wins by the sign-in's own clock, whichever save arrives last. The files wait under a single-use ticket; no value is logged.
import test from "node:test";
import assert from "node:assert/strict";
import { compareFresh, createSigninRefresh, decideRefresh, providerOfFiles, readSignin } from "./signin-refresh.ts";

const jwt = (claims: Record<string, unknown>): string => `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
const idToken = (account: string): string => jwt({ email: "dana@example.com", "https://api.openai.com/auth": { chatgpt_account_id: account, chatgpt_user_id: "u-1" } });
const ACCESS = ["codex-access-ONE-0123456789abcdef", "codex-access-TWO-0123456789abcdef", "codex-access-THREE-0123456789abcd"]; // secret-scan: fake
/** A Codex file map as `codex login` writes it, refreshed at `at`. */
const codex = (access: string, at: string, account = "acct-1", extra: Record<string, unknown> = {}): Record<string, string> =>
  ({ ".codex/auth.json": JSON.stringify({ OPENAI_API_KEY: null, tokens: { id_token: idToken(account), access_token: access, refresh_token: `rt-${access}`, account_id: account }, last_refresh: at, ...extra }) });
const T0 = "2026-10-01T10:00:00.000Z", T1 = "2026-10-01T11:00:00.000Z", T2 = "2026-10-01T12:00:00.000Z";

test("a Codex file is a sign-in of the account its id token names, as fresh as its last refresh; one with no tokens is a sign-out", () => {
  const r = readSignin("codex", codex(ACCESS[0]!, T1));
  assert.deepEqual(r, { ok: true, identity: "chatgpt:acct:acct-1/user:u-1", fresh: { at: Date.parse(T1) } });
  assert.equal(JSON.stringify(r).includes(ACCESS[0]!), false, "no value comes out");
  // the access token's own expiry, when it is a JWT, decides before the refresh time
  const withExp = readSignin("codex", codex(jwt({ exp: 1_900_000_000 }), T0));
  assert.deepEqual(withExp.ok && withExp.fresh, { exp: 1_900_000_000_000, at: Date.parse(T0) });
  assert.deepEqual(readSignin("codex", { ".codex/auth.json": null }), { ok: false, why: "signed_out" }, "the file is gone (codex logout)");
  assert.deepEqual(readSignin("codex", { ".codex/auth.json": JSON.stringify({ OPENAI_API_KEY: "sk-key", tokens: null }) }), { ok: false, why: "signed_out" }, "an API-key file is not a subscription sign-in");
  assert.deepEqual(readSignin("codex", { ".codex/auth.json": JSON.stringify({ tokens: { access_token: "", refresh_token: "" } }) }), { ok: false, why: "signed_out" });
  assert.deepEqual(readSignin("codex", { ".codex/auth.json": "{not json" }), { ok: false, why: "unreadable" });
  assert.equal(providerOfFiles(codex(ACCESS[0]!, T0)), "codex");
  assert.equal(providerOfFiles({ ".grok/auth.json": "{}" }), "grok");
});

test("a Grok file is read for any token, expiry and refresh time it carries; an empty one is a sign-out", () => {
  const g = readSignin("grok", { ".grok/auth.json": JSON.stringify({ token: "grok-session-token-0123456789", expires_at: 1_800_000_000 }) });
  assert.deepEqual(g, { ok: true, identity: null, fresh: { exp: 1_800_000_000_000 } });
  const named = readSignin("grok", { ".grok/auth.json": JSON.stringify({ id_token: jwt({ sub: "x-7", exp: 1_800_000_100 }), refreshed_at: T1 }) });
  assert.deepEqual(named, { ok: true, identity: "grok:user:x-7", fresh: { exp: 1_800_000_100_000, at: Date.parse(T1) } });
  assert.deepEqual(readSignin("grok", { ".grok/auth.json": "" }), { ok: false, why: "signed_out" });
  assert.deepEqual(readSignin("grok", { ".grok/auth.json": JSON.stringify({ user: "dana" }) }), { ok: false, why: "signed_out" }, "no token left in it");
  assert.equal(readSignin("grok", { ".grok/token": "a-bare-token-of-some-length" }).ok, true, "a bare token file");
});

test("freshness: the expiry decides, then the refresh time; unknown is a tie", () => {
  assert.equal(compareFresh({ exp: 2 }, { exp: 1 }), 1);
  assert.equal(compareFresh({ exp: 1, at: 9 }, { exp: 2, at: 1 }), -1, "the expiry first");
  assert.equal(compareFresh({ exp: 1, at: 2 }, { exp: 1, at: 1 }), 1, "the refresh time breaks an equal expiry");
  assert.equal(compareFresh({ at: 2 }, { exp: 1 }), 0, "nothing in common to compare");
  assert.equal(compareFresh({}, {}), 0);
});

test("a refreshed file is saved, an unchanged one is not", () => {
  const filled = codex(ACCESS[0]!, T0);
  assert.deepEqual(decideRefresh({ provider: "codex", filled, current: filled, back: codex(ACCESS[1]!, T1) }), { save: true });
  assert.deepEqual(decideRefresh({ provider: "codex", filled, current: filled, back: filled }), { save: false, why: "unchanged" });
});

test("a file of another account is refused: not the account the turn started with, nor the one the row records", () => {
  const filled = codex(ACCESS[0]!, T0);
  assert.deepEqual(decideRefresh({ provider: "codex", filled, current: filled, back: codex(ACCESS[1]!, T1, "acct-other") }), { save: false, why: "other_account" });
  assert.deepEqual(decideRefresh({ provider: "codex", filled, current: filled, back: codex(ACCESS[1]!, T1), known: "chatgpt:acct:acct-9/user:u-1" }), { save: false, why: "other_account" });
  assert.deepEqual(decideRefresh({ provider: "codex", filled, current: filled, back: codex(ACCESS[1]!, T1), known: "chatgpt:acct:acct-1/user:u-1" }), { save: true });
});

test("a sign-out is refused: the file gone, the tokens cleared, an API key in their place", () => {
  const filled = codex(ACCESS[0]!, T0);
  for (const back of [{ ".codex/auth.json": null }, { ".codex/auth.json": JSON.stringify({ OPENAI_API_KEY: null, tokens: null, last_refresh: T2 }) }, { ".codex/auth.json": JSON.stringify({ OPENAI_API_KEY: "sk-proj-x", last_refresh: T2 }) }]) {
    assert.deepEqual(decideRefresh({ provider: "codex", filled, current: filled, back }), { save: false, why: "signed_out" }, JSON.stringify(back).slice(0, 60));
  }
});

test("two turns of one account that refreshed at once: the newest is kept whichever save comes last", () => {
  const filled = codex(ACCESS[0]!, T0);
  const early = codex(ACCESS[1]!, T1), late = codex(ACCESS[2]!, T2);
  // the later refresh is saved first; the earlier one, arriving after, is older than what the Vault now holds
  assert.deepEqual(decideRefresh({ provider: "codex", filled, current: filled, back: late }), { save: true });
  assert.deepEqual(decideRefresh({ provider: "codex", filled, current: late, back: early }), { save: false, why: "older" });
  // in the other order the later one still replaces the earlier
  assert.deepEqual(decideRefresh({ provider: "codex", filled, current: early, back: late }), { save: true });
  // when the two cannot be told apart, the files win only if nobody saved since the turn began
  const g0 = { ".grok/auth.json": JSON.stringify({ token: "grok-session-token-0000000000" }) };
  const g1 = { ".grok/auth.json": JSON.stringify({ token: "grok-session-token-1111111111" }) };
  const g2 = { ".grok/auth.json": JSON.stringify({ token: "grok-session-token-2222222222" }) };
  assert.deepEqual(decideRefresh({ provider: "grok", filled: g0, current: g0, back: g1 }), { save: true });
  assert.deepEqual(decideRefresh({ provider: "grok", filled: g0, current: g1, back: g2 }), { save: false, why: "older" });
});

test("the host's save: the files wait under a single-use ticket for the item they belong to, and only an item id and a reason are logged", async () => {
  const logs: unknown[] = [];
  const seen: unknown[] = [];
  const files = codex(ACCESS[1]!, T1);
  const calls: { name: string; input: { ticket: string; itemId: string; asker: string } }[] = [];
  const refresh = createSigninRefresh({
    call: async (name, input) => {
      const i = input as { ticket: string; itemId: string; asker: string };
      calls.push({ name, input: i });
      assert.equal(refresh.take(i.ticket, "vlt_other"), null, "not for another item");
      const got = refresh.take(i.ticket, i.itemId);
      seen.push(got);
      assert.equal(refresh.take(i.ticket, i.itemId), null, "the ticket is used once");
      return { saved: true, reason: "refreshed" };
    },
    log: (msg, attrs) => logs.push({ msg, attrs }),
  });
  const out = await refresh.save({ itemId: "vlt_1", asker: "usr_dana", filled: JSON.stringify(codex(ACCESS[0]!, T0)), files });
  assert.deepEqual(out, { saved: true, reason: "refreshed" });
  assert.equal(calls[0]!.name, "vault.signin_refreshed");
  assert.deepEqual(Object.keys(calls[0]!.input).sort(), ["asker", "itemId", "ticket"], "the call carries no value");
  assert.match(calls[0]!.input.ticket, /^[0-9a-f]{48}$/);
  assert.deepEqual((seen[0] as { files: unknown }).files, files);
  assert.equal(refresh.take(calls[0]!.input.ticket, "vlt_1"), null, "nothing is held after the save");
  const failing = createSigninRefresh({ call: async () => { throw Object.assign(new Error(`boom ${ACCESS[1]}`), { code: "auth.unauthenticated" }); }, log: (msg, attrs) => logs.push({ msg, attrs }) });
  assert.deepEqual(await failing.save({ itemId: "vlt_1", asker: "usr_dana", filled: "{}", files }), { saved: false, reason: "auth.unauthenticated" });
  for (const a of ACCESS) assert.equal(JSON.stringify(logs).includes(a), false, "no token in a log line");
});
