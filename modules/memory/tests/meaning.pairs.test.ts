// The model and its threshold, chosen on 30 pairs (fixtures/meaning-pairs.ts): the recorded cosines of four small models, the one shipped and the threshold it is held to.
// Scores were recorded from the quantized ONNX models; the shipped runtime (WebAssembly) agrees with them to about 0.015 and the margin below is wider than that.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { LOCAL_MIN_SCORE } from "../local-embedder.ts";
import { calibrated } from "../meaning.ts";
import { PAIRS, scoreAt } from "../fixtures/meaning-pairs.ts";

const recorded = JSON.parse(fs.readFileSync(new URL("../fixtures/meaning-pairs.scores.json", import.meta.url), "utf8")) as { scores: Record<string, number[]> };

test("the set is 15 questions with the fact that answers them and 15 with one that does not", () => {
  assert.equal(PAIRS.length, 30);
  assert.equal(PAIRS.filter((p) => p.related).length, 15);
  assert.ok(PAIRS.some((p) => p.query === "bank reconciliation" && p.text === "The Chase feed didn't match" && p.related));
  for (const s of Object.values(recorded.scores)) assert.equal(s.length, 30);
});

test("the shipped model at its threshold: every related pair clears it and no unrelated pair does", () => {
  const r = scoreAt(recorded.scores["bge_noinst"]!, LOCAL_MIN_SCORE);
  assert.deepEqual([r.precision, r.recall], [1, 1]);
  const related = recorded.scores["bge_noinst"]!.slice(0, 15);
  const unrelated = recorded.scores["bge_noinst"]!.slice(15);
  assert.ok(Math.min(...related) - Math.max(...unrelated) > 0.015, "the gap between the lowest related and the highest unrelated score");
  assert.ok(recorded.scores["bge_noinst"]![0]! >= LOCAL_MIN_SCORE, "the bank reconciliation question finds the Chase feed fact");
});

test("the model it replaced misses the pair that prompted the change, at any threshold that keeps precision", () => {
  const mini = recorded.scores["minilm"]!;
  assert.ok(mini[0]! < 0.2, "MiniLM scores the Chase pair near 0.15");
  let precise = 0;
  for (let t = 0.05; t < 0.95; t += 0.005) { const r = scoreAt(mini, t); if (r.precision === 1) { precise = r.recall; break; } }
  assert.ok(precise < 0.9, `MiniLM recall at full precision is ${precise}`);
});

test("a score is 0 below a model's threshold and 0.5 to 1 above it", () => {
  assert.equal(calibrated(0.4, 0.57), 0);
  assert.equal(calibrated(0.57, 0.57), 0.5);
  assert.equal(calibrated(1, 0.57), 1);
  assert.ok(calibrated(0.78, 0.57) > 0.7 && calibrated(0.78, 0.57) < 0.8);
});
