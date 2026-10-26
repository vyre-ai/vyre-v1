import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import Mount, { title } from "./P-APP_03.tsx";

test("the owner claim mount draws a blank first frame, then reads ?view after mount", () => {
  assert.equal(title, "Owner claim");
  assert.ok(!renderToStaticMarkup(<Mount />).includes('data-testid="claim-name"'));
});
