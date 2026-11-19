// What the agent that started a helper reads of its answer (lib/helper-result.ts): short answers whole, long ones as a summary plus the helper's fields plus a reference to the rest, and never a character lost.
import test from "node:test";
import assert from "node:assert/strict";
import { RESULT_WHOLE, SUMMARY_MAX, parentBody, splitResult } from "../../../lib/helper-result.ts";

const para = (n: number, tag: string): string => `${tag} ${"word ".repeat(n)}`.trim();
const ref = { threadId: "thr_h1", messageId: "msg_9" };

test("a short answer reaches the parent whole, with no reference line", () => {
  const body = parentBody("Read the lease", "Renewal is 1 March 2027; rent 4,200 a month.", ref);
  assert.match(body, /^Helper "Read the lease" found:\n\nRenewal is 1 March 2027; rent 4,200 a month\.$/);
  assert.doesNotMatch(body, /chat_message_get/);
});

test("a long answer with the helper's own --- line gives the summary, the fields and the reference; nothing it wrote is lost", () => {
  const detail = Array.from({ length: 60 }, (_, i) => para(40, `Item ${i}:`)).join("\n\n");
  const text = `Three leases renew in 2027: A on 1 March, B on 1 June, C on 1 Sept. Total rent 12,600 a month.\n\n\`\`\`json result\n{"renewals":3,"rent":12600}\n\`\`\`\n\n---\n${detail}`;
  const s = splitResult(text);
  assert.match(s.summary, /^Three leases renew/);
  assert.equal(s.fields, '{"renewals":3,"rent":12600}');
  assert.equal(s.detail, detail);
  const body = parentBody("Leases", text, ref);
  assert.match(body, /Fields:\n\{"renewals":3,"rent":12600\}/);
  assert.match(body, /chat_message_get \{threadId "thr_h1", messageId "msg_9"\}/);
  assert.ok(body.length < 800, `the parent's copy is ${body.length} characters`);
});

test("a long answer with no marker is split at a paragraph, and the rest is always behind the reference", () => {
  const paras = Array.from({ length: 30 }, (_, i) => para(60, `Para ${i}:`));
  const text = paras.join("\n\n");
  const s = splitResult(text);
  assert.ok(s.summary.length <= SUMMARY_MAX);
  assert.ok(text.length > RESULT_WHOLE);
  assert.equal(`${s.summary}\n\n${s.detail}`, text, "summary plus detail is the whole answer");
  assert.match(parentBody("Notes", text, ref), /not shown here\): read it with chat_message_get/);
  // one enormous paragraph: cut at the limit, still all of it reachable
  const one = "x".repeat(10_000);
  const o = splitResult(one);
  assert.equal(o.summary.length + o.detail.length, 10_000);
});

test("nothing the helper reported is lost, for any shape of answer", () => {
  const shapes = [
    "",
    "ok",
    "a\n".repeat(2_000),
    `${"y".repeat(1_400)}\n---\n${"z".repeat(5_000)}`,
    `${"y".repeat(2_000)}\n---\n${"z".repeat(5_000)}`,
    `\`\`\`json result\n${"k".repeat(3_000)}\n\`\`\`\nshort`,
  ];
  for (const t of shapes) {
    const s = splitResult(t);
    const joined = `${s.summary}${s.detail}`.replace(/\s+/g, "");
    const want = (s.fields === undefined ? t : t.replace(/```json[ \t]+result[ \t]*\n[\s\S]*?\n```/, ""))
      .replace(/\s+/g, "")
      .replace(/-{3}/g, "");
    assert.equal(joined.replace(/-{3}/g, ""), want, `shape of ${t.length} chars`);
    if (s.detail !== "") assert.match(parentBody("T", t, ref), /chat_message_get/);
  }
});
