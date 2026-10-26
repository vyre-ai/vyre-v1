// The speed half of files-memory.test.tsx (split out so that only this file is a perf file, ruling 46): the data a 5,000 note graph is drawn from is ready inside the budget before
// sigma draws a frame. The correctness of the same 5,000 notes stays in files-memory.test.tsx and runs on every PR; a clock on a shared shard failed it at random.
import test from "node:test";
import assert from "node:assert/strict";
import { GRAPH_LAYERS, KINDS, clustersOf, degrees, layout, matches, shown } from "../memory/model.ts";
import type { GNode, GraphOut } from "../memory/model.ts";

/** The budget of the graph's data step, in ms (the median of five runs after a warm-up; the worst run may not pass twice this). */
export const GRAPH_5K_BUDGET_MS = 250;

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

test("graph5k: five thousand notes are filtered, laid out, counted and clustered inside the speed budget before sigma draws a frame", () => {
  const nodes: GNode[] = [];
  for (let i = 0; i < 5000; i++) nodes.push({ nodeId: `n${i}`, kind: KINDS[i % KINDS.length]!, title: `Note ${i}`, layer: GRAPH_LAYERS[i % 3]!, cluster: `c${i % 12}` });
  const edges = Array.from({ length: 8000 }, (_, i) => ({ from: `n${i % 5000}`, to: `n${(i * 7 + 13) % 5000}`, kind: "link" as const }));
  const g: GraphOut = { nodes, edges, clusters: [] };
  const runs: number[] = [];
  for (let r = 0; r < 6; r++) {
    const t0 = performance.now();
    const s = shown(g, { layers: new Set(["agent", "space"]), kinds: new Set(), q: "" });
    layout(s.nodes, s.edges);
    degrees(s.edges);
    clustersOf(s.nodes, s.edges);
    matches(s.nodes, "Note 49");
    runs.push(performance.now() - t0);
  }
  const timed = runs.slice(1); // the first run is the warm-up
  const med = median(timed), worst = Math.max(...timed);
  const line = `METRIC ${JSON.stringify({ name: "graph5k", nodes: 5000, edges: 8000, median_ms: +med.toFixed(1), worst_ms: +worst.toFixed(1), budget_ms: GRAPH_5K_BUDGET_MS, ok: med < GRAPH_5K_BUDGET_MS })}`;
  console.log(line);
  assert.ok(med < GRAPH_5K_BUDGET_MS, `the data a 5,000 note graph is drawn from took a median of ${med.toFixed(1)} ms over ${timed.length} runs (budget ${GRAPH_5K_BUDGET_MS} ms)`);
  assert.ok(worst < GRAPH_5K_BUDGET_MS * 2, `the worst run took ${worst.toFixed(1)} ms (limit ${GRAPH_5K_BUDGET_MS * 2} ms)`);
});
