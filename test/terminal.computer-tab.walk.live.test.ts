// The agent page's Computer tab in the real app (owner walk, 12 Nov, items 3 and 4): in a Space where nothing can run workspaces the Terminal section says so in plain words, offers no Attach and gives
// an owner the way to Console > Computers; and the header's word for the agent (its turns: Active or Idle) is not the workspace's word (Asleep), so one screen never says Awake over Asleep.
// Needs the production web export (VYRE_APP_DIST) and Chromium. Screenshots go to shots-evidence/computer-tab/.
import test from "node:test";
import assert from "node:assert/strict";
import { connectClaude, makeAgent, unlockVault } from "./support/mail-world.ts";
import { bootScreens, browserOrSkip, open, seat, shoot } from "./support/mail-browser.ts";
import { standIn } from "./memory-live-kit.ts";
import { bindWorkspaceStatus, bindWorkspaces } from "../modules/terminal/projections.ts";
import { guardCrashes } from "../apps/app/tests/crash-guard.ts";

for (const scene of ["no-host", "asleep"] as const) test(`computer tab, ${scene}: the Terminal section says what is true and offers only what works; the header's word is the agent's, not the workspace's`, async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  const s = await bootScreens({ kind: "team", engineOpenSession: standIn }, env);
  const dir = `shots-evidence/computer-tab/${scene}`;
  try {
    const w = s.world;
    await unlockVault(w);
    const agentId = await makeAgent(w.owner, "Desk", await connectClaude(w));
    bindWorkspaces(true);
    // no-host: the Space's container runtime does not answer; asleep: a workspace that sleeps
    bindWorkspaceStatus(scene === "no-host" ? async () => { throw Object.assign(new Error("No machine for workspaces answers."), { workspace: true }); } : async () => ({ state: "asleep" as const, host: "space" as const }));
    const me = await seat(s, w.owner, "Owner");
    const guard = guardCrashes(me.page);
    // the agent page's Computer tab, as a link opens it (Chats > Agents > Desk > Computer)
    await open(me, s, `/chat#screen=chats.agent-page&agentId=${agentId}&tab=computer`);
    await me.page.getByTestId("terminal-card").waitFor({ timeout: 20_000 });
    await guard.check("on the Computer tab");
    await shoot(me.page, dir, "computer-tab");
    const card = (await me.page.getByTestId("terminal-card").innerText()).replace(/\s+/g, " ");
    if (scene === "no-host") {
      assert.match(card, /Not set up yet/);
      assert.match(card, /This Space can't run agent workspaces yet\. That needs Docker on the Space's server, or another server with Docker added in Console > Computers\./);
      assert.equal(await me.page.getByTestId("terminal-attach").count(), 0, "no Attach that cannot work");
      assert.equal(await me.page.getByTestId("terminal-open-console").count(), 1, "the owner is offered Console > Computers");
    } else {
      assert.match(card, /Asleep/);
      const page = await me.page.locator("body").innerText();
      assert.equal(/\bAwake\b/.test(page), false, "no Awake beside the workspace's Asleep");
    }
    assert.deepEqual(me.errors, [], "no page errors");
  } finally { bindWorkspaceStatus(null); bindWorkspaces(false); await s.close(); }
});
