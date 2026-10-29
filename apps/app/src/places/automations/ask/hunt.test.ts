import test from "node:test";
import assert from "node:assert/strict";
import { shouldHunt } from "./hunt.ts";
import type { AskTurn } from "./plan.ts";

const account = { app: "stripe", id: "con_1", title: "Stripe", state: "active" };

test("stripe with no catalog step is hunted and a catalog app is not", () => {
  const missing: AskTurn = { kind: "need_doc", app: "stripe", say: "Paste the document." };
  const linked: AskTurn = { kind: "use", app: "stripe", account, stepKey: null, action: null, say: "Use it." };
  const gmail: AskTurn = { kind: "use", app: "google", account: { ...account, app: "google" }, stepKey: "google.gmail.list_messages", action: null, say: "Use it." };
  const chosen: AskTurn = { kind: "use", app: "stripe", account, stepKey: "connector_request", action: "list", say: "Use it." };
  const sign: AskTurn = { kind: "sign_in", app: "stripe", service: "stripe", stepKey: null, say: "Sign in." };
  const slack: AskTurn = { kind: "need_doc", app: "slack", say: "Paste the document." };
  const blank: AskTurn = { kind: "need_doc", app: "", say: "Name an app." };
  assert.equal(shouldHunt(missing), true);
  assert.equal(shouldHunt(linked), true);
  assert.equal(shouldHunt(gmail), false);
  assert.equal(shouldHunt(chosen), false);
  assert.equal(shouldHunt(sign), false);
  assert.equal(shouldHunt(slack), true);
  assert.equal(shouldHunt(blank), false);
});
