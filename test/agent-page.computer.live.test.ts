// The agent's page has one Computer tab: Terminal and Browser, the same component as the chat's pane (owner ruling 6 Nov 2026, DESIGN-agent-workspaces.md). Every way to "its computer" lands there, and a Space
// with nowhere to run a browser says so in a line. Real app, real Chromium, a Team world with a scripted terminal and a scripted Space browser. Needs VYRE_APP_DIST and Chromium (skips without; VYRE_REQUIRE_CHROME=1 fails).
import test from "node:test";
import assert from "node:assert/strict";
import { unlockVault } from "./support/mail-world.ts";
import { bootScreens, browserOrSkip, open, seat, shoot } from "./support/mail-browser.ts";
import { bindHost as bindComputers } from "../modules/computers/projections.ts";
import type { ComputerHost } from "../modules/computers/projections.ts";
import { fakeHost } from "../modules/computers/fixtures/fake-host.ts";
import { bindHost as bindTerminal } from "../modules/terminal/impl.ts";
import { bindSpaceBrowser } from "../modules/computers/sbrowser/port.ts";
import { agentFor, fakeSpaceBrowser, PNG, scriptedTerminal } from "./support/computers-journey.ts";

const OUT = "shots-evidence/agentpage";

test("the agent page: Terminal and Browser in its Computer tab, no host says so in a line, and every door to its computer opens that tab", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  const s = await bootScreens({ kind: "team" }, env);
  try {
    const w = s.world;
    await unlockVault(w);
    const machine = { ...fakeHost().host, async tool() { return { ok: true, frame: PNG }; } } as unknown as ComputerHost;
    bindTerminal(scriptedTerminal());
    bindComputers(machine);
    const agentId = await agentFor(w, "team");
    const computerId = (await w.owner.ok("computers.provision", { agentId })).computer.computerId as string;
    const me = await seat(s, w.owner, "Owner");
    const page = me.page;
    const agentPage = `/chat#screen=chats.agent-page&agentId=${agentId}&tab=computer`;

    // no Space browser: one plain line, and nothing to press that cannot work
    bindSpaceBrowser(null);
    await open(me, s, agentPage);
    await page.getByTestId("agent-page").waitFor({ timeout: 30_000 });
    await shoot(page, OUT, "page-no-host");
    await page.getByTestId("browser-note").waitFor({ timeout: 20_000 });
    assert.match(await page.getByTestId("browser-note").innerText(), /nowhere to run a browser yet/);
    for (const id of ["browser-take", "browser-give", "browser-open", "browser-loading"]) assert.equal(await page.getByTestId(id).count(), 0, `${id} is not offered where nothing can run`);

    // a Space browser: the page's Computer tab is Terminal and Browser, and Take over and Give back work from it
    const browserd = fakeSpaceBrowser();
    bindSpaceBrowser(browserd.sb);
    browserd.rows.set(agentId, { profileId: agentId, running: true, tabs: 1, busy: false, takeover: false, viewers: 0, lastActiveAt: Date.now(), held: 0, paused: false });
    await open(me, s, agentPage);
    await page.getByTestId("agent-page").waitFor({ timeout: 30_000 });
    await shoot(page, OUT, "page-computer-tab");
    await page.getByTestId("terminal-card").waitFor({ timeout: 20_000 });
    await page.getByTestId("browser-take").waitFor({ timeout: 20_000 });
    assert.equal(await page.getByTestId("computer-screen").count(), 0, "the old desktop screen is not drawn");
    await page.getByTestId("browser-take").click();
    await page.getByTestId("browser-give").waitFor({ timeout: 20_000 });
    assert.equal(browserd.rows.get(agentId)?.takeoverBy, w.owner.id);
    await page.getByTestId("browser-give").click();
    await page.getByTestId("browser-take").waitFor({ timeout: 20_000 });
    assert.equal(browserd.rows.get(agentId)?.takeoverBy, undefined);

    // the door the old computer popup had: a link or route that names the computer lands on the agent's Computer tab
    await open(me, s, `/chat#screen=chats.agent-computer&computerId=${computerId}`);
    await shoot(page, OUT, "door-computer-route");
    await page.getByTestId("agent-page").waitFor({ timeout: 30_000 });
    await page.getByTestId("browser-card").waitFor({ timeout: 20_000 });
    assert.equal(await page.getByTestId("computer-screen").count(), 0);
    assert.deepEqual(me.errors, [], "no page errors");
  } finally { bindSpaceBrowser(null); bindComputers(null); bindTerminal(null); await s.close(); }
});
