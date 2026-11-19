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
  assert.ok(d.tail.every((l) => l.length <= 300));
});
