import test from "node:test";
import assert from "node:assert/strict";
import { ADD_CHOICES, addTarget, aiTiles, otherTemplates, sectionOf } from "./sections.ts";
import { TEMPLATES } from "../itemenv/env.ts";

const it = (o: Partial<{ id: string; kind: string; name: string; handle: string; folderId: string }>) => ({ id: "vit_1", kind: "api_key", name: "Key", handle: "#Key", folderId: "vfd_1", ...o });
const folders: Record<string, string> = { vfd_co: "Company connections", vfd_cn: "Connections", vfd_1: "Ops" };
const name = (id: string): string | undefined => folders[id];

test("each item has one primary section: AI accounts, Google and Microsoft, Connections, else everything else", () => {
  const providers = new Set(["vit_ai"]);
  assert.equal(sectionOf(it({ id: "vit_ai", name: "OpenRouter" }), providers, name), "ai");
  assert.equal(sectionOf(it({ kind: "ai_subscription", name: "Claude" }), providers, name), "ai");
  assert.equal(sectionOf(it({ name: "Google_DWD", handle: "#Google_DWD" }), providers, name), "google");
  assert.equal(sectionOf(it({ name: "Sso_Google_Secret", handle: "#Sso_Google_Secret" }), providers, name), "google");
  assert.equal(sectionOf(it({ name: "Microsoft App", handle: "#Microsoft_App" }), providers, name), "google");
  assert.equal(sectionOf(it({ name: "Tenant secret", handle: "#Tenant_secret", folderId: "vfd_co" }), providers, name), "google", "the company connection's folder");
  assert.equal(sectionOf(it({ name: "Monday token", handle: "#Monday_token", folderId: "vfd_cn" }), providers, name), "connections");
  assert.equal(sectionOf(it({ name: "Twilio", handle: "#Twilio" }), providers, name), "other");
  assert.equal(sectionOf(it({ kind: "login", name: "Gusto", handle: "#Gusto" }), providers, name), "other", "a name that only starts with g is not Google");
  // an item that could be in two places is shown in its primary one: an AI key kept in the company folder is an AI account
  assert.equal(sectionOf(it({ id: "vit_ai", name: "Google Gemini", handle: "#Google_Gemini", folderId: "vfd_co" }), providers, name), "ai");
});

test("the + adds the page's own kind; in All and the folders it asks first, with four rows in order", () => {
  assert.equal(addTarget({ kind: "providers" }), "ai");
  assert.equal(addTarget({ kind: "google" }), "google");
  assert.equal(addTarget({ kind: "connections" }), "connections");
  for (const k of ["keys", "logins", "cards"]) assert.equal(addTarget({ kind: k }), "other");
  for (const k of ["all", "mine", "folder", "health", "requested"]) assert.equal(addTarget({ kind: k }), "ask");
  assert.deepEqual(ADD_CHOICES.map((c) => c.title), ["An AI account", "Google or Microsoft", "An app or tool server", "A key, login or card"]);
  assert.deepEqual(ADD_CHOICES.map((c) => c.target), ["ai", "google", "connections", "other"]);
});

test("the pickers list only their own kinds: AI tiles say their one step; the everything-else reel has no AI or Google template", () => {
  assert.deepEqual(aiTiles([{ key: "claude-code", name: "Claude", connections: ["subscription"] }, { key: "openrouter", name: "OpenRouter", connections: ["api_key"] }, { key: "local", name: "Local model", connections: ["local_model"] }]).map((t) => t.step), ["Sign in", "Paste a key", "Model address"]);
  const reel = otherTemplates(TEMPLATES).map((t) => t.id);
  assert.ok(!reel.includes("openai") && !reel.includes("anthropic"), reel.join());
  for (const id of ["custom", "login", "card", "twilio", "stripe", "github"]) assert.ok(reel.includes(id), id);
});
