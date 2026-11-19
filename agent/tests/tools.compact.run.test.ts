// What a model reads of a long command's output (r42-runtime-tokens): a short output whole, a long one as its last 40 lines plus the lines that look like a failure, with a count of what was left out.
import test from "node:test";
import assert from "node:assert/strict";
import { RUN_MATCHES, RUN_TAIL, RUN_WHOLE, shapeOutput } from "../src/tools/compact.ts";
import { estimateTokens } from "../../lib/reply-format.ts";

const log = (n: number, failAt: number[] = []): string =>
  Array.from({ length: n }, (_, i) =>
    failAt.includes(i)
      ? `step ${i}: ERROR could not resolve module "pkg-${i}" at /build/src/a/very/long/path/${"x".repeat(20)}`
      : `step ${i}: compiled module ${i} of ${n} in ${(i * 7) % 90} ms ${".".repeat(30)}`,
  ).join("\n");

test("a short output reaches the model as it is", () => {
  assert.equal(
    shapeOutput("terminal.run", { terminalId: "trm_1", exitCode: 0, output: "ok\n", truncated: false, durationMs: 90 }),
    null,
  );
  const edge = "a".repeat(RUN_WHOLE);
  assert.equal(
    shapeOutput("terminal.run", { terminalId: "trm_1", exitCode: 0, output: edge, truncated: false, durationMs: 1 }),
    null,
  );
});

test("a 200 KB output becomes its tail, the failure lines before it and the counts, in about a thousand tokens", () => {
  const output = log(2_600, [310, 1_900, 2_599]);
  assert.ok(output.length > 200_000 * 0.9, `fixture is ${output.length} bytes`);
  const whole = estimateTokens(output);
  const s = shapeOutput("terminal.run", {
    terminalId: "trm_1",
    exitCode: 1,
    output,
    truncated: false,
    durationMs: 412_000,
  })!;
  const d = s.data as {
    exitCode: number;
    lines: number;
    omitted: number;
    tail: string[];
    matches: Array<{ line: number; text: string }>;
    startCut?: boolean;
  };
  assert.equal(d.exitCode, 1);
  assert.equal(d.lines, 2_600);
  assert.equal(d.tail.length, RUN_TAIL);
  assert.match(d.tail.at(-1)!, /^step 2599: ERROR/);
  assert.equal(d.omitted, 2_600 - RUN_TAIL);
  assert.deepEqual(
    d.matches.map((m) => m.line),
    [311, 1_901],
    "the failure lines inside the tail are in the tail; the ones before it are named with their line numbers",
  );
  assert.equal(s.meta.read, "terminal_read");
  const shaped = estimateTokens(JSON.stringify(s.data));
  assert.ok(shaped < 1_500, `shaped is ${shaped} tokens (whole ${whole})`);
  assert.ok(whole / shaped > 30, `whole ${whole} tokens, shaped ${shaped}`);
});

test("a log of one failure repeated is named at most 20 times, a cut start is said, and a very long line is cut", () => {
  const output = Array.from({ length: 400 }, (_, i) => `line ${i}: FAILED ${"y".repeat(500)}`).join("\n");
  const s = shapeOutput("terminal.run", { terminalId: "trm_1", exitCode: 2, output, truncated: true, durationMs: 1 })!;
  const d = s.data as { matches: unknown[]; tail: string[]; startCut?: boolean };
  assert.equal(d.matches.length, RUN_MATCHES);
  assert.equal(d.startCut, true);
  for (const l of d.tail) {
    const cut = /^(.{299})…\[\+(\d+) more characters on this line\]$/.exec(l);
    assert.ok(
      cut ? Number(cut[2]) === 500 + "line 399: FAILED ".length - 300 + 1 || Number(cut[2]) > 0 : l.length <= 300,
      l.slice(0, 40),
    );
  }
});

type Shape = {
  lines: number;
  omitted: number;
  cutChars?: number;
  noExitCode?: string;
  matchesNotShown?: number;
  matches: Array<{ line: number; fromEnd: number; text: string }>;
  tail: string[];
  read: { tool: string; lines: number; covers: string };
};
const shape = (output: string, extra: Record<string, unknown> = {}): Shape =>
  shapeOutput("terminal.run", { terminalId: "trm_1", exitCode: 1, output, truncated: false, durationMs: 5, ...extra })!
    .data as Shape;

test("a long line is cut with the cut counted and marked, never silently", () => {
  const d = shape(`${"z".repeat(50_000)}\nnext`);
  assert.equal(d.cutChars, 50_000 - 300);
  assert.match(d.tail[0]!, /\[\+\d+ more characters on this line\]$/);
  assert.equal(d.omitted, 0);
});

test("the failure words real tools print are found, clean counts are not, and a real failure after many benign hits is kept", () => {
  const lines = Array.from({ length: 3_000 }, (_, i) => `ok ${i} ${"x".repeat(40)}`);
  const real: Array<[number, string]> = [
    [100, "FAIL src/pay.test.ts"],
    [200, "npm ERR! code ELIFECYCLE"],
    [300, "TypeError: x is not a function"],
    [400, "ModuleNotFoundError: No module named 'foo'"],
    [500, "bash: foo: command not found"],
    [600, "Segmentation fault (core dumped)"],
    [700, "E   assert 3 == 4"],
  ];
  for (const [i, t] of real) lines[i] = t;
  for (let i = 800; i < 825; i++) lines[i] = `compiled with 0 errors, failed: 0 (${i})`;
  const d = shape(lines.join("\n"));
  assert.deepEqual(
    d.matches.map((m) => m.line),
    real.map(([i]) => i + 1),
    "every real failure, no clean count",
  );
  const many = Array.from({ length: 3_000 }, (_, i) => `ok ${i} ${"x".repeat(40)}`);
  for (let i = 100; i < 140; i++) many[i] = `warn: retrying after error ${i}`;
  many[2_000] = "FATAL: the disk is full";
  const m = shape(many.join("\n"));
  assert.equal(m.matches.length, 20);
  assert.equal(m.matchesNotShown, 41 - 20);
  assert.ok(
    m.matches.some((x) => x.line === 2_001),
    "the real failure is among the last 15, not crowded out by the first hits",
  );
});

test("the answer says which terminal_read call reaches the matches, and when none does", () => {
  const lines = Array.from({ length: 3_000 }, (_, i) => `ok ${i} ${"x".repeat(40)}`);
  lines[2_000] = "Error: boom";
  const d = shape(lines.join("\n"));
  assert.equal(d.matches[0]!.fromEnd, 1_000);
  assert.equal(d.read.tool, "terminal_read");
  assert.equal(d.read.lines, 1_110, "the distance plus a tenth and ten lines, for wrapped rows and later output");
  lines[10] = "Error: very early";
  const far = shape(
    Array.from({ length: 9_000 }, (_, i) => (i === 10 ? "Error: very early" : `ok ${i} ${"x".repeat(40)}`)).join("\n"),
  );
  assert.equal(far.read.lines, 5_000);
  assert.match(far.read.covers, /out of its reach/);
  assert.match(shape("x".repeat(7_000), { exitCode: null }).noExitCode ?? "", /exit code/);
});

test("a line with a real count of failures is kept even when it also says 0 errors", () => {
  const lines = Array.from({ length: 3_000 }, (_, i) => `ok ${i} ${"x".repeat(40)}`);
  lines[500] = "Tests run: 10, Failures: 2, Errors: 0, Skipped: 0";
  lines[600] = "1 failed, 0 errors";
  lines[700] = "failed=2, errors=0";
  lines[800] = "Tests run: 10, Failures: 0, Errors: 0, Skipped: 0";
  lines[900] = "compiled with 0 errors";
  lines[1000] = "error: 0 files matched the pattern";
  lines[1100] = "Errors: 0x1f";
  assert.deepEqual(
    shape(lines.join("\n")).matches.map((m) => m.line),
    [501, 601, 701, 1001, 1101],
  );
});

test("a cut start is said, so line numbers are not claimed to count from the command's first line", () => {
  const lines = Array.from({ length: 3_000 }, (_, i) => `ok ${i} ${"x".repeat(40)}`).join("\n");
  const note = (t: boolean) =>
    (
      shapeOutput("terminal.run", { terminalId: "t", exitCode: 0, output: lines, truncated: t, durationMs: 1 })!
        .data as { note: string }
    ).note;
  assert.match(note(true), /start of the command's output was already lost/);
  assert.match(note(false), /count from the first line of this command's output/);
});
