// The Plan shots mount draws the prototype project's plan: its stages, tasks and reviewers (so both sides of the shot show the same data).
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import Mount from "./mounts/P-UI_12.tsx";

test("the shots mount draws the prototype project's plan with its stages, tasks and reviewers", () => {
  const html = renderToStaticMarkup(<Mount />);
  assert.ok(html.includes('data-testid="plan-root"') && html.includes('data-testid="plan-bar-t4"'));
  for (const stage of ["Intake", "Drafting", "In review", "Delivered"]) assert.ok(html.includes(stage), stage);
});
