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
