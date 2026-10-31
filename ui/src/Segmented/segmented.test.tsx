// ui/Segmented: one option is chosen, a press changes it, and an option's hint is its tooltip.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Segmented } from "./index.tsx";

const options = [{ id: "public", label: "Public", hint: "Anyone can join" }, { id: "invite", label: "Invite only", hint: "Only people you add" }] as const;

test("the chosen option is selected and each option carries its hint as the tooltip", () => {
  const html = renderToStaticMarkup(<Segmented label="Who can join" options={options} value="invite" onChange={() => undefined} testID="vis" />);
  assert.match(html, /role="tablist"/);
    assert.ok(html.includes('title="Anyone can join"') && html.includes('title="Only people you add"'));
  assert.ok(html.includes('data-testid="vis-public"') && html.includes('data-testid="vis-invite"'));
});
