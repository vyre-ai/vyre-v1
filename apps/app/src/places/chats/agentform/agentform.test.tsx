// The agent page: a draft that follows what it does, offers that follow the words, and fields that become real capability input.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentForm } from "./AgentForm.tsx";
import { createInput, draftInstructions, faceChoices, faceSeed, grantsFor, reachOffers, updatePatch } from "./model.ts";
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
