import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import Mount, { title } from "./mounts/P-ONB_01.tsx";

test("the onboarding mount draws a blank first frame, then reads ?view after mount", () => {
  assert.equal(title, "Onboarding");
  assert.ok(!renderToStaticMarkup(<Mount />).includes('data-testid="onboarding"'));
});
