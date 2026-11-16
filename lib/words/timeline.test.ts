// The Activity timeline in words: every kind a goal can write has a place, repeats fold, a code or an id never shows, long text is cut at a word, and nothing is lost to the cut.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { rawIdsIn } from "../id-shapes.ts";
import { GOAL_KINDS, actionTimeline, cutAtWord, goalTimeline, plain } from "./timeline.ts";
import type { ActivityEvent, Viewer } from "./activity.ts";

const v: Viewer = { me: "usr_a", nameOf: (id) => (id === "agt_dex" ? "Dex" : "Maya Chen"), offsetMin: 0, zone: "UTC" };
const T = Date.UTC(2026, 10, 4, 9);
const D = 86_400_000;
const row = (at: number, kind: string, text: string, by?: string, ref?: string): ActivityEvent => ({
  at,
  kind,
  text,
  ...(by ? { by } : {}),
  ...(ref ? { ref } : {}),
});

test("every kind the goal handlers write has a place in the timeline", () => {
  const dir = new URL("../../modules/goals/handlers/", import.meta.url);
  const kinds = new Set<string>();
  for (const f of [
    ...readdirSync(dir).map((n) => new URL(n, dir)),
    new URL("../../modules/goals/projections.ts", import.meta.url),
  ]) {
    const flat = readFileSync(f, "utf8").replace(/\s+/g, " ");
    for (const m of flat.matchAll(/\bnote\( ?[\w.]+, ?[\w.[\]]+, ?"([a-z_]+)"/g)) kinds.add(m[1]!);
  }
  assert.ok(kinds.size >= 15, `the scan found ${kinds.size} kinds`);
  for (const k of kinds) assert.ok(GOAL_KINDS[k], `kind ${k} has no place in GOAL_KINDS`);
});

test("check-ins that moved nothing fold into one line with the days they cover", () => {
  const rows = [7, 6, 5, 4, 3, 2, 1].map((n) =>
    row(T + n * D, "checkin", `Check-in: 0 of 7. No progress for ${n} check-in${n === 1 ? "" : "s"}.`, "agt_dex"),
  );
  const out = goalTimeline(rows, v);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.title, "No progress for 7 check-ins");
  assert.equal(out[0]!.tier, "beat");
  assert.deepEqual(out[0]!.span, { from: T + D, to: T + 7 * D });
});

test("the same line again and again is one line with a count; wakes and unchanged readings are not lines", () => {
  const rows = [
    row(T + 5, "wake", "Dex was woken because it is time for a check-in."),
    row(T + 4, "reading", "Luma registrations: 212 (+0 since the last read)"),
    row(T + 3, "folder", "Made the goal's folder in Files."),
    row(T + 2, "error", "Could not read Luma registrations. The next check-in tries again."),
    row(T + 1, "error", "Could not read Luma registrations. The next check-in tries again."),
    row(T, "status", "Moved from Active to Stuck."),
  ];
  const out = goalTimeline(rows, v);
  assert.deepEqual(
    out.map((e) => [e.tier, e.count]),
    [
      ["quiet", 1],
      ["problem", 2],
    ],
  );
  assert.match(out[1]!.title, /2 times/);
});

test("a failure shows its words, never its code, and a moved reading is a line", () => {
  const out = goalTimeline(
    [
      row(T + 2, "wake", "Dex could not check in (provider.rate_limited)."),
      row(T + 1, "wake", "Dex could not check in: host_lost"),
      row(T, "reading", "Luma registrations: 230, up 18 since the last check-in"),
    ],
    v,
  );
  assert.equal(out.length, 3);
  for (const e of out) assert.doesNotMatch(e.text, /provider\.|host_lost|_/);
  assert.match(out[0]!.text, /usage limit|limit/);
  assert.equal(out[2]!.tier, "action");
});

test("long text is cut at a word, with the whole of it kept for more; a short line has no more", () => {
  const long =
    "Dex checked in and found that nothing about the venue, the speakers or the guest list has moved since the last time anyone looked at it, so it asked again";
  const { head, rest } = cutAtWord(long);
  assert.ok(head.length <= 92 && head.endsWith("…"));
  assert.equal(rest, long);
  const [e] = goalTimeline([row(T, "report", long, "agt_dex")], v);
  assert.equal(e!.detail, long);
  assert.equal(cutAtWord("Dex made the plan.").rest, undefined);
  assert.deepEqual(
    cutAtWord("It ended early. The retrospective says why and what is left to do, in more words than a line holds."),
    {
      head: "It ended early.",
      rest: "The retrospective says why and what is left to do, in more words than a line holds.",
    },
  );
});

test("no sentence carries an id, in any kind", () => {
  const ids = [
    "tsk_0123456789abcdef0123456789abcdef",
    "usr_ec028017ceefaf270b",
    "agt_0123456789abcdef0123456789abcdef",
  ];
  const rows = Object.keys(GOAL_KINDS).flatMap((k, i) =>
    ids.map((id, j) => row(T + i * 10 + j, k, `Could not do ${k} for ${id} because provider.rate_limited, see ${id}.`)),
  );
  for (const e of goalTimeline(rows, v)) {
    assert.deepEqual(rawIdsIn(`${e.title} ${e.detail ?? ""} ${e.text}`), [], e.text);
    assert.doesNotMatch(`${e.title} ${e.detail ?? ""}`, /provider\.rate_limited/);
  }
  assert.equal(plain("It failed (host_lost)."), "It failed: the server stopped while this was running.");
});

test("a task's or a record's lines fold repeats and keep who did them", () => {
  const out = actionTimeline([
    { id: "a", at: T + 3, by: "usr_a", text: "Maya Chen moved this to Doing" },
    { id: "b", at: T + 2, by: "usr_a", text: "Maya Chen moved this to Doing" },
    { id: "c", at: T + 1, by: "usr_b", text: "Sam Okoye set budget to 5", detail: "Budget: 3 to 5" },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.count, 2);
  assert.equal(out[1]!.by, "usr_b");
  assert.equal(out[1]!.detail, "Budget: 3 to 5");
});
