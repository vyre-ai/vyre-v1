// ui/Tooltip: the text is the wrapper's title and the wrapper takes no layout box.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Text } from "react-native";
import { Tooltip } from "./index.tsx";

test("the wrapper carries the tooltip and takes no box", () => {
  const html = renderToStaticMarkup(<Tooltip text="Anyone in the Space can join"><Text>Public</Text></Tooltip>);
  assert.ok(html.includes('title="Anyone in the Space can join"'));
  assert.ok(html.includes("display:contents"));
  assert.ok(html.includes("Public"));
});

test("no text, no wrapper", () => {
  assert.ok(!renderToStaticMarkup(<Tooltip text=""><Text>Public</Text></Tooltip>).includes("title="));
});

test("the one tooltip sits above the thing, flips under it at the top, and stays inside the window", async () => {
  const { tipPlace } = await import("./tips.ts");
  assert.deepEqual(tipPlace({ left: 100, top: 200, bottom: 220, width: 40 }, { width: 60, height: 24 }, 1000), { left: 90, top: 169 });
  assert.equal(tipPlace({ left: 100, top: 10, bottom: 30, width: 40 }, { width: 60, height: 24 }, 1000).top, 37);
  assert.equal(tipPlace({ left: 980, top: 200, bottom: 220, width: 20 }, { width: 60, height: 24 }, 1000).left, 934);
  assert.equal(tipPlace({ left: 0, top: 200, bottom: 220, width: 10 }, { width: 60, height: 24 }, 1000).left, 6);
});
