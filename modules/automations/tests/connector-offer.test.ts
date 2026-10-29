// A saved Vault item is offered once. A later save, a decline, or an accept does not offer again.
import test from "node:test";
import assert from "node:assert/strict";
import { acceptOffer, declineOffer, offerForSavedItem } from "../connector-offer.ts";
import type { OfferState, SavedItem } from "../connector-offer.ts";

const SENTINEL = "sk_live_SECRET";

function item(itemId: string, name: string, fieldKeys: readonly string[] = []): SavedItem {
  return { itemId, name, fieldKeys };
}

function assertNoSentinel(value: unknown): void {
  assert.equal(JSON.stringify(value).includes(SENTINEL), false);
}

test("first save of vit_stripe named Stripe returns one offer", () => {
  const saved = item("vit_stripe", "Stripe", ["secret_key"]);
  const opened = offerForSavedItem({}, saved);
  assert.deepEqual(opened.offer, {
    itemId: "vit_stripe",
    appName: "Stripe",
    text: "Set up Stripe for Automations?",
  });
  assert.deepEqual(opened.state, { vit_stripe: "open" });
  assert.equal(Object.keys(opened.offer ?? {}).length, 3);
  assertNoSentinel(opened);
});

test("second save of the same id returns offer null", () => {
  const saved = item("vit_stripe", "Stripe");
  const opened = offerForSavedItem({}, saved);
  const again = offerForSavedItem(opened.state, saved);
  assert.equal(again.offer, null);
  assert.equal(again.state, opened.state);
  assert.equal(again.state.vit_stripe, "open");
  assertNoSentinel(again);
});

test("decline, then save again, returns offer null", () => {
  const saved = item("vit_stripe", "Stripe");
  const opened = offerForSavedItem({}, saved);
  const declined = declineOffer(opened.state, "vit_stripe");
  assert.equal(declined.vit_stripe, "declined");
  assert.notEqual(declined, opened.state);
  assert.equal(opened.state.vit_stripe, "open");
  const again = offerForSavedItem(declined, saved);
  assert.equal(again.offer, null);
  assert.equal(again.state.vit_stripe, "declined");
  const missing: OfferState = {};
  assert.equal(declineOffer(missing, "vit_missing"), missing);
  const untouched: OfferState = { vit_stripe: "open" };
  assert.equal(declineOffer(untouched, "vit_other"), untouched);
  assertNoSentinel(declined);
  assertNoSentinel(again);
});

test("accept, then save again, returns offer null", () => {
  const saved = item("vit_stripe", "Stripe");
  const opened = offerForSavedItem({}, saved);
  const accepted = acceptOffer(opened.state, "vit_stripe");
  assert.equal(accepted.vit_stripe, "accepted");
  assert.notEqual(accepted, opened.state);
  assert.equal(opened.state.vit_stripe, "open");
  const again = offerForSavedItem(accepted, saved);
  assert.equal(again.offer, null);
  assert.equal(again.state.vit_stripe, "accepted");
  const untouched: OfferState = { vit_stripe: "open" };
  assert.equal(acceptOffer(untouched, "vit_other"), untouched);
  assertNoSentinel(accepted);
  assertNoSentinel(again);
});

test("a different item id still gets its own offer", () => {
  const stripe = offerForSavedItem({}, item("vit_stripe", "Stripe"));
  const slack = offerForSavedItem(stripe.state, item("vit_slack", "  Slack  ", ["token"]));
  assert.deepEqual(slack.offer, {
    itemId: "vit_slack",
    appName: "Slack",
    text: "Set up Slack for Automations?",
  });
  assert.equal(slack.state.vit_stripe, "open");
  assert.equal(slack.state.vit_slack, "open");
  const afterNo = declineOffer(stripe.state, "vit_stripe");
  const hub = offerForSavedItem(afterNo, item("vit_hub", "HubSpot"));
  assert.equal(hub.offer?.text, "Set up HubSpot for Automations?");
  assert.equal(hub.state.vit_stripe, "declined");
  assert.equal(hub.state.vit_hub, "open");
  assertNoSentinel(slack);
  assertNoSentinel(hub);
});

test("a pasted key in the name or field keys is not copied into any return value", () => {
  const named = item("vit_named", `  ${SENTINEL}  `, [SENTINEL, "publishable"]);
  const opened = offerForSavedItem({}, named);
  assert.deepEqual(opened.offer, {
    itemId: "vit_named",
    appName: "this app",
    text: "Set up this app for Automations?",
  });
  const declined = declineOffer(opened.state, "vit_named");
  const accepted = acceptOffer(opened.state, "vit_named");
  const again = offerForSavedItem(opened.state, named);
  const spaced = offerForSavedItem({}, item("vit_pad", "sk_ live_ SECRET", [SENTINEL]));
  const fieldsOnly = offerForSavedItem({}, item("vit_fields", "Stripe", [SENTINEL]));
  const blank = offerForSavedItem({}, item("vit_blank", " \n\t ", [SENTINEL]));
  assert.equal(spaced.offer?.appName, "this app");
  assert.equal(spaced.offer?.text, "Set up this app for Automations?");
  assert.deepEqual(fieldsOnly.offer, {
    itemId: "vit_fields",
    appName: "Stripe",
    text: "Set up Stripe for Automations?",
  });
  assert.equal(blank.offer?.appName, "this app");
  assert.equal(blank.offer?.text, "Set up this app for Automations?");
  for (const value of [opened, declined, accepted, again, spaced, fieldsOnly, blank]) assertNoSentinel(value);
  assert.equal(JSON.stringify(opened.offer).includes("fieldKeys"), false);
});
