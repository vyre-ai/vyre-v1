// The Computer tab of one shared agent, seen by its owner (Ada) and by a person shared with it at Use (Bea), from the real app (rc.29, F30): Ada sees her computer and says there are terminals of other people;
// Bea sees her own space on it and only her own terminals. Pictures at 1440 wide (dark) and at phone width 390 (light) go to shots-evidence/f-wall. Needs the production web export (VYRE_APP_DIST) and Chromium.
import test from "node:test";
import assert from "node:assert/strict";
import { SIZES, open, seat, shoot } from "./support/mail-browser.ts";
import { world } from "./support/computer-tab-world.ts";

const DIR = "shots-evidence/f-wall";
const WIDE = { width: 1440, height: 900 };

test("the Computer tab as Ada and as Bea on the same shared agent", { timeout: 420_000 }, async (t) => {
  const k = await world(t, { noTerminal: true });
  if (!k) return;
  try {
    const bea = await k.s.world.join("bea");
    // a channel of both with the agent: its right pane has the agent's Computer tab for each of them
    const ch = await k.w.owner.ok("channels.create", { name: "desk", visibility: "invite", memberIds: [bea.id], agentIds: [k.agentId] });
    const channelId = ch.channel.mainThreadId as string;
    // Ada has a terminal of her own on the agent's computer, and Bea has one of hers
    await k.w.owner.ok("terminal.open", { host: "agent_computer", agentId: k.agentId, name: "ada-notes", idempotencyKey: "ada-term" });
    await bea.ok("terminal.open", { host: "agent_computer", agentId: k.agentId, name: "bea-notes", idempotencyKey: "bea-term" });
    const beaSeat = await seat(k.s, bea, "Bea");
    const tab = async (who: typeof k.me | typeof beaSeat): Promise<void> => {
      await open(who, k.s, "/chat");
      await who.page.getByTestId("chats-place").waitFor({ timeout: 20_000 });
      await who.page.getByText("desk", { exact: true }).first().click();
      await who.page.getByTestId("composer-field").waitFor({ timeout: 20_000 });
      if ((await who.page.getByTestId("chats-right-pane").count()) === 0) await who.page.getByTestId("pane-button").click();
      await who.page.getByTestId("chats-right-pane").waitFor({ timeout: 20_000 });
      await who.page.getByTestId("tab-computer").or(who.page.getByTestId("tab-computer-selected")).first().click();
      await who.page.getByTestId("terminals-head").waitFor({ timeout: 20_000 });
      await who.page.waitForTimeout(1500);
    };
    void channelId;
    for (const [who, name] of [
      [k.me, "ada"],
      [beaSeat, "bea"],
    ] as const) {
      await who.page.setViewportSize(WIDE);
      await tab(who);
      if (name === "bea") {
        assert.match(await who.page.getByTestId("terminal-whose").innerText(), /Your own space on .*computer/, "Bea's tab says whose it is");
        assert.equal(await who.page.getByTestId("row-session-ada-notes").count(), 0, "Bea does not see Ada's terminal");
        assert.equal(await who.page.getByTestId("row-session-bea-notes").count(), 1, "Bea sees her own");
      } else {
        assert.equal(await who.page.getByTestId("row-session-ada-notes").count(), 1, "Ada sees hers");
        assert.equal(await who.page.getByTestId("row-session-bea-notes").count(), 0, "Ada does not see Bea's");
        assert.match(await who.page.getByTestId("terminal-whose").innerText(), /1 terminal of another person is open here/);
      }
      await shoot(who.page, `${DIR}/${name}`, `computer-tab-1440`);
      await who.page.setViewportSize(SIZES.phone);
      await tab(who).catch(() => undefined);
      await shoot(who.page, `${DIR}/${name}`, `computer-tab-390`);
    }
  } finally {
    await k.close();
  }
});
