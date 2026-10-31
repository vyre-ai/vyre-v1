// The note view of an agent's file draws the names in it as links (rc.8): "Inherits: VYRE.md" opens VYRE.md, a missing [[link]] is dim and can be created.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Prose } from "./runbook/Prose.tsx";

const links = { targets: new Map([["VYRE.md", { id: "fil_v", name: "VYRE.md", path: "VYRE.md" }], ["agent.toml", { id: "fil_t", name: "agent.toml", path: "Agents/Intake/agent.toml" }], ["Brand voice", null]]), open: () => undefined, create: () => undefined } as never;

test("Prose draws file names as links, bullets too, and leaves code alone", () => {
  const html = renderToStaticMarkup(<Prose links={links} text={"# Intake\n\nInherits: VYRE.md\n\n- Settings: agent.toml\n- Voice: [[Brand voice]]\n- run `agent.toml` literally"} />);
  assert.match(html, /data-testid="filelink-fil_v"/);
  assert.match(html, /data-testid="filelink-fil_t"/);
  assert.match(html, /data-testid="filelink-missing-Brand voice"/);
  assert.match(html, /title="Agents\/Intake\/agent.toml"/);
  assert.equal(html.split("filelink-fil_t").length - 1, 1, "the name inside backticks stays code");
  assert.ok(!html.includes("[["));
});

test("without links Prose reads as before", () => {
  const html = renderToStaticMarkup(<Prose text={"Inherits: VYRE.md"} />);
  assert.ok(!html.includes("filelink-"));
  assert.match(html, /VYRE.md/);
});
