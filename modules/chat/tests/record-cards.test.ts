// A record card shows each reader only what that reader may see, and a posted card never holds more than its poster could see. A record the call did not look up is a record the reader cannot read:
// no fields, no summary, no status, no title of the card's own (the title can be the value of a hidden field).
import test from "node:test";
import assert from "node:assert/strict";
import { attachCards, sealCards } from "../handlers/record-cards.ts";
import type { ChatCtx } from "../projections.ts";

const EMAIL = "hidden@probe-mail.test";
const card = (n: number, extra: Record<string, unknown> = {}) => ({
  type: "record_card",
  v: 1,
  data: {
    recordId: `rec_${n}`,
    type: "contact",
    title: `Person ${n}`,
    summary: `mail ${EMAIL}`,
    status: "active",
    fields: [
      { key: "name", title: "Name", value: `Person ${n}` },
      { key: "email", title: "Email", value: EMAIL },
    ],
    ...extra,
  },
});
/** A reader who gets every field of every record except `hidden` ones, and nothing of `unreadable` ones. */
const reader = (o: { hide?: string[]; unreadable?: Set<string> } = {}): ChatCtx =>
  ({
    async call(cap: string, input: { recordId: string }) {
      assert.equal(cap, "records.get");
      if (o.unreadable?.has(input.recordId)) throw new Error("no access");
      const fields: Record<string, unknown> = { name: `Person ${input.recordId.slice(4)}`, email: EMAIL };
      for (const k of o.hide ?? []) delete fields[k];
      return { record: { id: input.recordId, fields } };
    },
  }) as unknown as ChatCtx;
const dataOf = (m: { blocks?: unknown }, at = 0): Record<string, unknown> =>
  ((m.blocks as Array<{ data: Record<string, unknown> }>)[at] as { data: Record<string, unknown> }).data;
const text = (v: unknown): string => JSON.stringify(v);

test("a reader who gets every field sees the card as it was posted", async () => {
  const [m] = await attachCards(reader(), [{ blocks: [card(1)] }]);
  assert.equal(dataOf(m!)["summary"], `mail ${EMAIL}`);
  assert.ok(text(m).includes(EMAIL));
  assert.equal(dataOf(m!)["title"], "Person 1");
});

test("a reader who may not see the email gets the card without it, and without the free text that may repeat it", async () => {
  const [m] = await attachCards(reader({ hide: ["email"] }), [{ blocks: [card(1)] }]);
  assert.ok(!text(m).includes(EMAIL), text(m));
  assert.equal(dataOf(m!)["summary"], undefined);
  assert.equal(dataOf(m!)["status"], undefined);
  assert.deepEqual(
    (dataOf(m!)["fields"] as Array<{ key: string }>).map((f) => f.key),
    ["name"],
  );
});

test("the card's title goes when something was taken away: it can be the hidden value itself", async () => {
  const [m] = await attachCards(reader({ hide: ["email"] }), [{ blocks: [card(1, { title: EMAIL })] }]);
  assert.ok(!text(m).includes(EMAIL), text(m));
  assert.equal(dataOf(m!)["title"], "contact rec_1");
});

test("a record the reader cannot read shows no fields and no words of its own", async () => {
  const [m] = await attachCards(reader({ unreadable: new Set(["rec_1"]) }), [{ blocks: [card(1, { title: EMAIL })] }]);
  assert.ok(!text(m).includes(EMAIL), text(m));
  assert.deepEqual(dataOf(m!)["fields"], []);
});

test("51 distinct cards in one page: the 51st, whose email this reader cannot see, is cut like the first", async () => {
  const messages = Array.from({ length: 51 }, (_, i) => ({ blocks: [card(i + 1)] }));
  const ctx: ChatCtx = {
    async call(_cap: string, input: { recordId: string }) {
      const fields: Record<string, unknown> = { name: input.recordId };
      if (input.recordId !== "rec_51") fields["email"] = EMAIL;
      return { record: { id: input.recordId, fields } };
    },
  } as unknown as ChatCtx;
  const out = await attachCards(ctx, messages);
  assert.ok(!text(out[50]).includes(EMAIL), text(out[50]));
  assert.ok(text(out[0]).includes(EMAIL), "a record whose email this reader may see keeps it");
});

test("more records than one call looks up, and a call that cannot ask at all, never serve a card whole", async () => {
  const many = Array.from({ length: 230 }, (_, i) => ({ blocks: [card(i + 1)] }));
  const out = await attachCards(reader(), many);
  assert.ok(!text(out[229]).includes(EMAIL), "beyond the cap the card is cut");
  assert.ok(text(out[0]).includes(EMAIL), "within the cap it is read");
  const blind = await attachCards({} as unknown as ChatCtx, [{ blocks: [card(1)] }]);
  assert.ok(!text(blind).includes(EMAIL), text(blind));
});

test("a card a person posts is stored with only the fields they could see, whatever values they typed", async () => {
  const [b] = await sealCards(reader({ hide: ["email"] }), [card(1) as { type: string; data: unknown }]);
  assert.ok(!text(b).includes(EMAIL), text(b));
  const [whole] = await sealCards(reader(), [card(1) as { type: string; data: unknown }]);
  assert.ok(text(whole).includes(EMAIL), "a poster who may see the email keeps it on their card");
});

test("a message with no record card goes through untouched, with no read", async () => {
  const ctx = {
    async call() {
      throw new Error("must not be asked");
    },
  } as unknown as ChatCtx;
  const m = { blocks: [{ type: "link_card", data: { x: 1 } }] };
  assert.deepEqual(await attachCards(ctx, [m]), [m]);
});
