// What needs you says how long it has been so, in words a person says (owner walk, 12 Nov 2026: a fresh Space read "Your team has no AI account since now").
import test from "node:test";
import assert from "node:assert/strict";
import { forHowLong } from "../shell/format.ts";

const NOW = Date.UTC(2026, 10, 12, 12, 0, 0);

test("just started says nothing more; then for minutes, hours, days; then since the date", () => {
  assert.equal(`Your team has no AI account${forHowLong(NOW, NOW - 5_000)}`, "Your team has no AI account");
  assert.equal(forHowLong(NOW, NOW - 5 * 60_000), " for 5 min");
  assert.equal(forHowLong(NOW, NOW - 3 * 3_600_000), " for 3 h");
  assert.equal(forHowLong(NOW, NOW - 2 * 86_400_000), " for 2 d");
  assert.equal(forHowLong(NOW, Date.UTC(2026, 9, 1)), " since 1 Oct 2026");
  assert.ok(!/since now|ago/.test(forHowLong(NOW, NOW)), "never 'since now' or 'since 3 h ago'");
});

test("an empty list with nothing typed says it is empty yet; with a search or filter it says nothing matches", async () => {
  const { emptyWords } = await import("../objects/ObjectList.tsx");
  assert.equal(emptyWords("No webhooks match.", false), "No webhooks yet.");
  assert.equal(emptyWords("No outside sessions match.", false), "No outside sessions yet.");
  assert.equal(emptyWords("No webhooks match.", true), "No webhooks match.");
  assert.equal(emptyWords("Nothing set up", false), "Nothing set up", "other words stay as they are");
});

test("a Needs you row never says its title twice; an older one says for how long", async () => {
  const { attentionNote, ATTENTION_SENTENCE } = await import("../pages/overview/Overview.tsx");
  const kind = "no_ai_account" as never;
  const title = ATTENTION_SENTENCE[kind] as unknown as string;
  assert.ok(title, "the sentence exists");
  {
    assert.equal(
      attentionNote({ kind, title, since: NOW - 5_000, next: "Set up" }, NOW),
      null,
      "just started: no second line",
    );
    assert.equal(attentionNote({ kind, title, since: NOW - 3 * 3_600_000, next: "Set up" }, NOW), `${title} for 3 h`);
  }
});
