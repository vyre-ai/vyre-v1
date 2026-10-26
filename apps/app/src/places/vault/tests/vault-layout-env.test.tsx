// Vault ItemEnv and AddAnything, the pure part: a pasted .env parses to fields, one bare key is matched to its app by shape, JSON and links become fields, the Edit sheet's diff and
// update input, the masked .env block, and the list rules (dates, second line, handles, arrow steps). No renderer.
import test from "node:test";
import assert from "node:assert/strict";
import { MASK, diffEnv, diffWords, filterTemplates, fieldsFor, formatEnv, guessSecret, mergeFields, normalizeKey, parseEnv, rowsToText, templateById, textToRows, understandPaste, updateFromText } from "../itemenv/env.ts";
import { accessLine, agoLabel, countItems, handleFor, secondLine, stepIndex, usedLabel, visibleItems } from "../layout/model.ts";
import type { Item } from "../layout/model.ts";

const item = (o: Partial<Item> & { id: string; name: string }): Item => ({
  kind: "api_key", folderId: "fld_a", owner: "usr_a", scope: "shared", fieldKeys: [], handle: `#S_${o.name}`, spaceOnly: false, injectIntoDeployments: false, yourLevel: "manage", label: 0, createdAt: 0, updatedAt: 0, ...o,
});

test("paste parses KEY=value: quotes, export, comments, a trailing comment, bad lines skipped", () => {
  const { fields, skipped } = parseEnv(`# Northwind\nexport GHL_PIT="pit-abc 123"\nGHL_LOCATION_ID=nwLoc7Kq  # main site\n\nnot a line\n9BAD=1\nGHL_LOCATION_ID=nwLoc8`);
  assert.deepEqual(fields.map((f) => [f.key, f.value]), [["GHL_PIT", "pit-abc 123"], ["GHL_LOCATION_ID", "nwLoc8"]], "a later line wins");
  assert.equal(skipped, 2);
  assert.equal(fields[0]!.secret, true, "a PIT is secret");
  assert.equal(fields[1]!.secret, false, "an id is plain");
});

test("paste understanding: a .env becomes a field per line named by its prefix", () => {
  const u = understandPaste("STRIPE_SECRET_KEY=sk_live_abc123\nSTRIPE_WEBHOOK_SECRET=whsec_def456\n");
  assert.equal(u.shape, "env");
  assert.equal(u.itemKind, "env");
  assert.equal(u.name, "Stripe");
  assert.deepEqual(u.fields.map((f) => f.key), ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]);
  assert.match(u.note, /2 keys/);
});

test("paste understanding: one bare key is matched to its app by shape and named from its type", () => {
  const cases: [string, string, string][] = [
    ["sk_live_51NwFakeFakeFake00aa", "STRIPE_SECRET_KEY", "stripe"], // secret-scan: fake
    ["ghp_16C7e42F292c6912E7710c838347Ae178B4a", "GITHUB_TOKEN", "github"], // secret-scan: fake
    ["sk-ant-api03-abcdefghijklmnop", "ANTHROPIC_API_KEY", "anthropic"],
    ["sk-proj-Qm7Lx2Vd9aRt4Ne8Zb1WcKfG3hYjU6oP", "OPENAI_API_KEY", "openai"], // secret-scan: fake
    ["xoxb-123-456-abc", "SLACK_BOT_TOKEN", "slack"], // secret-scan: fake
    ["AC0123456789abcdef0123456789abcdef", "TWILIO_ACCOUNT_SID", "twilio"],
    ["pit-7c1e4a2b-90d1-4b9e-8a52-3e6d1f0aa417", "GHL_PIT", "highlevel"],
  ];
  for (const [value, key, template] of cases) {
    const u = understandPaste(value);
    assert.equal(u.shape, "key", value);
    assert.equal(u.template, template, value);
    assert.deepEqual(u.fields, [{ key, value, secret: true }], value);
  }
  const unknown = understandPaste("Zx81-unknown-shape-0001");
  assert.deepEqual(unknown.fields, [{ key: "API_KEY", value: "Zx81-unknown-shape-0001", secret: true }]);
  assert.equal(unknown.template, undefined);
});

test("paste understanding: JSON becomes keys from its top level, a link becomes URL, username and password", () => {
  const j = understandPaste(JSON.stringify({ type: "service_account", project_id: "northwind-prod", private_key: "-----BEGIN-----", client_email: "bot@x.example", nested: { a: 1 } }));
  assert.equal(j.shape, "json");
  assert.deepEqual(j.fields.map((f) => [f.key, f.secret]), [["TYPE", false], ["PROJECT_ID", false], ["PRIVATE_KEY", true], ["CLIENT_EMAIL", false]]);
  assert.equal(j.name, "Northwind-prod service account");
  const l = understandPaste("https://ops:Pw%21x@accounts.google.com/signin");
  assert.equal(l.shape, "url");
  assert.equal(l.itemKind, "login");
  assert.equal(l.name, "Accounts");
  assert.deepEqual(l.fields.map((f) => f.key), ["URL", "USERNAME", "PASSWORD"]);
  assert.equal(l.fields[0]!.value, "https://accounts.google.com/signin", "the password is not left in the URL field");
  assert.equal(l.fields[1]!.value, "ops");
  assert.equal(l.fields[2]!.value, "Pw!x");
  const db = understandPaste("postgres://app:pw@db.example.com:5432/prod");
  assert.deepEqual(db.fields.map((f) => [f.key, f.secret]), [["DATABASE_URL", true]]);
  assert.equal(understandPaste("   ").shape, "none");
  assert.equal(understandPaste("two words and more").shape, "text");
});

test("the Add form: templates, the reel filter keeps Custom first, a paste fills a template's fields", () => {
  assert.equal(filterTemplates("")[0]!.id, "custom");
  assert.deepEqual(filterTemplates("str").map((t) => t.id), ["custom", "stripe"]);
  const stripe = templateById("stripe")!;
  const form = fieldsFor(stripe);
  assert.deepEqual(form.map((f) => [f.key, f.value]), [["STRIPE_SECRET_KEY", ""], ["STRIPE_WEBHOOK_SECRET", ""]]);
  const merged = mergeFields(form, understandPaste("sk_live_abc123").fields);
  assert.equal(merged.length, 2, "the pasted key fills its row, no duplicate");
  assert.equal(merged.find((f) => f.key === "STRIPE_SECRET_KEY")!.value, "sk_live_abc123");
  assert.equal(normalizeKey("ghl location-id"), "GHL_LOCATION_ID");
  assert.equal(normalizeKey("9 lives"), "LIVES");
});

test("the .env block prints the mask unless a value was revealed", () => {
  const fields = [{ key: "GHL_PIT" }, { key: "GHL_LOCATION_ID" }];
  assert.equal(formatEnv(fields), `GHL_PIT=${MASK}\nGHL_LOCATION_ID=${MASK}`);
  assert.equal(formatEnv(fields, new Map([["GHL_LOCATION_ID", "nwLoc7"]])), `GHL_PIT=${MASK}\nGHL_LOCATION_ID=nwLoc7`);
  assert.equal(guessSecret("DATABASE_URL"), false);
  assert.equal(guessSecret("STRIPE_SECRET_KEY"), true);
  assert.equal(guessSecret("PASSWORD"), true);
});

test("Edit: the diff names what will be added, changed and removed; a masked value keeps the stored one", () => {
  const keys = ["GHL_PIT", "GHL_LOCATION_ID", "OLD_KEY"];
  const same = rowsToText(keys.map((key) => ({ key, value: "", secret: true })));
  assert.equal(same, keys.map((k) => `${k}=${MASK}`).join("\n"));
  assert.equal(diffWords(diffEnv(keys, same)), "No changes");
  const text = `GHL_PIT=pit-new\nGHL_LOCATION_ID=${MASK}\nGHL_PIPELINE_ID=pl_9f2c`;
  const d = diffEnv(keys, text);
  assert.deepEqual(d, { added: ["GHL_PIPELINE_ID"], changed: ["GHL_PIT"], removed: ["OLD_KEY"] });
  assert.equal(diffWords(d), "Add GHL_PIPELINE_ID · Change GHL_PIT · Remove OLD_KEY");
  const up = updateFromText([{ key: "GHL_PIT", secret: true }, { key: "GHL_LOCATION_ID", secret: false }, { key: "OLD_KEY", secret: true }], text);
  assert.deepEqual(up.fieldsRemove, ["OLD_KEY"]);
  assert.deepEqual(up.fieldsSet.map((f) => [f.key, f.value, f.secret]), [["GHL_PIPELINE_ID", "pl_9f2c", false], ["GHL_PIT", "pit-new", true]], "an existing key keeps its secret flag; a new id is plain");
  const rows = textToRows(text, [{ key: "GHL_PIT", value: "", secret: true }]);
  assert.equal(rows[0]!.secret, true);
  assert.equal(updateFromText([], "NEW_KEY=").fieldsSet[0]!.value, "", "a new field with no value is saved empty, never the mask");
});

test("list rules: used labels, history labels, the second line, handles and the access sentence", () => {
  const now = Date.UTC(2025, 9, 24, 10, 0, 0);
  const c = { now };
  assert.equal(usedLabel(now - 30_000, c), "Used just now");
  assert.equal(usedLabel(now - 14 * 60_000, c), "Used 14 min ago");
  assert.equal(usedLabel(now - 3 * 3_600_000, c), "Used 3 h ago");
  assert.equal(usedLabel(now - 30 * 3_600_000, c), "Used yesterday");
  assert.equal(usedLabel(now - 5 * 86_400_000, c), "Used 5 days ago");
  assert.equal(usedLabel(now - 40 * 86_400_000, c), "Used Sep 14");
  assert.equal(usedLabel(undefined, c), "Never used");
  assert.equal(agoLabel(now - 2 * 3_600_000, c), "2 h ago");
  assert.equal(secondLine(item({ id: "a", name: "GHL", fieldKeys: ["GHL_PIT", "GHL_LOCATION_ID"] })), "GHL_PIT · GHL_LOCATION_ID");
  assert.equal(secondLine(item({ id: "b", name: "Forms", kind: "login", fieldKeys: ["USERNAME", "PASSWORD"] })), "Login · USERNAME · PASSWORD");
  assert.equal(handleFor("Northwind", "Google service account"), "#Northwind_Google_service_account");
  assert.equal(handleFor("Northwind", "  "), "");
  assert.equal(accessLine(item({ id: "c", name: "x", scope: "mine", yourLevel: "manage" }), undefined), "Only you can use it · Mine");
  assert.equal(accessLine(item({ id: "d", name: "x", yourLevel: "edit", spaceOnly: true }), { id: "fld_a", name: "Marketing", scope: "shared", owner: "u", itemCount: 1, whoCanExport: [], yourLevel: "manage" }), "You can change it · Shared › Marketing · Space only");
});

test("sections, search and the arrow keys", () => {
  const items = [
    item({ id: "1", name: "Stripe", kind: "api_key", fieldKeys: ["STRIPE_SECRET_KEY"], lastUsedAt: 50 }),
    item({ id: "2", name: "Forms", kind: "login", fieldKeys: ["USERNAME"], lastUsedAt: 90 }),
    item({ id: "3", name: "Visa", kind: "card", scope: "mine", lastUsedAt: 10 }),
    item({ id: "4", name: "Claude", kind: "ai_subscription", scope: "mine" }),
  ];
  const c = countItems(items, new Set(), { total: 4, weak: 0, reused: 0, stale: 1, rotationDue: 1, items: [] }, 2);
  assert.deepEqual([c.all, c.providers, c.keys, c.logins, c.cards, c.mine, c.health, c.requested], [4, 1, 1, 1, 1, 2, 2, 2]);
  assert.deepEqual(visibleItems(items, { kind: "all" }, "", new Set(), new Set()).map((i) => i.name), ["Forms", "Stripe", "Visa", "Claude"], "most recently used first, never used last");
  assert.deepEqual(visibleItems(items, { kind: "all" }, "secret", new Set(), new Set()).map((i) => i.name), ["Stripe"], "search reads names and field names");
  assert.deepEqual(visibleItems(items, { kind: "all" }, "hunter2", new Set(), new Set()), [], "search never reads values");
  assert.equal(stepIndex(-1, 3, 1), 0);
  assert.equal(stepIndex(-1, 3, -1), 2);
  assert.equal(stepIndex(2, 3, 1), 2, "stays inside the list");
  assert.equal(stepIndex(0, 0, 1), -1);
});
