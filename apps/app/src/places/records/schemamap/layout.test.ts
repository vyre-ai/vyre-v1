// The schema map's starting layout: a card opened to all its fields pushes the cards under it down and never lies over them, and no card changes column.
import test from "node:test";
import assert from "node:assert/strict";
import { cardHeight, layout } from "./model.ts";
import type { MapNode } from "./model.ts";

const node = (type: string): MapNode => ({ type, title: type }) as unknown as MapNode;
const nodes = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta"].map(node);
const plain = new Map(nodes.map((n) => [n.type, cardHeight(12, false)]));

function overlaps(pos: Map<string, [number, number]>, h: Map<string, number>): string[] {
  const out: string[] = [];
  const list = [...pos.entries()];
  for (const [a, [ax, ay]] of list)
    for (const [b, [bx, by]] of list)
      if (a < b && ax === bx && ay < by + (h.get(b) as number) && by < ay + (h.get(a) as number)) out.push(`${a}/${b}`);
  return out;
}

test("with every card closed no two cards of a column overlap", () => {
  assert.deepEqual(overlaps(layout(nodes, [], plain), plain), []);
});

test("a card opened to all its fields pushes the cards under it down: nothing overlaps, and every card keeps its column", () => {
  const before = layout(nodes, [], plain);
  for (const opened of nodes) {
    const drawn = new Map(plain);
    drawn.set(opened.type, cardHeight(12, true));
    assert.ok((drawn.get(opened.type) as number) > (plain.get(opened.type) as number), "an opened card is taller");
    const after = layout(nodes, [], plain, drawn);
    assert.deepEqual(overlaps(after, drawn), [], `opened ${opened.type}`);
    for (const n of nodes)
      assert.equal(
        (after.get(n.type) as [number, number])[0],
        (before.get(n.type) as [number, number])[0],
        `${n.type} stays in its column`,
      );
    assert.deepEqual(after.get(opened.type), before.get(opened.type), "the opened card itself does not move");
  }
});
