// The Logs tab and Overview numbers as functions (r42-sites-run, slice 4).
import test from "node:test";
import assert from "node:assert/strict";
import {
  RUN_WORD,
  jobProblem,
  presetOf,
  runMark,
  serviceMark,
  serviceNote,
  sizeText,
  took,
  KEEP,
  NO_FILTER,
  asText,
  cards,
  clock,
  countWord,
  cpuOf,
  following,
  memText,
  merge,
  msText,
  parseRequest,
  paths,
  readInput,
  rows,
  summary,
} from "./ops-model.ts";
import type { LogLine, Metrics, Sample } from "./ops-model.ts";

const line = (seq: number, text: string, o: Partial<LogLine> = {}): LogLine => ({
  seq,
  at: Date.parse("2026-11-19T10:41:27Z"),
  source: "app",
  scope: "dpl_1",
  text,
  level: "info",
  ...o,
});

test("the clock is the Space's time with seconds", () => {
  assert.equal(clock(Date.parse("2026-11-19T10:41:27Z"), "UTC"), "10:41:27");
  assert.equal(clock(Date.parse("2026-11-19T10:41:27Z"), "Asia/Karachi"), "15:41:27");
  assert.equal(clock(Date.parse("2026-11-19T00:05:09Z"), "UTC"), "00:05:09");
});

test("a request line is its parts; any other line is not", () => {
  assert.deepEqual(parseRequest("GET /api/cart 200 12ms"), { method: "GET", path: "/api/cart", status: 200, ms: 12 });
  assert.deepEqual(parseRequest("DELETE /a/b 404 3ms"), { method: "DELETE", path: "/a/b", status: 404, ms: 3 });
  assert.equal(parseRequest("cart 4108 saved"), null);
  assert.equal(parseRequest("GET /x 200"), null);
});

test("rows: a request has a status and a time; a 500 is an error; an app error is red; a stack line joins the error above it", () => {
  const out = rows(
    [
      line(1, "GET /plans 200 29ms", { source: "requests" }),
      line(2, "POST /api/checkout 500 310ms", { source: "requests" }),
      line(3, "Error: card_declined is not handled", { level: "error" }),
      line(4, "    at charge (/app/lib/pay.js:41:9)"),
      line(5, "cart 4108 saved"),
      line(6, "deprecated call", { level: "warn" }),
      line(7, "Nightly sync: 412 checked", { source: "jobs" }),
    ],
    "UTC",
  );
  assert.deepEqual(out[0], {
    seq: 1,
    time: "10:41:27",
    tag: "req",
    text: "GET /plans",
    status: 200,
    ms: "29 ms",
    tone: "plain",
    more: false,
  });
  assert.equal(out[1]?.tone, "error");
  assert.equal(out[2]?.tone, "error");
  assert.equal(out[3]?.tone, "error");
  assert.equal(out[3]?.more, true);
  assert.equal(out[4]?.tone, "plain");
  assert.equal(out[5]?.tone, "warn");
  assert.equal(out[6]?.tag, "job");
});

test("a stack line under a plain line stays plain", () => {
  const out = rows([line(1, "hello"), line(2, "  at x (y.js:1:1)")], "UTC");
  assert.equal(out[1]?.tone, "plain");
});

test("only Live with an empty search follows; pausing, searching or choosing a window stops it", () => {
  assert.equal(following(NO_FILTER, false), true);
  assert.equal(following(NO_FILTER, true), false);
  assert.equal(following({ ...NO_FILTER, q: "x" }, false), false);
  assert.equal(following({ ...NO_FILTER, q: "  " }, false), true);
  assert.equal(following({ ...NO_FILTER, window: "1h" }, false), false);
});

test("the read input carries only what was chosen", () => {
  assert.deepEqual(readInput("sit_a", NO_FILTER, 1000), { siteId: "sit_a", limit: 500 });
  assert.deepEqual(
    readInput(
      "sit_a",
      { q: " db pool ", source: "requests", level: "error", scope: "dpl_1", window: "1h" },
      3_600_000 * 2,
      77,
    ),
    {
      siteId: "sit_a",
      limit: 500,
      q: "db pool",
      source: "requests",
      level: "error",
      scope: "dpl_1",
      from: 3_600_000,
      after: 77,
    },
  );
});

test("merge adds new lines in order, never twice, and drops the oldest past the cap", () => {
  const a = [line(1, "a"), line(2, "b")];
  assert.deepEqual(
    merge(a, [line(2, "b"), line(3, "c")]).map((l) => l.seq),
    [1, 2, 3],
  );
  assert.equal(merge(a, []), a);
  assert.equal(merge(a, [line(1, "a")]), a);
  const many = Array.from({ length: KEEP }, (_, i) => line(i + 1, "x"));
  const out = merge(many, [line(KEEP + 1, "y"), line(KEEP + 2, "z")]);
  assert.equal(out.length, KEEP);
  assert.equal(out[0]?.seq, 3);
  assert.equal(out.at(-1)?.seq, KEEP + 2);
});

test("copy gives one line each with its time", () => {
  assert.equal(asText([line(1, "a"), line(2, "b")], "UTC"), "10:41:27 a\n10:41:27 b");
  assert.equal(countWord(1), "1 line");
  assert.equal(countWord(1234), "1,234 lines");
});

test("words for sizes and times", () => {
  assert.equal(memText(202.4), "202 MB");
  assert.equal(memText(1536), "1.5 GB");
  assert.equal(memText(1024), "1 GB");
  assert.equal(msText(48.2), "48 ms");
  assert.equal(msText(1500), "1.5 s");
  assert.equal(cpuOf(0.5), "half a CPU");
  assert.equal(cpuOf(1), "1 CPU");
  assert.equal(cpuOf(2), "2 CPUs");
});

const sample = (o: Partial<Sample> = {}): Sample => ({
  at: 0,
  cpu: 4,
  memMb: 202,
  requests: 101,
  errors: 0,
  p50: 20,
  p95: 48,
  ...o,
});
const metrics = (o: Partial<Metrics> = {}): Metrics => ({
  window: "1h",
  samples: [sample(), sample({ cpu: 8 }), null],
  now: { cpu: { value: 4, of: 100 }, mem: { valueMb: 202, ofMb: 512 }, requestsPerMin: 101, p95: 48, errorRate: 0 },
  measured: true,
  requests: true,
  ...o,
});

test("the four cards say what the design says", () => {
  const c = cards(metrics());
  assert.deepEqual(
    c.map((x) => [x.title, x.value, x.sub]),
    [
      ["CPU", "4%", "of 1 CPU"],
      ["Memory", "202 MB", "of 512 MB"],
      ["Requests", "101", "a minute"],
      ["Response", "48 ms", "95 in 100 are faster"],
    ],
  );
  assert.deepEqual(c[0]?.series, [4, 8, null]);
});

test("CPU is a percent of what the site may use", () => {
  const c = cards(metrics({ now: { ...metrics().now, cpu: { value: 100, of: 200 } } }));
  assert.deepEqual([c[0]?.value, c[0]?.sub], ["50%", "of 2 CPUs"]);
});

test("a site not measured says Measuring, and one with no request report says None yet, never a flat zero", () => {
  const none = cards(null);
  assert.deepEqual(
    none.map((x) => x.value),
    ["Measuring", "Measuring", "Measuring", "Measuring"],
  );
  const quiet = cards(metrics({ requests: false }));
  assert.deepEqual([quiet[2]?.value, quiet[3]?.value], ["None yet", "None yet"]);
  assert.equal(quiet[0]?.value, "4%");
});

test("summary is the lowest, average and highest, ignoring gaps", () => {
  assert.deepEqual(summary([29, null, 37, 48, null]), { low: 29, avg: (29 + 37 + 48) / 3, high: 48 });
  assert.equal(summary([null, null]), null);
});

test("a chart path rises with the value, and a gap breaks the line", () => {
  const p = paths([0, 10, 10], 100, 20);
  assert.equal(p.line, "M0 18L50 2L100 2");
  assert.equal(p.area, "M0 20L0 18L50 2L100 2L100 20Z");
  const gap = paths([5, null, 5, 5], 90, 20);
  assert.equal((gap.line.match(/M/g) ?? []).length, 2);
  assert.deepEqual(paths([], 100, 20), { line: "", area: "" });
  assert.deepEqual(paths([1], 100, 20), { line: "", area: "" });
  assert.deepEqual(paths([null, null], 100, 20), { line: "", area: "" });
});

test("a run's words and marks", () => {
  assert.equal(RUN_WORD.succeeded, "Finished");
  assert.equal(RUN_WORD.interrupted, "Cut short");
  assert.deepEqual(
    (["succeeded", "failed", "timed_out", "interrupted", "running", "queued", "skipped", "canceled"] as const).map(
      runMark,
    ),
    ["ok", "failed", "failed", "failed", "running", "running", "skipped", "skipped"],
  );
  assert.deepEqual((["running", "failed", "stopped", "starting", "backoff"] as const).map(serviceMark), [
    "ok",
    "failed",
    "skipped",
    "running",
    "running",
  ]);
});

test("how long a run took", () => {
  const r = (s: number, e: number) => ({ startedAt: s * 1000, endedAt: e * 1000 });
  assert.equal(took(r(0, 38)), "38 s");
  assert.equal(took(r(0, 60)), "1 min");
  assert.equal(took(r(0, 242)), "4 min 2 s");
  assert.equal(took(r(0, 3900)), "1 h 5 min");
  assert.equal(took(r(0, 7200)), "2 h");
  assert.equal(took({ startedAt: 5 }), "");
  assert.equal(took({}), "");
});

test("schedule presets: a preset is found by its schedule, anything else is Custom", () => {
  assert.equal(presetOf("0 2 * * *"), "0 2 * * *");
  assert.equal(presetOf("@hourly"), "@hourly");
  assert.equal(presetOf("5 4 * * *"), "custom");
  assert.equal(presetOf("custom"), "custom");
});

test("a worker row says its note, or its state", () => {
  const v = { serviceId: "w", siteId: "s", name: "q", kind: "worker", command: "x", state: "running" as const };
  assert.equal(serviceNote(v), "Running");
  assert.equal(
    serviceNote({
      ...v,
      state: "backoff",
      note: "It stopped with an error (exit code 1). Starting again in 4 seconds.",
    }),
    "It stopped with an error (exit code 1). Starting again in 4 seconds.",
  );
  assert.equal(serviceNote({ ...v, state: "failed" }), "Stopped after crashing");
});

test("sizes", () => {
  assert.equal(sizeText(100), "1 KB");
  assert.equal(sizeText(300 * 1024), "300 KB");
  assert.equal(sizeText(48 * 1024 * 1024), "48 MB");
  assert.equal(sizeText(1.5 * 1024 * 1024 * 1024), "1.5 GB");
});

test("the job form's check is one plain sentence", () => {
  assert.equal(jobProblem({ name: " ", schedule: "@daily", command: "x" }), "Give the job a name.");
  assert.equal(jobProblem({ name: "a", schedule: "", command: "x" }), "Say when it runs.");
  assert.equal(jobProblem({ name: "a", schedule: "@daily", command: " " }), "Give the command to run.");
  assert.equal(jobProblem({ name: "a", schedule: "@daily", command: "x" }), null);
});
