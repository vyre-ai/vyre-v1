// Vault > Connections, the Browser kind: the words on a row, the site a person typed, and what Save sends. No screen.
import test from "node:test";
import assert from "node:assert/strict";
import { ALWAYS_HELD, draftOf, emptyDraft, hostOf, inputOf, rightsLine, runsWords, siteRow } from "./browser.ts";
import type { BrowserSite } from "./browser.ts";
import { assemble, noteOf, summaryWords } from "./model.ts";

const name = (id: string): string => ({ agt_scout: "Scout", agt_intake: "Intake", agt_a: "Ann", agt_b: "Bo", agt_c: "Cy" })[id] ?? id;
const SITE: BrowserSite = { id: "bsi_1", host: "app.gohighlevel.com", runsIn: "chrome", rights: [{ agentId: "agt_scout", right: "act" }, { agentId: "agt_intake", right: "read" }], at: 1, updatedAt: 1 };

test("a row says the site, where it runs and what each agent may do, with no 'Never used' that means nothing here", () => {
  const row = siteRow(SITE, name);
  assert.deepEqual([row.kind, row.title, row.section, row.health], ["browser", "app.gohighlevel.com", "mine", "ok"]);
  assert.equal(noteOf(row, 0, name), "Browser · My Chrome · Scout acts · Intake reads");
  assert.equal(runsWords("computers"), "Agent computers");
  assert.equal(runsWords("both"), "My Chrome and agent computers");
  assert.equal(rightsLine([], name), "No agent yet");
  assert.equal(rightsLine([{ agentId: "agt_a", right: "act" }, { agentId: "agt_b", right: "act" }, { agentId: "agt_c", right: "act" }], name), "Ann, Bo and 1 more act");
});

test("sites join Mine in the one list, and count among the connections", () => {
  const a = assemble(null, [], [], "usr_me", String, name, [SITE, { ...SITE, id: "bsi_2", host: "app.clio.com", runsIn: "both", rights: [] }]);
  assert.deepEqual(a.mine.map((r) => r.title), ["app.clio.com", "app.gohighlevel.com"]);
  assert.equal(summaryWords(a).total, 2);
});

test("the host is what a person typed, as an address, with a path or capitals; what is not a site is refused", () => {
  assert.equal(hostOf("https://App.GoHighLevel.com/contacts?x=1"), "app.gohighlevel.com");
  assert.equal(hostOf("app.clio.com:8443"), "app.clio.com");
  for (const bad of ["", "  ", "*.clio.com", "clio", "a b.com"]) assert.equal(hostOf(bad), null, JSON.stringify(bad));
});

test("Save sends the host, where it runs and only the agents given a right; No access leaves an agent out", () => {
  const d = { ...emptyDraft(), host: "https://App.Clio.com/x", runsIn: "both" as const, rights: { agt_scout: "act" as const, agt_intake: "off" as const, agt_a: "read" as const } };
  assert.deepEqual(inputOf(d), { ok: true, input: { host: "app.clio.com", runsIn: "both", rights: [{ agentId: "agt_scout", right: "act" }, { agentId: "agt_a", right: "read" }] } });
  assert.equal(inputOf({ ...d, host: "nope" }).ok, false);
  assert.deepEqual(draftOf(SITE), { host: "app.gohighlevel.com", runsIn: "chrome", rights: { agt_scout: "act", agt_intake: "read" } });
  assert.match(ALWAYS_HELD, /Sends, posts, payments and deletes are always held/);
});
