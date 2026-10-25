// Access reviews through the real handlers (spec 2.3, ARCH 7.10): a review makes one Review task per reviewer, keep or remove is one click per grant, and the quarterly job continues itself.
// contract tests for review: the quarterly review creates one task per reviewer.
// @reads /generated/registry.json
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import type { JsonSchema } from "../../../packages/contracts/src/types.ts";
import { handlers } from "../impl.ts";
import { QUARTERLY } from "../handlers/review.ts";
import { codeOf, NOW } from "../fixtures/requestdb.ts";
import { can, grant, world } from "../fixtures/askworld.ts";

interface RegCap { name: string; output: JsonSchema }
const registry = JSON.parse(readFileSync(new URL("../../../generated/registry.json", import.meta.url), "utf8")) as { $defs: Record<string, JsonSchema>; capabilities: RegCap[] };
const outputOk = (cap: string, out: unknown): void => {
  const c = registry.capabilities.find((x) => x.name === cap)!;
  assert.deepEqual(validate(c.output, out, "", registry.$defs), [], `${cap} output`);
};

const DAY = 86_400_000;
const start = (h: ReturnType<typeof world>["h"], extra: Record<string, unknown> = {}) =>
  handlers["access.reviews.start"](h.as("usr_admin"), { idempotencyKey: "idem_review", ...extra } as never);
const itemRows = (h: ReturnType<typeof world>["h"]) => h.db.own.rows("access_review_items");

test("a review lists every live grant and makes one Review task per reviewer, holding their whole share", async () => {
  const { h, store } = world();
  store.grants.set("gnt_old", grant("gnt_old", "usr_other", { type: "folder", id: "fld_1" }, "view", { conditions: { expiresAt: NOW - 1 } }));
  store.bump();
  const { review } = await start(h);
  outputOk("access.reviews.start", { review });
  assert.deepEqual([review.state, review.items, review.decided, review.openedAt], ["open", 3, 0, NOW], "the expired grant is not reviewed");

  const tasks = h.calls.filter((c) => c.cap === "tasks.create");
  assert.deepEqual(tasks.map((t) => (t.input["assigned"] as { id: string }).id), ["usr_admin", "usr_mgr"], "one task per reviewer, in a steady order");
  assert.ok(tasks.every((t) => t.input["kind"] === "review"));
  assert.ok(tasks.every((t) => (t.input["source"] as { id: string }).id === review.id));
  assert.equal(tasks[0]!.input["title"], "Access review: 2 grants to check");
  assert.equal(tasks[1]!.input["title"], "Access review: 1 grant to check");
  assert.equal(tasks[0]!.input["due"], NOW + 14 * DAY);
  const rows = (tasks[0]!.input["blocks"] as { data: { rows: string[][] } }[])[0]!.data.rows;
  assert.deepEqual(rows, [["mgr", "manage", "folder fld_1"], ["mgr2", "manage", "folder fld_2"]]);

  // the Manage holder of fld_1 is the only one who can review Maya's view; the managers' own grants go to an admin
  assert.deepEqual(itemRows(h).map((r) => [r["grant_id"], r["reviewer"]]), [["gnt_maya", "usr_mgr"], ["gnt_mgr1", "usr_admin"], ["gnt_mgr2", "usr_admin"]].sort((a, b) => (a[0]! < b[0]! ? -1 : 1)));
  assert.equal(new Set(itemRows(h).filter((r) => r["reviewer"] === "usr_admin").map((r) => r["task_id"])).size, 1, "an admin's two items share one card");
  assert.deepEqual(h.events, [{ name: "access_review.opened", subject: review.id, payload: { reviewId: review.id, items: 3 } }]);
});

test("the owner of a resource reviews the grants on it", async () => {
  const { h, store } = world();
  store.resources.get("fld_2")!.ownerId = "usr_other";
  store.bump();
  await start(h);
  const mine = itemRows(h).find((r) => r["grant_id"] === "gnt_mgr2")!;
  assert.equal(mine["reviewer"], "usr_other");
});

test("scope limits the review to resource types, an empty Space opens an empty review, and the same key is the same review", async () => {
  const { h } = world();
  const none = await start(h, { scope: ["space"], idempotencyKey: "idem_space" });
  assert.equal(none.review.items, 0);
  assert.equal(h.calls.filter((c) => c.cap === "tasks.create").length, 0, "no grants, no cards");
  const all = await start(h, { scope: ["folder"], idempotencyKey: "idem_folder" });
  assert.equal(all.review.items, 3);
  h.calls.length = 0;
  h.events.length = 0;
  assert.deepEqual(await start(h, { scope: ["folder"], idempotencyKey: "idem_folder" }), all);
  assert.equal(h.calls.length, 0);
  assert.equal(h.events.length, 0);
});

test("remove takes the access away at once, keep leaves it, and a reviewer's card finishes with their last grant", async () => {
  const { h, store } = world();
  const { review } = await start(h);
  h.events.length = 0;
  h.calls.length = 0;
  assert.equal(can(h, store, "usr_maya", "view", { type: "folder", id: "fld_1" }), true);

  assert.deepEqual(await handlers["access.reviews.decide"](h.as("usr_mgr"), { reviewId: review.id, grantId: "gnt_maya", decision: "remove" }), { ok: true });
  assert.equal(can(h, store, "usr_maya", "view", { type: "folder", id: "fld_1" }), false, "Maya lost the access");
  assert.deepEqual(h.events.map((e) => e.name), ["grant.revoked", "access.changed"]);
  assert.deepEqual(h.events[0]!.payload, { grantId: "gnt_maya", subject: { kind: "person", id: "usr_maya" }, resource: { type: "folder", id: "fld_1" }, reason: `access review ${review.id}` });
  assert.deepEqual(h.calls.map((c) => [c.cap, c.input["note"]]), [["tasks.transition", "Every grant decided"]], "usr_mgr had one grant, so the card is done");

  h.calls.length = 0;
  await handlers["access.reviews.decide"](h.as("usr_admin"), { reviewId: review.id, grantId: "gnt_mgr1", decision: "keep" });
  assert.deepEqual(h.calls, [], "the admin still has a grant to decide");
  assert.equal(can(h, store, "usr_mgr", "manage", { type: "folder", id: "fld_1" }), true, "keep changes nothing");
  await handlers["access.reviews.decide"](h.as("usr_admin"), { reviewId: review.id, grantId: "gnt_mgr2", decision: "keep" });
  assert.deepEqual(h.calls.map((c) => c.cap), ["tasks.transition"]);

  const got = await handlers["access.reviews.get"](h.as("usr_admin"), { reviewId: review.id });
  outputOk("access.reviews.get", got);
  assert.deepEqual([got.review.items, got.review.decided], [3, 3]);
  assert.deepEqual(got.items.map((i) => [(i.grant as { id: string }).id, i.decision]), [["gnt_maya", "remove"], ["gnt_mgr1", "keep"], ["gnt_mgr2", "keep"]]);
  assert.equal((got.items[0]!.grant as { level: string }).level, "view", "a removed grant still shows what it was");
});

test("a decision can repeat, a removed grant stays removed, and unknown reviews and grants are not found", async () => {
  const { h } = world();
  const { review } = await start(h);
  const decide = (reviewId: string, grantId: string, decision: "keep" | "remove") => handlers["access.reviews.decide"](h.as("usr_admin"), { reviewId, grantId, decision });
  await decide(review.id, "gnt_maya", "remove");
  h.events.length = 0;
  assert.deepEqual(await decide(review.id, "gnt_maya", "remove"), { ok: true });
  assert.equal(h.events.length, 0, "the repeat does nothing");
  await assert.rejects(decide(review.id, "gnt_maya", "keep"), (e: unknown) => codeOf(e) === "validation.precondition_failed");
  await assert.rejects(decide(review.id, "gnt_nope", "keep"), (e: unknown) => codeOf(e) === "validation.not_found");
  await assert.rejects(decide("rvw_nope", "gnt_maya", "keep"), (e: unknown) => codeOf(e) === "validation.not_found");
});

test("closing counts what stayed and what went, finishes the cards still open, and a closed review takes no more decisions", async () => {
  const { h } = world();
  const { review } = await start(h);
  await handlers["access.reviews.decide"](h.as("usr_mgr"), { reviewId: review.id, grantId: "gnt_maya", decision: "remove" });
  await handlers["access.reviews.decide"](h.as("usr_admin"), { reviewId: review.id, grantId: "gnt_mgr1", decision: "keep" });
  h.events.length = 0;
  h.calls.length = 0;
  h.advance(5000);
  const closed = await handlers["access.reviews.close"](h.as("usr_admin"), { reviewId: review.id });
  outputOk("access.reviews.close", closed);
  assert.deepEqual([closed.review.state, closed.review.closedAt, closed.review.items, closed.review.decided], ["closed", NOW + 5000, 3, 2]);
  assert.deepEqual(h.events, [{ name: "access_review.closed", subject: review.id, payload: { reviewId: review.id, kept: 2, removed: 1 } }]);
  assert.deepEqual(h.calls.map((c) => [c.cap, c.input["note"]]), [["tasks.transition", "Review closed"]], "only the admin's card was still open");

  h.events.length = 0;
  assert.deepEqual(await handlers["access.reviews.close"](h.as("usr_admin"), { reviewId: review.id }), closed, "closing again is the same answer");
  assert.equal(h.events.length, 0);
  await assert.rejects(handlers["access.reviews.decide"](h.as("usr_admin"), { reviewId: review.id, grantId: "gnt_mgr2", decision: "keep" }), (e: unknown) => codeOf(e) === "validation.precondition_failed");
});

test("the quarterly job schedules its own next run from the setting, and a manual review does not", async () => {
  const { h } = world({ "settings.get": { value: 30 } });
  await start(h, { idempotencyKey: `${QUARTERLY}1` });
  assert.deepEqual(h.scheduled, [{ at: NOW + 30 * DAY, cap: "access.reviews.start", input: { idempotencyKey: `${QUARTERLY}${NOW + 30 * DAY}` } }]);

  h.scheduled.length = 0;
  await start(h, { idempotencyKey: "idem_manual" });
  assert.deepEqual(h.scheduled, []);

  h.answers.set("settings.get", new Error("settings are down"));
  await start(h, { idempotencyKey: `${QUARTERLY}2` });
  assert.equal(h.scheduled[0]!.at, NOW + 90 * DAY, "the default is 90 days");
  h.scheduled.length = 0;
  h.answers.set("settings.get", { value: 3 });
  await start(h, { idempotencyKey: `${QUARTERLY}3` });
  assert.equal(h.scheduled[0]!.at, NOW + 90 * DAY, "a value below the setting's minimum of 7 is ignored");
});

test("the list filters by state, newest first, and counts decisions", async () => {
  const { h } = world();
  const a = await start(h, { idempotencyKey: "idem_a" });
  h.advance(1000);
  const b = await start(h, { idempotencyKey: "idem_b" });
  await handlers["access.reviews.decide"](h.as("usr_admin"), { reviewId: a.review.id, grantId: "gnt_maya", decision: "keep" });
  await handlers["access.reviews.close"](h.as("usr_admin"), { reviewId: a.review.id });
  const all = await handlers["access.reviews.list"](h.as("usr_admin"), {});
  outputOk("access.reviews.list", all);
  assert.deepEqual(all.reviews.map((r) => [r.id, r.state, r.decided]), [[b.review.id, "open", 0], [a.review.id, "closed", 1]]);
  assert.deepEqual((await handlers["access.reviews.list"](h.as("usr_admin"), { state: "open" })).reviews.map((r) => r.id), [b.review.id]);
  const first = await handlers["access.reviews.list"](h.as("usr_admin"), { limit: 1 });
  assert.deepEqual([first.total, first.next], [2, "1"]);
});
