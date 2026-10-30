// The locked card for a Personal Space: an icon, the feature's name and one action. No paragraph.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { COMPUTER_ICON, TEAM_ONLY_ACTION, TeamOnly } from "./index.tsx";

test("the card names the feature, offers Set up a team, and carries a reader's label", () => {
  const out = renderToStaticMarkup(<TeamOnly title="Agent computers" icon={COMPUTER_ICON} />);
  assert.ok(out.includes("Agent computers") && out.includes(TEAM_ONLY_ACTION) && out.includes('data-testid="team-only-action"'));
  assert.ok(out.includes("Agent computers. Needs a Team Space."));
  assert.ok(out.includes("<svg"), "the icon is drawn");
});

test("a line and a different action show only when given", () => {
  const plain = renderToStaticMarkup(<TeamOnly title="Sites" icon={COMPUTER_ICON} />);
  const full = renderToStaticMarkup(<TeamOnly title="Sites" icon={COMPUTER_ICON} line="Team Spaces only" action="Create a team" />);
  assert.ok(!plain.includes("Team Spaces only") && full.includes("Team Spaces only") && full.includes("Create a team"));
});
