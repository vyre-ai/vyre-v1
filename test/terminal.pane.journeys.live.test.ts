// The Terminal tab of the chat's right pane in the real app (rc.8 hotfix): Open terminal names the computer the person is on, so a terminal opens instead of "Could not open". A scripted terminal
// stands in for tmux. Needs the production web export (VYRE_APP_DIST) and Chromium; without them it skips and says why, and with VYRE_REQUIRE_CHROME=1 (CI) it fails instead. Screenshots, light and dark,
// desktop and phone, go to shots-evidence/terminal-pane/<kind>/.
import test from "node:test";
import assert from "node:assert/strict";
import { connectClaude, makeAgent, unlockVault } from "./support/mail-world.ts";
import { bootScreens, browserOrSkip, open, phonePass, seat, shoot } from "./support/mail-browser.ts";
import { standIn } from "./memory-live-kit.ts";
import { bindHost as bindTerminal } from "../modules/terminal/impl.ts";
import type { TerminalHost } from "../modules/terminal/projections.ts";
import { bindHost as bindComputers } from "../modules/computers/projections.ts";
import type { ComputerHost } from "../modules/computers/projections.ts";
import { fakeHost } from "../modules/computers/fixtures/fake-host.ts";
import { guardCrashes } from "../apps/app/tests/crash-guard.ts";

const KEY = "sk-ant-api03-JOURNEYkeyVALUE9876543210zyxwvuts"; // secret-scan: fake

function scriptedTerminal(opened: Array<Record<string, unknown>>): TerminalHost {
  const screens = new Map<string, string>();
  return {
    async open(a) { opened.push(a.target as unknown as Record<string, unknown>); screens.set(a.terminalId, "$ "); return { cwd: "/home/olivia", title: "This computer" }; },
    async input(id, data) { screens.set(id, (screens.get(id) ?? "") + data); },
    async interrupt() {}, async resize() {},
    async read(id, o) { const all = screens.get(id) ?? ""; return { text: all.slice(o.since ?? 0), next: all.length }; },
    async run(_id, o) { return { exitCode: 0, output: `ran: ${o.command}`, truncated: false, durationMs: 5 }; },
    async status(ids) { return ids.map((id) => ({ terminalId: id, state: "idle" as const, exitCode: null })); },
    async close() {}, async health() { return { ok: true, sessions: screens.size }; },
  };
}

for (const kind of ["personal", "team"] as const) for (const own of [false, true]) test(`terminal pane journey, ${kind}, agent ${own ? "with" : "without"} its own computer: Open terminal in the chat pane opens a terminal on ${own ? "the agent's computer" : "its workspace, or this computer"}`, async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  const s = await bootScreens({ kind, engineOpenSession: standIn }, env);
  const dir = `shots-evidence/terminal-pane/${kind}${own ? "-agent-computer" : ""}`;
  const opened: Array<Record<string, unknown>> = [];
  try {
    const w = s.world;
    await unlockVault(w);
    bindTerminal(scriptedTerminal(opened));
    let agentId: string;
    if (kind === "team") agentId = await makeAgent(w.owner, "Desk", await connectClaude(w));
    else {
      await w.owner.ok("providers.add", { providerKey: "anthropic", connection: "api_key", apiKey: KEY, name: "My Claude", scope: "mine" });
      agentId = (await w.owner.ok("agents.create", { name: "Desk", role: "You help." })).agent.agentId as string;
    }
    // every agent has a Terminal; with its own computer it opens there, without one in its workspace (or on this computer where the Space has no machine for workspaces)
    if (own) {
      bindComputers({ ...fakeHost().host, async tool() { return { ok: true, frame: "iVBORw0KGgo=" }; } } as unknown as ComputerHost);
      const computerId = (await w.owner.ok("computers.provision", { agentId })).computer.computerId as string;
      await w.owner.ok("computers.wake", { computerId });
    }
    await w.owner.ok("chat.start", { kind: "chat", agentIds: [agentId], title: "Desk work" });
    const me = await seat(s, w.owner, "Owner");
    const guard = guardCrashes(me.page);
    await open(me, s, "/chat");
    await me.page.getByTestId("chats-place").waitFor({ timeout: 20_000 });
    await me.page.getByText("Desk work", { exact: true }).first().click();
    await me.page.getByTestId("composer-field").waitFor({ timeout: 20_000 });
    if (await me.page.getByTestId("pane-agent").count() === 0) await me.page.getByTestId("pane-button").click();
    await me.page.getByTestId("pane-agent").waitFor({ timeout: 20_000 });
    // the pane's tabs that do not fit sit behind the chevron: in a Team Space (Computer is also there) Terminal is one of them
    if (await me.page.getByTestId("tab-terminal").count() > 0) await me.page.getByTestId("tab-terminal").click();
    else { await me.page.getByTestId("tab-more").click(); await me.page.getByRole("menuitem", { name: "Terminal" }).or(me.page.getByRole("button", { name: "Terminal", exact: true })).first().click(); }
    await me.page.getByTestId("terminal-pane-open").waitFor({ timeout: 20_000 }).catch(async (e: unknown) => { await guard.check("waiting for Open terminal"); throw e; });
    await guard.check("on the Terminal tab");
    await shoot(me.page, dir, "pane-empty");
    await me.page.getByTestId("terminal-pane-open").click();
    await me.page.getByTestId("terminal-tab").waitFor({ timeout: 20_000 });
    assert.equal(await me.page.getByText("Could not open").count(), 0, "no dead button");
    assert.equal(opened.length, 1);
    // 12 Nov (audit item 15): an agent with a workspace the person may enter opens there, the sessions its own commands use; only where the Space has no machine for one does it open on this computer
    const ws = (await w.owner.ok("terminal.workspace", { agentId })) as { state: string; canAttach: boolean };
    if (own) assert.equal(opened[0]!["host"], "agent_computer", "it opens on the agent's own computer");
    else if (ws.canAttach && ws.state !== "unavailable") assert.deepEqual([opened[0]!["host"], opened[0]!["agentId"]], ["agent_computer", agentId], "it opens in the agent's workspace");
    else {
      assert.equal(opened[0]!["host"], "device");
      assert.ok(typeof opened[0]!["deviceId"] === "string" && (opened[0]!["deviceId"] as string).length > 0, "the terminal names the computer it opens on");
    }
    await shoot(me.page, dir, "pane-open");
    await phonePass(me, s, dir, [{ name: "chat", route: "/chat" }]);
    assert.deepEqual(me.errors, [], "no page errors");
  } finally { bindComputers(null); bindTerminal(null); await s.close(); }
});
