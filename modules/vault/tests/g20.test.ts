// Vault deferred capabilities (P-L7_20): folders.update and delete, generate, health, policy, items.match, site rules and export_mine. None returns a stored value; every refusal has a test.
// @reads /modules/vault/handlers/g20.ts
// @reads /modules/vault/handlers/items.ts
// @reads /modules/vault/handlers/use.ts
import test from "node:test";
import assert from "node:assert/strict";
import * as v from "../handlers/index.ts";
import * as g from "../handlers/g20.ts";
import { exportEnv, exportPull } from "../handlers/use.ts";
import { AGENT, MAYA, ROB, SECRET, contractErrors, harness, refusedWith } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

type Json = Record<string, unknown>;
const out = (x: unknown): Json => x as Json;
const DAY = 24 * 60 * 60 * 1000;
let seq = 0;
const key = (): string => `g-${++seq}`;

async function folder(h: Harness, scope: "mine" | "shared", name = `${scope} folder ${key()}`, parentId?: string): Promise<string> {
  return String(out(out(await v.foldersCreate(h.ctx, { name, scope, ...(parentId ? { parentId } : {}), idempotencyKey: key() })).folder).id);
}
async function put(h: Harness, folderId: string, name: string, fields: { key: string; value: string }[], o: Json = {}): Promise<string> {
  const made = out(await v.itemPut(h.ctx, { folderId, name, kind: "login", fields, idempotencyKey: key(), ...o } as Parameters<typeof v.itemPut>[1]));
  return String(out(made.item).id);
}
const login = (user: string, password: string, url?: string) => [{ key: "username", value: user }, { key: "password", value: password }, ...(url ? [{ key: "url", value: url }] : [])];

// ---- folders

test("folders.update renames a folder and sets Who can export; only a manager touches it", async () => {
  const h = harness();
  const shared = await folder(h, "shared", "Team");
  const other = await folder(h, "shared", "Billing");
  const renamed = out(await g.foldersUpdate(h.ctx, { folderId: shared, name: " Ops " }));
  assert.deepEqual(contractErrors("vault.folders.update", "out", renamed), []);
  assert.equal(out(renamed.folder).name, "Ops");
  assert.deepEqual(h.named("vault.folder_updated")[0]?.payload, { folderId: shared, exportRuleChanged: false });

  const rule = [{ kind: "role", id: "rol_admin" }, { kind: "person", id: ROB }];
  const set = out(out(await g.foldersUpdate(h.ctx, { folderId: shared, whoCanExport: rule })).folder);
  assert.deepEqual(set.whoCanExport, rule);
  assert.deepEqual(h.named("vault.folder_updated")[1]?.payload, { folderId: shared, exportRuleChanged: true });
  await g.foldersUpdate(h.ctx, { folderId: shared, whoCanExport: rule });
  assert.equal(h.named("vault.folder_updated").length, 2, "no change, no event");

  assert.equal(await refusedWith(g.foldersUpdate(h.ctx, { folderId: shared, name: "billing" })), "validation.duplicate");
  assert.equal(await refusedWith(g.foldersUpdate(h.ctx, { folderId: shared, name: "  " })), "validation.bad_input");
  assert.equal(await refusedWith(g.foldersUpdate(h.ctx, { folderId: "nope" })), "validation.bad_input");
  assert.equal(await refusedWith(g.foldersUpdate(h.ctx, { folderId: shared, whoCanExport: [{ kind: "wizard", id: "x" }] })), "validation.bad_input");
  const mine = await folder(h, "mine");
  assert.equal(await refusedWith(g.foldersUpdate(h.ctx, { folderId: mine, whoCanExport: [] })), "validation.precondition_failed", "a Mine folder has no export rule");

  h.actAs("person", ROB);
  assert.equal(await refusedWith(g.foldersUpdate(h.ctx, { folderId: mine, name: "mine now" })), "validation.not_found", "someone's Mine folder does not exist for others");
  assert.equal(await refusedWith(g.foldersUpdate(h.ctx, { folderId: other, name: "x" })), "permission.no_grant");
  h.grant(ROB, other, "edit");
  assert.equal(await refusedWith(g.foldersUpdate(h.ctx, { folderId: other, name: "x" })), "permission.no_grant", "Edit is not Manage");
  h.grant(ROB, other, "manage");
  assert.equal(out(out(await g.foldersUpdate(h.ctx, { folderId: other, name: "Finance" })).folder).name, "Finance");
});

test("folders.delete removes an empty folder and refuses one with items, trashed items or folders inside", async () => {
  const h = harness();
  const a = await folder(h, "shared", "Empty");
  assert.deepEqual(contractErrors("vault.folders.delete", "out", out(await g.foldersDelete(h.ctx, { folderId: a }))), []);
  assert.deepEqual(h.named("vault.folder_deleted")[0]?.payload, { folderId: a });
  assert.deepEqual(out(await v.foldersList(h.ctx, {})).folders, []);
  assert.equal(await refusedWith(g.foldersDelete(h.ctx, { folderId: a })), "validation.not_found", "already gone");

  const b = await folder(h, "shared", "Full");
  const id = await put(h, b, "Stripe", login("a", "b"));
  assert.equal(await refusedWith(g.foldersDelete(h.ctx, { folderId: b })), "validation.precondition_failed");
  await v.itemDelete(h.ctx, { itemId: id });
  assert.equal(await refusedWith(g.foldersDelete(h.ctx, { folderId: b })), "validation.precondition_failed", "Trash still holds an item of it");
  const parent = await folder(h, "shared", "Parent");
  await folder(h, "shared", "Child", parent);
  assert.equal(await refusedWith(g.foldersDelete(h.ctx, { folderId: parent })), "validation.precondition_failed");

  const theirs = await folder(h, "shared", "Locked");
  const mine = await folder(h, "mine", "Private");
  h.actAs("person", ROB);
  assert.equal(await refusedWith(g.foldersDelete(h.ctx, { folderId: theirs })), "permission.no_grant");
  assert.equal(await refusedWith(g.foldersDelete(h.ctx, { folderId: mine })), "validation.not_found");
  assert.equal(await refusedWith(g.foldersDelete(h.ctx, { folderId: "x" })), "validation.bad_input");
});

// ---- generate

test("generate makes a password, passphrase or token to the contract and stores nothing", async () => {
  const h = harness();
  const before = (h.ctx.db as unknown as { dump(): string }).dump();
  const pw = out(await g.generate(h.ctx, { kind: "password" }));
  assert.deepEqual(contractErrors("vault.generate", "out", pw), []);
  const value = String(pw.value);
  assert.equal(value.length, 20);
  assert.ok(/[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value) && /[^A-Za-z0-9]/.test(value), "every class is present");
  assert.equal(pw.strength, "strong");
  const plain = String(out(await g.generate(h.ctx, { kind: "password", length: 12, symbols: false })).value);
  assert.ok(plain.length === 12 && /^[A-Za-z0-9]+$/.test(plain));
  assert.equal(out(await g.generate(h.ctx, { kind: "password", length: 8 })).strength, "fair");
  const phrase = out(await g.generate(h.ctx, { kind: "passphrase", words: 4 }));
  assert.equal(String(phrase.value).split("-").length, 4);
  assert.deepEqual(contractErrors("vault.generate", "out", phrase), []);
  assert.equal(out(await g.generate(h.ctx, { kind: "passphrase", words: 3 })).strength, "fair");
  const tok = out(await g.generate(h.ctx, { kind: "token" }));
  assert.ok(/^[A-Za-z0-9]{32}$/.test(String(tok.value)));
  assert.notEqual(String(out(await g.generate(h.ctx, { kind: "token" })).value), String(tok.value), "each call is fresh");
  assert.equal((h.ctx.db as unknown as { dump(): string }).dump(), before, "nothing was written");
  assert.ok(!h.everything().includes(value));
  for (const bad of [{ kind: "pin" }, { kind: "password", length: 7 }, { kind: "password", length: 129 }, { kind: "password", length: 9.5 }, { kind: "passphrase", words: 2 }, { kind: "passphrase", words: 11 }, { kind: "token", symbols: "yes" }]) {
    assert.equal(await refusedWith(g.generate(h.ctx, bad as never)), "validation.bad_input", JSON.stringify(bad));
  }
});

// ---- health

test("health reports weak, reused, stale and rotation-due items by id and issue, never a value", async () => {
  const h = harness();
  const mine = await folder(h, "mine");
  const strong = "Tr0ub4dor&3-horse-Staple!";
  const a = await put(h, mine, "Old weak", login("a", "abc"), { rotateEveryDays: 30 });
  const b = await put(h, mine, "Twin one", login("b", strong));
  const c = await put(h, mine, "Twin two", login("c", strong));
  h.advance(400 * DAY);
  const d = await put(h, mine, "Fresh", login("d", "N3w-unique-Passw0rd!"));
  const res = out(await g.health(h.ctx, {}));
  assert.deepEqual(contractErrors("vault.health", "out", res), []);
  assert.deepEqual([res.total, res.weak, res.reused, res.stale, res.rotationDue], [4, 1, 2, 3, 1]);
  const by = Object.fromEntries((res.items as Json[]).map((i) => [i.itemId, i.issues]));
  assert.deepEqual(by[a], ["weak", "stale", "rotation_due"]);
  assert.deepEqual(by[b], ["reused", "stale"]);
  assert.deepEqual(by[c], ["reused", "stale"]);
  assert.equal(by[d], undefined, "a healthy item is not listed");
  assert.ok(!JSON.stringify(res).includes(strong) && !JSON.stringify(res).includes('"abc"'), "no value in the report");
  assert.ok(!h.everything().includes(strong), "no value is written down");

  const inFolder = out(await g.health(h.ctx, { folderId: mine }));
  assert.equal(inFolder.total, 4);
  assert.equal(await refusedWith(g.health(h.ctx, { folderId: "nope" })), "validation.bad_input");
  assert.equal(await refusedWith(g.health(h.ctx, { folderId: "vfd_missing" })), "validation.not_found");

  // a locked key skips Mine values instead of failing: only the date issues remain
  h.lock(MAYA);
  const locked = out(await g.health(h.ctx, {}));
  assert.deepEqual([locked.weak, locked.reused, locked.stale], [0, 0, 3]);
});

test("health shows a caller only what they can see, and weak or reused only where they hold View", async () => {
  const h = harness();
  const mine = await folder(h, "mine");
  await put(h, mine, "Private weak", login("m", "abc"));
  const shared = await folder(h, "shared");
  const id = await put(h, shared, "Shared weak", login("s", "abc"));
  h.advance(400 * DAY);
  h.actAs("person", ROB);
  assert.deepEqual(out(await g.health(h.ctx, {})).items, [], "nothing granted, nothing seen");
  h.grant(ROB, id, "use");
  const useOnly = out(await g.health(h.ctx, {}));
  assert.deepEqual([useOnly.total, useOnly.weak, useOnly.stale], [1, 0, 1], "Use alone cannot learn the password is weak");
  assert.deepEqual(out((useOnly.items as Json[])[0]).issues, ["stale"]);
  h.grant(ROB, id, "view");
  const viewer = out(await g.health(h.ctx, {}));
  assert.deepEqual([viewer.total, viewer.weak], [1, 1], "Maya's Mine item is still not counted");
});

// ---- policy

test("policy.get answers the defaults and policy.set saves, audits and refuses a rule that cannot change", async () => {
  const h = harness();
  const first = out(await g.policyGet(h.ctx));
  assert.deepEqual(contractErrors("vault.policy.get", "out", first), []);
  assert.deepEqual(first.policy, { exportRoles: ["owner", "admin"], pullExpiryMax: "1d", blockRestrictedExport: true, revealNeedsReason: false });
  const next = { exportRoles: ["owner", "admin", "owner"], pullExpiryMax: "7d", blockRestrictedExport: true, revealNeedsReason: true };
  const saved = out(await g.policySet(h.ctx, { policy: next }));
  assert.deepEqual(contractErrors("vault.policy.set", "out", saved), []);
  assert.deepEqual(saved.policy, { ...next, exportRoles: ["owner", "admin"] });
  assert.deepEqual(out(await g.policyGet(h.ctx)).policy, saved.policy);
  assert.deepEqual(h.named("policy.changed")[0]?.payload, { key: "vault.policy", scope: "space", kind: "vault", by: MAYA });
  await g.policySet(h.ctx, { policy: { ...next, pullExpiryMax: "1h" } });
  assert.equal(out(out(await g.policyGet(h.ctx)).policy).pullExpiryMax, "1h", "a second save replaces the first");

  assert.equal(await refusedWith(g.policySet(h.ctx, { policy: { ...next, blockRestrictedExport: false } })), "validation.precondition_failed");
  assert.equal(await refusedWith(g.policySet(h.ctx, { policy: { ...next, pullExpiryMax: "30d" } })), "validation.bad_input");
  assert.equal(await refusedWith(g.policySet(h.ctx, { policy: { ...next, exportRoles: "owner" } })), "validation.bad_input");
  assert.equal(await refusedWith(g.policySet(h.ctx, { policy: { ...next, exportRoles: [""] } })), "validation.bad_input");
  assert.equal(await refusedWith(g.policySet(h.ctx, { policy: { ...next, revealNeedsReason: "yes" } })), "validation.bad_input");
  assert.equal(await refusedWith(g.policySet(h.ctx, {} as never)), "validation.bad_input");
});

// ---- match

test("items.match offers the items whose url fits the page, exact host first, never a lookalike", async () => {
  const h = harness();
  const mine = await folder(h, "mine");
  const parent = await put(h, mine, "Example main", login("dana", "pw-1", "https://example.com/login"));
  const sub = await put(h, mine, "Example login", login("dana2", "pw-2", "login.example.com"));
  await put(h, mine, "Lookalike", login("x", "pw-3", "https://evilexample.com"));
  await put(h, mine, "Dash", login("y", "pw-4", "https://evil-example.com"));
  await put(h, mine, "Other", login("z", "pw-5", "https://other.org"));
  await put(h, mine, "No url", login("w", "pw-6"));
  await put(h, mine, "Keyed", [{ key: "email", value: "e@x.com" }, { key: "password", value: "pw-7" }, { key: "url", value: "https://keyed.net" }]);

  const res = out(await g.itemsMatch(h.ctx, { url: "https://login.example.com/signin?next=1" }));
  assert.deepEqual(contractErrors("vault.items.match", "out", res), []);
  const items = res.items as Json[];
  assert.deepEqual(items.map((i) => out(i.item).id), [sub, parent], "the exact host first, then the parent domain");
  assert.deepEqual(items.map((i) => i.usernameField), ["username", "username"]);
  assert.deepEqual((out(await g.itemsMatch(h.ctx, { url: "example.com:8080/x" })).items as Json[]).map((i) => out(i.item).id), [parent]);
  assert.equal((out(await g.itemsMatch(h.ctx, { url: "https://keyed.net" })).items as Json[])[0]?.usernameField, "email");
  assert.deepEqual(out(await g.itemsMatch(h.ctx, { url: "https://nowhere.test" })).items, []);
  assert.ok(!JSON.stringify(res).includes("pw-1") && !JSON.stringify(res).includes("dana"), "names and ids, never a value");
  assert.ok(!h.everything().includes("pw-1"));

  for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "", "   "]) assert.equal(await refusedWith(g.itemsMatch(h.ctx, { url: bad })), "validation.bad_input", bad);
  assert.equal(await refusedWith(g.itemsMatch(h.ctx, { url: 5 as never })), "validation.bad_input");
});

test("items.match never offers what the caller cannot use, skips a locked Mine item and honours never-fill", async () => {
  const h = harness();
  const mine = await folder(h, "mine");
  await put(h, mine, "Maya private", login("m", "pw-m", "https://bank.example.com"));
  const shared = await folder(h, "shared");
  const team = await put(h, shared, "Team bank", login("t", "pw-t", "https://bank.example.com"));
  const page = { url: "https://bank.example.com/" };

  h.actAs("person", ROB);
  assert.deepEqual(out(await g.itemsMatch(h.ctx, page)).items, [], "no grant, no match, and Maya's Mine item never");
  h.grant(ROB, team, "use");
  assert.deepEqual((out(await g.itemsMatch(h.ctx, page)).items as Json[]).map((i) => out(i.item).id), [team]);
  h.actAs("agent", AGENT);
  assert.deepEqual(out(await g.itemsMatch(h.ctx, page)).items, [], "an agent has no grant here either");

  h.actAs("person", MAYA);
  assert.equal((out(await g.itemsMatch(h.ctx, page)).items as Json[]).length, 2);
  h.lock(MAYA);
  assert.deepEqual((out(await g.itemsMatch(h.ctx, page)).items as Json[]).map((i) => out(i.item).id), [team], "the Mine item is skipped, not refused");
  await g.siteRulesSet(h.ctx, { host: "bank.example.com", neverFill: true, neverSave: false });
  assert.deepEqual(out(await g.itemsMatch(h.ctx, page)).items, [], "never fill on this site");
  assert.equal((out(await g.itemsMatch(h.ctx, { url: "https://other.example.com" })).items as Json[]).length, 0);
});

// ---- site rules

test("site rules are personal: set, list, clear, normalise the host and refuse a caller without a person", async () => {
  const h = harness();
  assert.deepEqual(out(await g.siteRulesList(h.ctx)).sites, []);
  const set = out(await g.siteRulesSet(h.ctx, { host: "https://Bank.Example.com:8443/login", neverFill: true, neverSave: true }));
  assert.deepEqual(contractErrors("vault.site_rules.set", "out", set), []);
  assert.deepEqual(set, { host: "bank.example.com", neverFill: true, neverSave: true });
  assert.deepEqual(h.named("vault.site_rule_changed")[0]?.payload, { personId: MAYA, host: "bank.example.com", neverFill: true, neverSave: true });
  assert.equal(h.named("vault.site_rule_changed")[0]?.vis, "owner");
  await g.siteRulesSet(h.ctx, { host: "a.test", neverFill: false, neverSave: true });
  await g.siteRulesSet(h.ctx, { host: "bank.example.com", neverFill: true, neverSave: false });
  const list = out(await g.siteRulesList(h.ctx));
  assert.deepEqual(contractErrors("vault.site_rules.list", "out", list), []);
  assert.deepEqual((list.sites as Json[]).map((s) => [s.host, s.neverFill, s.neverSave]), [["a.test", false, true], ["bank.example.com", true, false]]);

  h.actAs("person", ROB);
  assert.deepEqual(out(await g.siteRulesList(h.ctx)).sites, [], "another person's rules are theirs");
  h.actAs("person", MAYA);
  await g.siteRulesSet(h.ctx, { host: "a.test", neverFill: false, neverSave: false });
  assert.deepEqual((out(await g.siteRulesList(h.ctx)).sites as Json[]).map((s) => s.host), ["bank.example.com"], "both false clears the rule");

  assert.equal(await refusedWith(g.siteRulesSet(h.ctx, { host: "javascript:x", neverFill: true, neverSave: true })), "validation.bad_input");
  assert.equal(await refusedWith(g.siteRulesSet(h.ctx, { host: "", neverFill: true, neverSave: true })), "validation.bad_input");
  assert.equal(await refusedWith(g.siteRulesSet(h.ctx, { host: "a.test", neverFill: "yes" as never, neverSave: true })), "validation.bad_input");
  h.actAs("agent", AGENT);
  assert.equal(await refusedWith(g.siteRulesList(h.ctx)), "permission.no_grant");
  assert.equal(await refusedWith(g.siteRulesSet(h.ctx, { host: "a.test", neverFill: true, neverSave: true })), "permission.no_grant");
  h.ctx.actingFor = MAYA;
  assert.deepEqual((out(await g.siteRulesList(h.ctx)).sites as Json[]).map((s) => s.host), ["bank.example.com"], "a turn run for the person is the person's");
});

// ---- export_mine

test("export_mine gives the person their own Mine items, live and recently removed, in one single-use pull link", async () => {
  const h = harness();
  const mine = await folder(h, "mine");
  const danaId = await put(h, mine, "Dana login", login("dana", SECRET));
  const longGone = await put(h, mine, "Long removed", login("older", "older-secret"));
  await v.itemDelete(h.ctx, { itemId: longGone });
  h.advance(31 * DAY);
  const recent = await put(h, mine, "Recently removed", login("new", "recent-secret"));
  await v.itemDelete(h.ctx, { itemId: recent });
  h.advance(DAY);
  const shared = await folder(h, "shared");
  await put(h, shared, "Team", login("team", "team-secret"));

  const res = out(await g.exportMine(h.ctx, { expiresIn: "1d" }));
  assert.deepEqual(contractErrors("vault.items.export_mine", "out", res), []);
  assert.equal(res.expiresAt, h.ctx.now() + DAY);
  const url = new URL(String(res.pullUrl));
  const env = exportPull(h.ctx, { exportId: String(res.exportId), token: url.searchParams.get("token") ?? "" });
  assert.ok(env.includes(`password=${JSON.stringify(SECRET)}`) && env.includes("recent-secret"), "live and recently removed Mine items");
  assert.ok(!env.includes("older-secret") && !env.includes("team-secret"), "not the ones removed over 30 days ago, and not Shared items");
  assert.equal(await refusedWith(Promise.resolve().then(() => exportPull(h.ctx, { exportId: String(res.exportId), token: url.searchParams.get("token") ?? "" }))), "validation.not_found", "single use");
  assert.ok(!h.everything().includes(SECRET) && !h.everything().includes("recent-secret"), "the database, events and logs hold no value");
  const exports = out(await v.itemHistory(h.ctx, { itemId: danaId })).entries as Json[];
  assert.ok(exports.some((e) => e.action === "exported"), "audited on the item");
});

test("export_mine refuses anyone but the person, a locked key, a Space limit and an empty vault", async () => {
  const h = harness();
  const mine = await folder(h, "mine");
  await put(h, mine, "Dana login", login("dana", SECRET));
  assert.equal(await refusedWith(g.exportMine(h.ctx, { expiresIn: "2d" })), "validation.bad_input");

  h.lock(MAYA);
  assert.equal(await refusedWith(g.exportMine(h.ctx, { expiresIn: "1h" })), "auth.unauthenticated");
  const h2 = harness();
  await put(h2, await folder(h2, "mine"), "Dana login", login("dana", SECRET));
  h2.actAs("agent", AGENT);
  assert.equal(await refusedWith(g.exportMine(h2.ctx, { expiresIn: "1h" })), "permission.no_grant", "an agent without a person to act for");
  h2.actAs("service", "svc_cron0001");
  assert.equal(await refusedWith(g.exportMine(h2.ctx, { expiresIn: "1h" })), "permission.no_grant");
  h2.actAs("person", ROB);
  assert.equal(await refusedWith(g.exportMine(h2.ctx, { expiresIn: "1h" })), "validation.precondition_failed", "Rob has nothing in Mine; Maya's items are not his");

  const h3 = harness();
  await put(h3, await folder(h3, "mine"), "Dana login", login("dana", SECRET));
  await g.policySet(h3.ctx, { policy: { exportRoles: ["owner"], pullExpiryMax: "1h", blockRestrictedExport: true, revealNeedsReason: false } });
  assert.equal(await refusedWith(g.exportMine(h3.ctx, { expiresIn: "1d" })), "validation.precondition_failed", "the Space policy limits pull links");
  assert.equal(out(await g.exportMine(h3.ctx, { expiresIn: "1h" })).exportId !== undefined, true);
  assert.ok(!h3.everything().includes(SECRET));
});

test("the Space policy caps every export link: export_env obeys the same maximum as export_mine", async () => {
  const h = harness();
  const shared = await folder(h, "shared");
  await put(h, shared, "Team", login("team", "team-secret"));
  const policy = (max: string) => g.policySet(h.ctx, { policy: { exportRoles: ["owner"], pullExpiryMax: max, blockRestrictedExport: true, revealNeedsReason: false } });
  assert.equal(await refusedWith(exportEnv(h.ctx, { folderId: shared, expiresIn: "7d" })), "validation.precondition_failed", "no policy: the default maximum is 1 day");
  await policy("7d");
  assert.equal(out(await exportEnv(h.ctx, { folderId: shared, expiresIn: "7d" })).expiresAt, h.ctx.now() + 7 * DAY, "the policy raises the cap, the old settings key does not decide");
  await policy("1d");
  assert.equal(await refusedWith(exportEnv(h.ctx, { folderId: shared, expiresIn: "7d" })), "validation.precondition_failed", "policy max 1 day refuses a 7 day link");
  assert.equal(out(await exportEnv(h.ctx, { folderId: shared, expiresIn: "1d" })).expiresAt, h.ctx.now() + DAY);
  await policy("1h");
  assert.equal(await refusedWith(exportEnv(h.ctx, { folderId: shared, expiresIn: "1d" })), "validation.precondition_failed");
  assert.equal(out(await exportEnv(h.ctx, { folderId: shared, expiresIn: "1h" })).expiresAt, h.ctx.now() + 3_600_000);
});
