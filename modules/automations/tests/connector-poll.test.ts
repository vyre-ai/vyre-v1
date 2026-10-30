// A polling trigger: the first read records what exists, a new item fires once, the cursor moves, and a failure waits longer each time.
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeConnector } from "../connector-def.ts";
import type { PollTrigger } from "../connector-def.ts";
import { advance, backoff, cursorQuery, freshState, retryAfterMs, SEEN_LIMIT } from "../connector-poll.ts";

function trigger(cursor: Record<string, unknown>, extra: Record<string, unknown> = {}): PollTrigger {
  const r = normalizeConnector({
    app: "acme", title: "Acme", domains: ["api.acme.test"], auth: { type: "none" },
    actions: [{ key: "list", title: "List", method: "GET", path: "/v1/items", params: [{ name: "after", in: "query" }, { name: "since", in: "query" }, { name: "page", in: "query" }] }],
    triggers: [{ key: "new_item", title: "New item", kind: "poll", action: "list", intervalSec: 120, items: "/data", idField: "id", cursor, ...extra }],
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  return (r as { def: { triggers: PollTrigger[] } }).def.triggers[0]!;
}
const reply = (...ids: (number | string)[]): { data: { id: number | string; updated: string }[] } => ({ data: ids.map((id) => ({ id, updated: `2026-10-0${Number(id) % 9 + 1}T00:00:00.000Z` })) });
const ok = <T>(r: T | { error: string }): T => { assert.equal("error" in (r as object), false, JSON.stringify(r)); return r as T; };

test("the first read primes the state and fires nothing", () => {
  const t = trigger({ mode: "none" });
  const a = ok(advance(t, freshState(), reply(3, 2, 1), 1_000));
  assert.deepEqual(a.fresh, []);
  assert.equal(a.state.primed, true);
  assert.deepEqual(a.state.seen.sort(), ["1", "2", "3"]);
  assert.equal(a.state.nextAt, 1_000 + 120_000);
});

test("a new item fires once, oldest first, and a repeat fires nothing", () => {
  const t = trigger({ mode: "none" });
  const primed = ok(advance(t, freshState(), reply(2, 1), 0)).state;
  const next = ok(advance(t, primed, reply(5, 4, 2, 1), 10));
  assert.deepEqual(next.fresh.map((f) => f.id), ["4", "5"]);
  const again = ok(advance(t, next.state, reply(5, 4, 2, 1), 20));
  assert.deepEqual(again.fresh, []);
});

test("order oldest_first reads the list the other way", () => {
  const t = trigger({ mode: "none" }, { order: "oldest_first" });
  const primed = ok(advance(t, freshState(), reply(1, 2), 0)).state;
  const next = ok(advance(t, primed, reply(1, 2, 3, 4), 10));
  assert.deepEqual(next.fresh.map((f) => f.id), ["3", "4"]);
});

test("after_id keeps the largest id and sends it back", () => {
  const t = trigger({ mode: "after_id", param: "after" });
  const a = ok(advance(t, freshState(), reply(9, 10, 2), 0));
  assert.equal(a.state.cursor, "10");
  assert.deepEqual(cursorQuery(t, a.state), { after: "10" });
  assert.deepEqual(cursorQuery(t, freshState()), {});
});

test("updated_since keeps the newest time and formats it for the app", () => {
  const iso = trigger({ mode: "updated_since", param: "since", field: "updated", format: "iso" });
  const a = ok(advance(iso, freshState(), { data: [{ id: 1, updated: "2026-10-02T10:00:00.000Z" }, { id: 2, updated: "2026-10-05T10:00:00.000Z" }] }, 0));
  assert.equal(cursorQuery(iso, a.state)["since"], "2026-10-05T10:00:00.000Z");
  const s = trigger({ mode: "updated_since", param: "since", field: "updated", format: "epoch_s" });
  const b = ok(advance(s, freshState(), { data: [{ id: 1, updated: 1_760_000_000 }] }, 0));
  assert.equal(cursorQuery(s, b.state)["since"], 1_760_000_000);
});

test("next_token follows the token in the reply and keeps the old one when the reply has none", () => {
  const t = trigger({ mode: "next_token", param: "page", from: "/next" });
  const a = ok(advance(t, freshState(), { data: [{ id: 1 }], next: "p2" }, 0));
  assert.equal(a.state.cursor, "p2");
  const b = ok(advance(t, a.state, { data: [{ id: 1 }] }, 1));
  assert.equal(b.state.cursor, "p2");
});

test("a reply with no list is an error, an item with no id is skipped", () => {
  const t = trigger({ mode: "none" });
  assert.deepEqual(advance(t, freshState(), { nothing: true }, 0), { error: "The reply has no list at the items pointer." });
  const a = ok(advance(t, freshState(), { data: [{ name: "no id" }, { id: 1 }] }, 0));
  assert.deepEqual(a.state.seen, ["1"]);
});

test("at most 100 items fire in one pass and the rest wait for the next", () => {
  const t = trigger({ mode: "none" });
  const primed = ok(advance(t, freshState(), reply(), 0)).state;
  const ids = Array.from({ length: 130 }, (_, i) => 1000 - i);
  const a = ok(advance(t, primed, reply(...ids), 5));
  assert.equal(a.fresh.length, 100);
  assert.equal(a.more, true);
  const b = ok(advance(t, a.state, reply(...ids), 6));
  assert.equal(b.fresh.length, 30);
});

test("the seen list is bounded", () => {
  const t = trigger({ mode: "none" });
  const many = Array.from({ length: SEEN_LIMIT + 200 }, (_, i) => i + 1);
  const a = ok(advance(t, freshState(), reply(...many), 0));
  assert.equal(a.state.seen.length, SEEN_LIMIT);
});

test("a failure waits twice as long each time, up to an hour, and Retry-After wins when it is longer", () => {
  const t = { intervalSec: 120 };
  assert.equal(backoff(t, 1), 240_000);
  assert.equal(backoff(t, 2), 480_000);
  assert.equal(backoff(t, 9), 3_600_000);
  assert.equal(backoff(t, 1, 900_000), 900_000);
  assert.equal(backoff(t, 1, 10_000), 120_000);
  assert.equal(backoff({ intervalSec: 60 }, 0), 60_000);
});

test("Retry-After reads seconds or a date", () => {
  assert.equal(retryAfterMs("30", 0), 30_000);
  assert.equal(retryAfterMs(new Date(5_000).toUTCString(), 1_000), 4_000);
  assert.equal(retryAfterMs("soon", 0), undefined);
  assert.equal(retryAfterMs(undefined, 0), undefined);
});
