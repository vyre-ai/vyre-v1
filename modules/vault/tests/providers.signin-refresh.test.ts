// A CLI sign-in the engine refreshed during a turn is saved back to the person's own item (owner, rc.13: "You should never lose credentials if they're in here"): the host hands the files over under a
// single-use ticket and the module saves them only when the item is the person's live Codex or Grok sign-in, the files are still that account's sign-in, and they are newer than what it holds now. A history
// line and vault.item_updated say so; no value is in a row, an event, a call or a log line.
// @reads /modules/vault/handlers/providers.ts
// @reads /modules/vault/handlers/items.ts
// @reads /host/src/seams/signin-refresh.ts
import test from "node:test";
import assert from "node:assert/strict";
import * as v from "../handlers/index.ts";
import * as u from "../handlers/use.ts";
import * as p from "../handlers/providers.ts";
import { setKeyPort } from "../handlers/crypto.ts";
import { createSigninRefresh } from "../../../host/src/seams/signin-refresh.ts";
import { MAYA, ROB, harness, keyOfPerson } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

type Json = Record<string, unknown>;
const out = (x: unknown): Json => x as Json;
let seq = 0;
const key = (): string => `r-${++seq}`;
const jwt = (claims: Record<string, unknown>): string => `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
const ACCESS = ["codex-access-VAULT-ONE-0123456789ab", "codex-access-VAULT-TWO-0123456789ab", "codex-access-VAULT-THREE-012345678"]; // secret-scan: fake
const T0 = "2026-10-01T10:00:00.000Z", T1 = "2026-10-01T11:00:00.000Z", T2 = "2026-10-01T12:00:00.000Z";
const auth = (access: string, at: string, account = "acct-1"): string => JSON.stringify({ OPENAI_API_KEY: null, tokens: { id_token: jwt({ email: "maya@example.com", "https://api.openai.com/auth": { chatgpt_account_id: account, chatgpt_user_id: "u-1" } }), access_token: access, refresh_token: `rt-${access}` }, last_refresh: at });
const files = (access: string, at: string, account?: string): Record<string, string> => ({ ".codex/auth.json": auth(access, at, account) });

const folders = new WeakMap<Harness, string>();
async function mineFolder(h: Harness): Promise<string> {
  const have = folders.get(h);
  if (have) return have;
  await p.list(h.ctx, {});   // the provider tables
  const id = String(out(out(await v.foldersCreate(h.ctx, { name: "AI providers", scope: "mine", idempotencyKey: key() })).folder).id);
  folders.set(h, id);
  return id;
}
/** A signed-in subscription: the ai_subscription item and its provider row. */
async function signedIn(h: Harness, providerKey: string, field: { key: string; value: string }): Promise<{ id: string; itemId: string; handle: string }> {
  const folderId = await mineFolder(h);
  const made = out(out(await v.itemPut(h.ctx, { folderId, name: providerKey === "codex" ? "Codex" : "Claude Code", kind: "ai_subscription", fields: [{ ...field, secret: true }], idempotencyKey: key() } as Parameters<typeof v.itemPut>[1])).item);
  const id = `prv_ref${++seq}`;
  h.ctx.db.run(`INSERT INTO vault_provider ("id", "providerKey", "connection", "scope", "owner", "itemId", "spaceMayUse", "state", "createdAt", "deleted_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, providerKey, "subscription", "mine", MAYA, String(made.id), 0, "ok", 1, null);
  return { id, itemId: String(made.id), handle: String(made.handle) };
}

/** The host's save wired to the module the way the daemon wires it: the module's call runs as the host service, the files come only through `take`. */
function rig(h: Harness) {
  const refresh = createSigninRefresh({ call: async (_name, input) => { h.actAs("service", "svc_host"); try { return await p.signinRefreshed(h.ctx, input as never); } finally { h.actAs("person", MAYA); } } });
  u.configureVault({ sinks: {}, refreshed: { take: (t, i) => refresh.take(t, i) } });
  // the person unlocked their key on this node: the save opens their item with it, whoever runs the call
  setKeyPort({ async personKey(id) { return id === MAYA ? keyOfPerson(MAYA) : null; } });
  return refresh;
}
const held = (h: Harness, handle: string): Promise<string> => u.secretPort(h.ctx.db).secret(`${handle}.credentials`, "", MAYA);

test("a refreshed Codex sign-in is saved over its item, with a history line and an event, and no value anywhere else", async () => {
  const h = harness();
  try {
    const filled = JSON.stringify(files(ACCESS[0]!, T0));
    const s = await signedIn(h, "codex", { key: "credentials", value: filled });
    const refresh = rig(h);
    const back = files(ACCESS[1]!, T1);
    assert.deepEqual(await refresh.save({ itemId: s.itemId, asker: MAYA, filled, files: back }), { saved: true, reason: "refreshed" });
    assert.equal(await held(h, s.handle), JSON.stringify(back), "the item holds the refreshed sign-in");
    const history = h.rows(`SELECT * FROM vault_history WHERE "itemId" = ? AND "detail" IS NOT NULL`, s.itemId);
    assert.deepEqual(history.map((r) => [r["action"], r["field"], r["detail"]]), [["edited", "credentials", "Codex refreshed its sign-in"]]);
    assert.deepEqual(h.named("vault.item_updated").at(-1)?.payload, { itemId: s.itemId, fieldsChanged: ["credentials"], settingsChanged: [] });
    // the next turn's fill gets the refreshed file, and the same handle and row still lead to it
    assert.equal(JSON.parse(await held(h, s.handle))[".codex/auth.json"], back[".codex/auth.json"]);
    for (const a of ACCESS) assert.equal(h.everything().includes(a), false, "no token in a row, event, call or log");
    // saved again with the same files: nothing changes
    assert.deepEqual(await refresh.save({ itemId: s.itemId, asker: MAYA, filled, files: back }), { saved: false, reason: "unchanged" });
  } finally { u.configureVault(null); h.cleanup(); }
});

test("another account's file, a sign-out and an older file are refused, and the item keeps what it had", async () => {
  const h = harness();
  try {
    const filled = JSON.stringify(files(ACCESS[0]!, T0));
    const s = await signedIn(h, "codex", { key: "credentials", value: filled });
    const refresh = rig(h);
    assert.deepEqual(await refresh.save({ itemId: s.itemId, asker: MAYA, filled, files: files(ACCESS[1]!, T1, "acct-team") }), { saved: false, reason: "other_account" });
    assert.deepEqual(await refresh.save({ itemId: s.itemId, asker: MAYA, filled, files: { ".codex/auth.json": null } }), { saved: false, reason: "signed_out" });
    assert.deepEqual(await refresh.save({ itemId: s.itemId, asker: MAYA, filled, files: { ".codex/auth.json": JSON.stringify({ OPENAI_API_KEY: null, tokens: null }) } }), { saved: false, reason: "signed_out" });
    // the account the row records wins over the files' own word
    h.ctx.db.run(`INSERT INTO vault_provider_identity ("providerId", "identity", "label", "at") VALUES (?, ?, ?, ?)`, s.id, "chatgpt:acct:acct-9/user:u-1", null, 1);
    assert.deepEqual(await refresh.save({ itemId: s.itemId, asker: MAYA, filled, files: files(ACCESS[1]!, T1) }), { saved: false, reason: "other_account" });
    assert.equal(await held(h, s.handle), filled, "untouched");
    assert.equal(h.named("vault.item_updated").length, 0);
  } finally { u.configureVault(null); h.cleanup(); }
});

test("two turns of one account that end together: the newest sign-in is kept, whichever save lands last", async () => {
  for (const order of ["late first", "early first", "together"] as const) {
    const h = harness();
    try {
      const filled = JSON.stringify(files(ACCESS[0]!, T0));
      const s = await signedIn(h, "codex", { key: "credentials", value: filled });
      const refresh = rig(h);
      const early = files(ACCESS[1]!, T1), late = files(ACCESS[2]!, T2);
      const save = (f: Record<string, string>) => refresh.save({ itemId: s.itemId, asker: MAYA, filled, files: f });
      if (order === "late first") { await save(late); assert.deepEqual(await save(early), { saved: false, reason: "older" }); }
      else if (order === "early first") { await save(early); assert.deepEqual(await save(late), { saved: true, reason: "refreshed" }); }
      else await Promise.all([save(late), save(early)]);
      assert.equal(await held(h, s.handle), JSON.stringify(late), `${order}: the newest is kept`);
    } finally { u.configureVault(null); h.cleanup(); }
  }
});

test("only the person's own live Codex or Grok sign-in is ever written: a Claude item, someone else's, a deleted one and a used ticket are refused", async () => {
  const h = harness();
  try {
    const filled = JSON.stringify(files(ACCESS[0]!, T0));
    const s = await signedIn(h, "codex", { key: "credentials", value: filled });
    const claude = await signedIn(h, "claude-code", { key: "credentials", value: filled });
    const refresh = rig(h);
    const back = files(ACCESS[1]!, T1);
    assert.deepEqual(await refresh.save({ itemId: claude.itemId, asker: MAYA, filled, files: back }), { saved: false, reason: "not_a_signin" });
    assert.deepEqual(await refresh.save({ itemId: s.itemId, asker: ROB, filled, files: back }), { saved: false, reason: "not_a_signin" }, "not the owner's turn");
    // a call that names a ticket the host does not hold finds nothing
    h.actAs("service", "svc_host");
    assert.deepEqual(await p.signinRefreshed(h.ctx, { ticket: "f".repeat(48), itemId: s.itemId, asker: MAYA }), { saved: false, reason: "gone" });
    h.actAs("person", MAYA);
    await v.itemDelete(h.ctx, { itemId: s.itemId } as never);
    assert.deepEqual(await refresh.save({ itemId: s.itemId, asker: MAYA, filled, files: back }), { saved: false, reason: "not_a_signin" });
  } finally { u.configureVault(null); h.cleanup(); }
});

test("a key locked on this computer saves nothing and says why", async () => {
  const h = harness();
  try {
    const filled = JSON.stringify(files(ACCESS[0]!, T0));
    const s = await signedIn(h, "codex", { key: "credentials", value: filled });
    const refresh = rig(h);
    setKeyPort({ async personKey() { return null; } });
    assert.deepEqual(await refresh.save({ itemId: s.itemId, asker: MAYA, filled, files: files(ACCESS[1]!, T1) }), { saved: false, reason: "auth.unauthenticated" });
  } finally { u.configureVault(null); h.cleanup(); }
});
