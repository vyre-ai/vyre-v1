// One account, one row (spec 2.17, 4.14): a sign-in to an account the person already has refreshes that row in place (same provider id, handle and name); a second account of the provider is a second
// row named by its account; sign-ins whose account cannot be read are kept and listed as one entry per provider; rows of one account saved twice are folded into one, and their old handles still lead
// there. Nothing is overwritten by another account's credential and nothing is deleted without a history line.
// @reads /modules/vault/handlers/providers.ts
// @reads /modules/vault/handlers/signins.ts
// @reads /modules/vault/migrations/0006_provider_identity.sql
import test from "node:test";
import assert from "node:assert/strict";
import * as v from "../handlers/index.ts";
import * as u from "../handlers/use.ts";
import * as p from "../handlers/providers.ts";
import { registry } from "../../../generated/registry.ts";
import { MAYA, contractErrors, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

type Json = Record<string, unknown>;
const out = (x: unknown): Json => x as Json;
let seq = 0;
const key = (): string => `s-${++seq}`;
type Step = { state: "done"; fields: { key: string; value: string; secret: boolean }[]; identity?: { id: string; label?: string } };
const jwt = (claims: Record<string, unknown>): string => `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
const codexFiles = (account: string, access: string): string => JSON.stringify({ ".codex/auth.json": JSON.stringify({ tokens: { id_token: jwt({ email: "maya@example.com", "https://api.openai.com/auth": { chatgpt_account_id: account, chatgpt_user_id: "u-1" } }), access_token: access, refresh_token: `r-${access}` } }) });

/** A host sign-in port that finishes each flow with the next scripted answer. */
function port(script: Step[]) {
  const live = new Set<string>();
  const done = new Map<string, Step>();
  return {
    has: (k: string) => k === "claude-code" || k === "codex",
    active: (id: string) => live.has(id),
    async start({ id }: { id: string }) { live.add(id); return { url: "https://claude.ai/oauth/authorize?state=s", needsCode: true, expiresInSec: 900 }; },
    async step({ id }: { id: string }) { const held = done.get(id); if (held) return held; const next = script.shift()!; done.set(id, next); return next; },
    cancel: (id: string) => { live.delete(id); done.delete(id); },
  };
}
async function signIn(h: Harness, providerKey = "claude-code"): Promise<Json> {
  const started = out(await p.subscriptionStart(h.ctx, { providerKey, idempotencyKey: key() }));
  const done = out(await p.subscriptionComplete(h.ctx, { flowId: String(started.flowId), code: "CODE#STATE" }));
  assert.deepEqual(contractErrors("providers.subscription_complete", "out", done), []);
  return out(done.provider);
}
const claude = (token: string, who?: { id: string; label?: string }): Step => ({ state: "done", fields: [{ key: "setup_token", value: token, secret: true }], ...(who ? { identity: who } : {}) });
const live = (h: Harness, sql = `SELECT * FROM vault_provider`) => h.rows(sql).filter((r) => r["deleted_at"] == null);
const secretOf = (h: Harness, handle: string): Promise<string> => u.secretPort(h.ctx.db).secret(handle, "", MAYA);

/** A sign-in saved the old way: an ai_subscription item and its provider row, at a given time. */
async function seed(h: Harness, folderId: string, providerKey: string, name: string, field: { key: string; value: string }, at: number, state = "ok"): Promise<{ id: string; itemId: string; handle: string }> {
  const made = out(out(await v.itemPut(h.ctx, { folderId, name, kind: "ai_subscription", fields: [{ ...field, secret: true }], idempotencyKey: key() } as Parameters<typeof v.itemPut>[1])).item);
  const id = `prv_seed${++seq}`;
  h.ctx.db.run(`INSERT INTO vault_provider ("id", "providerKey", "connection", "scope", "owner", "itemId", "spaceMayUse", "state", "createdAt", "deleted_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, providerKey, "subscription", "mine", MAYA, String(made.id), 0, state, at, null);
  return { id, itemId: String(made.id), handle: String(made.handle) };
}
async function mineFolder(h: Harness): Promise<string> {
  await p.list(h.ctx, {});   // the provider tables
  return String(out(out(await v.foldersCreate(h.ctx, { name: "AI providers", scope: "mine", idempotencyKey: key() })).folder).id);
}

test("signing in twice to the same account is one row: the same provider, handle and name, holding the newest credential", async () => {
  const h = harness();
  const OLD = "sk-ant-oat01-first-sign-in-0123456789", NEW = "sk-ant-oat01-second-sign-in-0123456789"; // secret-scan: fake
  const who = { id: "claude:acct:a-1/org:o-1", label: "maya@example.com" };
  u.configureVault({ sinks: {}, signin: port([claude(OLD, who), claude(NEW, who)]) });
  try {
    const one = await signIn(h);
    const two = await signIn(h);
    assert.deepEqual([two.id, two.itemId, two.handle], [one.id, one.itemId, one.handle], "the same row, item and handle");
    assert.equal(live(h).length, 1);
    assert.equal(live(h, `SELECT * FROM vault_meta`).length, 1, "one item");
    assert.deepEqual([two.displayName, two.identity, two.itemName], ["Claude Code, maya@example.com", "maya@example.com", "Claude Code, maya@example.com"]);
    assert.equal(await secretOf(h, String(two.handle)), NEW, "the row holds the newest sign-in");
    assert.equal(h.everything().includes(NEW) || h.everything().includes(OLD), false, "no token in a row, event, call or log");
  } finally { u.configureVault(null); h.cleanup(); }
});

test("two accounts of one provider are two rows named by their account, and neither overwrites the other", async () => {
  const h = harness();
  const A = "sk-ant-oat01-personal-account-0123456789", B = "sk-ant-oat01-work-account-0123456789"; // secret-scan: fake
  u.configureVault({ sinks: {}, signin: port([claude(A, { id: "claude:acct:a-1/org:personal", label: "maya@example.com" }), claude(B, { id: "claude:acct:a-1/org:work", label: "Work Org" })]) });
  try {
    const personal = await signIn(h);
    h.advance(1000);
    const work = await signIn(h);
    assert.notEqual(personal.id, work.id);
    assert.deepEqual((out(await p.list(h.ctx, {})).providers as Json[]).map((r) => [r.displayName, r.olderOf]), [["Claude Code, maya@example.com", undefined], ["Claude Code, Work Org", undefined]]);
    assert.equal(await secretOf(h, String(personal.handle)), A);
    assert.equal(await secretOf(h, String(work.handle)), B);
  } finally { u.configureVault(null); h.cleanup(); }
});

test("a sign-in that names an account never overwrites one that names nobody; the nameless one is listed under it as an older sign-in", async () => {
  const h = harness();
  const OLD = "sk-ant-oat01-nameless-0123456789", NEW = "sk-ant-oat01-named-0123456789"; // secret-scan: fake
  u.configureVault({ sinks: {}, signin: port([claude(OLD), claude(NEW, { id: "claude:acct:a-1/org:o-1", label: "maya@example.com" })]) });
  try {
    const nameless = await signIn(h);
    h.advance(1000);
    const named = await signIn(h);
    assert.notEqual(named.id, nameless.id);
    assert.equal(await secretOf(h, String(nameless.handle)), OLD, "the older credential is kept as it was");
    const rows = out(await p.list(h.ctx, {})).providers as Json[];
    assert.deepEqual(rows.map((r) => [r.id, r.displayName, r.olderOf]), [[nameless.id, "Claude Code", named.id], [named.id, "Claude Code, maya@example.com", undefined]]);
    for (const r of rows) assert.deepEqual(contractErrors("providers.list", "out", { providers: [r] }), []);
  } finally { u.configureVault(null); h.cleanup(); }
});

test("four sign-ins saved before accounts had names list as one Claude Code with three older ones, the newest that works first, never 'Claude Code 4'", async () => {
  const h = harness();
  try {
    const folder = await mineFolder(h);
    const rows = [];
    for (const [i, name] of ["Claude Code", "Claude Code 2", "Claude Code 3", "Claude Code 4"].entries()) rows.push(await seed(h, folder, "claude-code", name, { key: "setup_token", value: `sk-ant-oat01-legacy-${i}-0123456789` }, 1_000 + i, i === 3 ? "needs_sign_in" : "ok"));   // secret-scan: fake
    const listed = out(await p.list(h.ctx, {})).providers as Json[];
    const heads = listed.filter((r) => r.olderOf === undefined);
    assert.deepEqual(heads.map((r) => r.id), [rows[2]!.id], "one entry: the newest sign-in that works");
    assert.deepEqual(listed.filter((r) => r.olderOf !== undefined).map((r) => [r.id, r.olderOf]), [[rows[0]!.id, rows[2]!.id], [rows[1]!.id, rows[2]!.id], [rows[3]!.id, rows[2]!.id]]);
    assert.ok(listed.every((r) => r.displayName === "Claude Code"), "no counter in any name a person reads");
    assert.equal(p.tidy(h.ctx).folded, 0, "rows whose account cannot be read are never folded: every credential is kept");
    assert.equal(live(h).length, 4);
  } finally { h.cleanup(); }
});

test("Codex sign-ins of one account saved twice fold into one: the oldest row, handle and name keep it with the newest credential; the old handle still leads there; the extra item is in the Trash with a history line", async () => {
  const h = harness();
  try {
    const folder = await mineFolder(h);
    const older = await seed(h, folder, "codex", "Codex", { key: "credentials", value: codexFiles("acct-1", "old-access") }, 1_000);
    const newer = await seed(h, folder, "codex", "Codex 2", { key: "credentials", value: codexFiles("acct-1", "new-access") }, 2_000);
    const other = await seed(h, folder, "codex", "Codex 3", { key: "credentials", value: codexFiles("acct-team", "team-access") }, 3_000);

    h.lock(MAYA);
    await p.list(h.ctx, {});
    assert.equal(p.tidy(h.ctx).folded, 0, "with the key locked the accounts are not read, so nothing is folded");
    h.unlock(MAYA);
    const before = out(await p.list(h.ctx, {})).providers as Json[];
    assert.deepEqual(before.map((r) => r.identity), ["maya@example.com", "maya@example.com", "maya@example.com"], "the files name the account");
    assert.equal(before.find((r) => r.id === newer.id)?.olderOf, older.id, "listed as one entry until folded");

    h.actAs("service", "svc_host");   // the start hook
    assert.equal(p.tidy(h.ctx).folded, 1);
    assert.equal(p.tidy(h.ctx).folded, 0, "folding twice changes nothing");
    h.actAs("person", MAYA);

    const after = out(await p.list(h.ctx, {})).providers as Json[];
    assert.deepEqual(after.map((r) => r.id), [older.id, other.id], "the oldest row keeps the account; the other account is untouched");
    const kept = after[0]!;
    assert.deepEqual([kept.handle, kept.itemName, kept.aliases], [older.handle, "Codex", [newer.handle]]);
    assert.equal(await secretOf(h, older.handle), codexFiles("acct-1", "new-access"), "the newest credential, under the oldest handle");
    assert.equal(await secretOf(h, newer.handle), codexFiles("acct-1", "new-access"), "the folded handle leads to the same account");
    h.actAs("agent", "agt_1"); h.ctx.actingFor = MAYA;
    assert.equal(out(await u.use(h.ctx, { item: newer.handle, purpose: "engine account" })).handle, older.handle, "a turn that names the old handle uses the row that kept it");
    h.actAs("person", MAYA); delete h.ctx.actingFor;
    const trashed = h.rows(`SELECT * FROM vault_meta WHERE id = ?`, older.itemId)[0]!;
    assert.notEqual(trashed["deleted_at"], null, "the older credential is in the Trash");
    assert.notEqual(trashed["handle"], older.handle, "and has stepped aside from the handle");
    assert.ok(h.rows(`SELECT * FROM vault_history WHERE "itemId" = ?`, older.itemId).some((r) => r["action"] === "deleted" && /took over/.test(String(r["detail"]))), "with a line in its history");
    assert.deepEqual(h.named("provider.removed").map((e) => e.payload["providerId"]), [newer.id]);
    assert.equal(out(await v.itemRestore(h.ctx, { itemId: older.itemId })).item !== undefined, true, "and can be restored");
  } finally { h.cleanup(); }
});

test("signing in again to an account whose rows were folded refreshes the row that kept it", async () => {
  const h = harness();
  const who = { id: "chatgpt:acct:acct-1/user:u-1", label: "maya@example.com" };
  u.configureVault({ sinks: {}, signin: port([{ state: "done", fields: [{ key: "credentials", value: codexFiles("acct-1", "fresh-access"), secret: true }], identity: who }]) });
  try {
    const folder = await mineFolder(h);
    const older = await seed(h, folder, "codex", "Codex", { key: "credentials", value: codexFiles("acct-1", "old-access") }, 1_000);
    await seed(h, folder, "codex", "Codex 2", { key: "credentials", value: codexFiles("acct-1", "new-access") }, 2_000);
    const row = await signIn(h, "codex");
    assert.equal(row.id, older.id, "the sign-in found the account, folded its copies and refreshed the row that keeps it");
    assert.equal(live(h).length, 1);
    assert.equal(await secretOf(h, older.handle), codexFiles("acct-1", "fresh-access"));
  } finally { u.configureVault(null); h.cleanup(); }
});

test("every event a sign-in emits while it refreshes and folds is one the capability declares (the host refuses any other, which once made signing in again fail)", async () => {
  const h = harness();
  const who = { id: "chatgpt:acct:acct-1/user:u-1", label: "maya@example.com" };
  u.configureVault({ sinks: {}, signin: port([{ state: "done", fields: [{ key: "credentials", value: codexFiles("acct-1", "fresh-access"), secret: true }], identity: who }, { state: "done", fields: [{ key: "credentials", value: codexFiles("acct-2", "other-access"), secret: true }], identity: { id: "chatgpt:acct:acct-2/user:u-1", label: "maya@example.com" } }]) });
  try {
    const folder = await mineFolder(h);
    await seed(h, folder, "codex", "Codex", { key: "credentials", value: codexFiles("acct-1", "old-access") }, 1_000);
    await seed(h, folder, "codex", "Codex 2", { key: "credentials", value: codexFiles("acct-1", "new-access") }, 2_000);
    const from = h.emitted.length;
    await signIn(h, "codex");   // folds the two copies, then refreshes the row that keeps the account
    await signIn(h, "codex");   // another account: a new row, renamed by its account
    const declared = new Set(registry.capabilities.filter((c) => c.name === "providers.subscription_complete").flatMap((c) => (c as { emits?: string[] }).emits ?? []));
    const sent = [...new Set(h.emitted.slice(from).map((e) => e.name))].sort();
    assert.deepEqual(sent.filter((e) => !declared.has(e)), [], `undeclared: ${sent.join(", ")}`);
    assert.ok(sent.includes("vault.item_updated") && sent.includes("provider.removed"), "the refresh and the fold both happened");
  } finally { u.configureVault(null); h.cleanup(); }
});
