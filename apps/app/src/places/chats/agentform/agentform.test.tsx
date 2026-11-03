// The agent page: a draft that follows what it does, offers that follow the words, and fields that become real capability input.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentForm } from "./AgentForm.tsx";
import { createInput, draftInstructions, faceChoices, faceSeed, grantsFor, reachOffers, updatePatch, workPatch, chatKeyPatch } from "./model.ts";
import type { AgentDraft, VaultItem } from "./model.ts";

const draft: AgentDraft = { name: " Collector ", does: "Chases unpaid invoices", face: "f1", instructions: "", model: "", fallbackModel: "", computer: "own" };
const item = (id: string, name: string): VaultItem => ({ id, name } as VaultItem);

test("a new agent's instructions are drafted from what it does", () => {
  const md = draftInstructions("Collector", "Chases unpaid invoices");
  assert.match(md, /^# Collector/);
  assert.match(md, /Chases unpaid invoices/);
  assert.match(draftInstructions("", ""), /# this agent/);
});

test("the face is a seed; the shuffle and the picker offer fresh ones", () => {
  let n = 0.1;
  const rng = (): number => { n += 0.1; return n; };
  const offered = faceChoices(6, rng);
  assert.equal(new Set(offered).size, 6);
  assert.notEqual(faceSeed(() => 0.2), faceSeed(() => 0.3));
  assert.match(faceSeed(() => 0.2), /^pick-/, "the prefix is how the Avatar tells a picked face from the stored slug");
});

test("Can reach searches the Vault, and with nothing typed it offers what the words name", () => {
  const items = [item("v1", "Invoices API"), item("v2", "Stripe live key"), item("v3", "Gmail login")];
  assert.deepEqual(reachOffers(items, "", draft.does, []).map((i) => i.id), ["v1"]);
  assert.deepEqual(reachOffers(items, "stripe", draft.does, []).map((i) => i.id), ["v2"]);
  assert.deepEqual(reachOffers(items, "", draft.does, ["v1"]), [], "what is picked leaves the offers");
});

test("Can use grants a Shared item at Use and skips a Mine item, which the agent's own turn already reaches", () => {
  const picked = [{ ...item("v1", "Fathom"), scope: "shared" } as VaultItem, { ...item("v2", "My Gmail"), scope: "mine" } as VaultItem];
  assert.deepEqual(grantsFor(picked).map((i) => i.id), ["v1"]);
});

test("the fields become agents.create and agents.update input", () => {
  assert.deepEqual(createInput(draft, "k1"), { name: "Collector", role: "Chases unpaid invoices", face: "f1", computer: true, idempotencyKey: "k1" });
  assert.deepEqual(updatePatch({ ...draft, model: "opus" }), { name: "Collector", role: "Chases unpaid invoices", face: "f1", model: "opus", fallbackModel: null });
});

const page = (team: boolean): string => renderToStaticMarkup(<AgentForm agentId={null} call={async () => ({})} newKey={() => "k"} onDone={() => undefined} onCancel={() => undefined} say={() => undefined} {...(team ? { sharing: { directory: { people: [], groups: [], roles: [], agents: [], channels: [], automations: [] } as never, meName: "Ada", meId: "p1", nameOf: (id: string) => id } } : {})} />);

test("the page draws its sections in order", () => {
  const out = page(true);
  let at = 0;
  for (const s of ["agent-name", "agent-does", "Instructions", "Context", "Can reach", "Computer", "Who can use it", "Preferred model", "Create agent"]) { const i = out.indexOf(s, at); assert.ok(i >= at, s); at = i; }
});

test("Who can use it is hidden in a Personal Space", () => {
  assert.ok(!page(false).includes("Who can use it"));
});

test("AI account sits after Who can use it and before Preferred model, says Automatic, and what it pays for; a Personal Space has none", () => {
  const out = page(true).replaceAll("<!-- -->", "");
  let at = 0;
  for (const s of ["Who can use it", "AI account", "Preferred model"]) { const i = out.indexOf(s, at); assert.ok(i >= at, s); at = i; }
  assert.match(out, /aria-label="AI account: Automatic. Change"[^>]*data-testid="agent-ai-account"/);
  assert.ok(out.includes("Cheapest that fits"));
  assert.ok(out.includes("Pays for its own work: routines, watchers and helpers that run with nobody asking."));
  assert.ok(out.includes("In a chat, the person&#x27;s own account comes first."));
  assert.ok(!page(false).includes("agent-ai-account"), "a Personal agent runs on its person's own account");
});

test("the AI account is sent only when it changed: a pick on a new agent, a pick on a saved one, back to Automatic, and nothing when untouched", () => {
  assert.deepEqual(workPatch("#Team_Credits", ""), { workKey: "#Team_Credits" });
  assert.deepEqual(workPatch("", ""), {}, "a new agent left on Automatic sends nothing");
  assert.deepEqual(workPatch(undefined, ""), {});
  assert.deepEqual(workPatch("#Team_Credits", "#Team_Credits"), {});
  assert.deepEqual(workPatch("#Other", "#Team_Credits"), { workKey: "#Other" });
  assert.deepEqual(workPatch("", "#Team_Credits"), { workKey: null });
  assert.deepEqual(updatePatch({ ...draft, workKey: "#X" }), { name: "Collector", role: "Chases unpaid invoices", face: "f1", model: null, fallbackModel: null }, "the form sends the account through workPatch, not updatePatch");
});

test("the Chat key sits under AI account as its own choice, off by default, with its own words", () => {
  const out = page(true).replaceAll("<!-- -->", "");
  assert.ok(out.indexOf("AI account") < out.indexOf("Chat key") && out.indexOf("Chat key") < out.indexOf("Preferred model"));
  assert.ok(out.includes("Pay for chats with this account instead of each person&#x27;s own"));
  assert.match(out, /role="switch"[^>]*aria-checked="false"[^>]*data-testid="agent-chat-key"|aria-checked="false"[^>]*data-testid="agent-chat-key"/, "a switch, off");
  assert.ok(!out.includes("agent-chat-key-account"), "the account menu is there only when it is on");
  assert.ok(out.includes("Only people who manage the Space&#x27;s AI accounts can turn this on."), "a person who cannot manage the Space's AI accounts sees it off and why");
});

test("the Chat key is sent only when it changed: on names the account, off hands chats back to each person's own", () => {
  assert.deepEqual(chatKeyPatch("", ""), {});
  assert.deepEqual(chatKeyPatch(undefined, ""), {});
  assert.deepEqual(chatKeyPatch("#Team_Credits", ""), { accountPolicy: "key", accountKey: "#Team_Credits" });
  assert.deepEqual(chatKeyPatch("#Team_Credits", "#Team_Credits"), {});
  assert.deepEqual(chatKeyPatch("", "#Team_Credits"), { accountPolicy: "asker", accountKey: null });
});
