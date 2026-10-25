// ui/NeedsTeamSpace: one sentence, one action, the same words everywhere (spec 3.10, 2.1).
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { NEEDS_TEAM_SPACE_ACTION, NEEDS_TEAM_SPACE_LABEL, NeedsTeamSpace, frozenNeedsTeamSpaceProps, needsTeamSentence } from "./index.tsx";

test("the sentence and the action never vary", () => {
  assert.equal(NEEDS_TEAM_SPACE_LABEL, "Needs a Team Space");
  assert.equal(NEEDS_TEAM_SPACE_ACTION, "Create or join a Team Space");
  const html = renderToStaticMarkup(<NeedsTeamSpace {...frozenNeedsTeamSpaceProps} />);
  assert.match(html, /Needs a Team Space/);
  assert.match(html, /Sites, forms and campaigns/);
  assert.match(html, /Create or join a Team Space/);
  assert.match(html, /data-testid="needs-team-space-action"/);
});

test("with nothing blocked named, the sentence stands alone", () => {
  const html = renderToStaticMarkup(<NeedsTeamSpace what="" density="regular" />);
  assert.match(html, /Needs a Team Space/);
  assert.doesNotMatch(html, /·/);
  assert.equal(needsTeamSentence(""), "Needs a Team Space.");
  assert.equal(needsTeamSentence("Agent computers."), "Needs a Team Space. Agent computers.");
});

test("the screen reader reads the sentence as an alert, the action is a button", () => {
  const html = renderToStaticMarkup(<NeedsTeamSpace what="Agent computers" density="regular" />);
  assert.match(html, /role="alert"/);
  assert.match(html, /aria-label="Needs a Team Space\. Agent computers\."/);
  assert.match(html, /<button|role="button"/);
});

test("on a phone the action sits under the line", () => {
  const compact = renderToStaticMarkup(<NeedsTeamSpace what="Sites" density="compact" />);
  const regular = renderToStaticMarkup(<NeedsTeamSpace what="Sites" density="regular" />);
  assert.notEqual(compact, regular);
});

// Run on the final commit of P-L9_06 (lead request: every named test shows ok).
