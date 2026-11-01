// The Terminal tab of the chat's right pane in the real app (rc.8 hotfix): Open terminal names the computer the person is on, so a terminal opens instead of "Could not open". A scripted terminal
// stands in for tmux. Needs the production web export (VYRE_APP_DIST) and Chromium; without them it skips and says why, and with VYRE_REQUIRE_CHROME=1 (CI) it fails instead. Screenshots, light and dark,
// desktop and phone, go to shots-evidence/terminal-pane/<kind>/.
import test from "node:test";
import assert from "node:assert/strict";
import { connectClaude, makeAgent, unlockVault } from "./support/mail-world.ts";
import { bootScreens, browserOrSkip, open, seat, shoot } from "./support/mail-browser.ts";
import { standIn } from "./memory-live-kit.ts";
import { bindHost as bindTerminal } from "../modules/terminal/impl.ts";
import type { TerminalHost } from "../modules/terminal/projections.ts";

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

for (const kind of ["personal", "team"] as const) test(`terminal pane journey, ${kind}: Open terminal in the chat pane opens a terminal on this computer`, async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  const s = await bootScreens({ kind, engineOpenSession: standIn }, env);
  const dir = `shots-evidence/terminal-pane/${kind}`;
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
    await w.owner.ok("chat.start", { kind: "chat", agentIds: [agentId], title: "Desk work" });
    const me = await seat(s, w.owner, "Owner");
    await open(me, s, "/chat");
    await me.page.getByTestId("chats-place").waitFor({ timeout: 20_000 });
    await me.page.getByText("Desk work", { exact: true }).first().click();
    await me.page.getByTestId("composer-field").waitFor({ timeout: 20_000 });
    if (await me.page.getByTestId("pane-agent").count() === 0) await me.page.getByTestId("pane-button").click();
    await me.page.getByTestId("pane-agent").waitFor({ timeout: 20_000 });
    await me.page.getByTestId("tab-terminal").click();
    await me.page.getByTestId("terminal-pane-open").waitFor({ timeout: 20_000 });
    await shoot(me.page, dir, "pane-empty");
    await me.page.getByTestId("terminal-pane-open").click();
    await me.page.getByTestId("terminal-tab").waitFor({ timeout: 20_000 });
    assert.equal(await me.page.getByText("Could not open").count(), 0, "no dead button");
    assert.equal(opened.length, 1);
    assert.equal(opened[0]!["host"], "device");
    assert.ok(typeof opened[0]!["deviceId"] === "string" && (opened[0]!["deviceId"] as string).length > 0, "the terminal names the computer it opens on");
    await shoot(me.page, dir, "pane-open");
    assert.deepEqual(me.errors, [], "no page errors");
  } finally { bindTerminal(null); await s.close(); }
});
