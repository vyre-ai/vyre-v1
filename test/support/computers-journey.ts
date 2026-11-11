// The real app, the agent's computer in a chat (rc.9 flows 11 to 13), in a real Chromium against a Team world with a scripted computer and a scripted terminal (no Docker: the Docker proof of the
// same machine is host/tests/computers.live.test.ts in the heavy lane). Needs the production web export (VYRE_APP_DIST) and Chromium; without them it skips and says why, and with VYRE_REQUIRE_CHROME=1
// (CI) it fails instead. Screenshots of every step, light and dark, desktop and phone, go to shots-evidence/computers/<journey>/.
// Run in Team and in Personal (a Personal Space has the person's own key and no Shared folder).
//   1 Run this: the agent shows a command, the bar offers Run on the agent's computer, a read-only command runs and its output is shown under the block.
//   2 The Computer tab (owner ruling 6 Nov 2026, DESIGN-agent-workspaces.md): Terminal and Browser; Take over and Give back act on the agent's Space browser profile, who may is the server's rule, and the state survives a reload.
//   3 The live card: the agent starts working on its computer for the chat, the message holds the live view, and it freezes to the last picture when the computer sleeps.
import test from "node:test";
import assert from "node:assert/strict";
import { connectClaude, makeAgent, unlockVault, until } from "./mail-world.ts";
import { bootScreens, browserOrSkip, open, phonePass, seat, shoot } from "./mail-browser.ts";
import { standIn } from "../memory-live-kit.ts";
import { bindHost as bindComputers } from "../../modules/computers/projections.ts";
import type { ComputerHost } from "../../modules/computers/projections.ts";
import { fakeHost } from "../../modules/computers/fixtures/fake-host.ts";
import { bindHost as bindTerminal } from "../../modules/terminal/impl.ts";
import type { TerminalHost } from "../../modules/terminal/projections.ts";
import type { OpenSession } from "../../agent/src/turn-engine/index.ts";
import { ToolError } from "../../modules/computers/handlers/tools/common.ts";
import { bindSpaceBrowser } from "../../modules/computers/sbrowser/port.ts";
import type { ProfileRow, SpaceBrowser } from "../../modules/computers/sbrowser/port.ts";

const OUT = "shots-evidence/computers";
const PNG = "iVBORw0KGgo=";

/** The model stand-in, except that "show me the command" is answered with a command in a shell block, as a model would. */
const modelWithCommand: OpenSession = async (spec) => {
  const inner = await standIn(spec);
  return {
    ...inner,
    async *send(input) {
      if (String(input.trigger?.body ?? "").includes("show me the command")) { yield { type: "text", text: "Run this to see the folder:\n\n```bash\nls -la\n```" }; yield { type: "done" }; return; }
      yield* inner.send(input);
    },
  } as ReturnType<OpenSession> extends Promise<infer S> ? S : never;
};

function scriptedTerminal(): TerminalHost {
  const screens = new Map<string, string>();
  return {
    async open(a) { screens.set(a.terminalId, ""); return { cwd: "/home/agent", title: "Desk's computer" }; },
    async input(id, data) { screens.set(id, (screens.get(id) ?? "") + data); },
    async interrupt() {}, async resize() {},
    async read(id, o) { const all = screens.get(id) ?? ""; return { text: all.slice(o.since ?? 0), next: all.length }; },
    async run(_id, o) { return { exitCode: 0, output: `ran: ${o.command}`, truncated: false, durationMs: 5 }; },
    async status(ids) { return ids.map((id) => ({ terminalId: id, state: "idle" as const, exitCode: null })); },
    async close() {}, async health() { return { ok: true, sessions: screens.size }; },
  };
}

/** A Space browser that keeps one profile row per agent: who holds the controls is the row's, the way the browser service keeps it. */
function fakeSpaceBrowser(): { sb: SpaceBrowser; rows: Map<string, ProfileRow> } {
  const rows = new Map<string, ProfileRow>();
  const sb: SpaceBrowser = {
    async available() { return true; }, async tool() { return {}; }, async downloads() { return []; }, async downloadRead() { return new Uint8Array(); }, async downloadAck() {},
    async takeover(a) {
      const r = rows.get(a.profileId) ?? { profileId: a.profileId, running: true, tabs: 1, busy: false, takeover: false, viewers: 0, lastActiveAt: Date.now(), held: 0, paused: false };
      if (r.takeoverBy && r.takeoverBy !== a.personId) throw new ToolError("bad_input", "Someone else has the controls.");
      rows.set(a.profileId, { ...r, takeover: true, takeoverBy: a.personId });
    },
    async giveBack(id) { const { takeoverBy: _t, ...r } = rows.get(id)!; rows.set(id, { ...r, takeover: false }); },
    async screenshot() { return { bytes: new Uint8Array(), width: 1, height: 1 }; },
    async stream(a) { return { transport: "mjpeg", url: `http://127.0.0.1:9/stream?p=${a.profileId}`, ws: `ws://127.0.0.1:9/ws?p=${a.profileId}` }; },
    async sessions() { return []; }, async signOut() { return true; }, async importChrome() { return { bytes: 0 }; }, async stop() {}, async forget() {},
    async profiles() { return { profiles: [...rows.values()], maxRunning: 6 }; }, async health() { return { ok: true }; },
  };
  return { sb, rows };
}

const KEY = "sk-ant-api03-JOURNEYkeyVALUE9876543210zyxwvuts"; // secret-scan: fake

/** Team: the admin files the AI account in a Shared folder and the agent is pinned to it. Personal: the person's own key, and the agent answers on it as they ask. */
async function agentFor(w: Awaited<ReturnType<typeof bootScreens>>["world"], kind: "personal" | "team"): Promise<string> {
  if (kind === "team") return makeAgent(w.owner, "Desk", await connectClaude(w));
  await w.owner.ok("providers.add", { providerKey: "anthropic", connection: "api_key", apiKey: KEY, name: "My Claude", scope: "mine" });
  return (await w.owner.ok("agents.create", { name: "Desk", role: "You work at a computer." })).agent.agentId as string;
}

/** One journey of this file, in a Team Space or in a Personal one (two files, so neither runs past the 120 s file cap). */
export function computersJourney(kind: "team" | "personal"): void {
  test(`computers journey, ${kind}: Run this on the agent's computer, the computer in the pane with Take over and Give back, and the live card`, async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  const s = await bootScreens({ kind, engineOpenSession: modelWithCommand }, env);
  const dir = `${OUT}/${kind}`;
  try {
    const w = s.world;
    await unlockVault(w);
    const fake = fakeHost();
    const machine = { ...fake.host, async tool() { return { ok: true, frame: PNG }; } } as unknown as ComputerHost;
    bindTerminal(scriptedTerminal());
    const agentId = await agentFor(w, kind);
    const threadId = (await w.owner.ok("chat.start", { kind: "chat", agentIds: [agentId], title: "Desk work" })).thread.threadId as string;
    const me = await seat(s, w.owner, "Owner");
    const reply = (re: RegExp) => until(async () => { await w.d.hooks?.pump?.(); const r = await w.owner.call("chat.messages.list", { threadId }); return (r.data.messages as Array<{ body?: string }>).find((m) => re.test(m.body ?? "")) ?? null; }, `a message matching ${re}`, 40_000);
    const showChat = async (): Promise<void> => {
      await open(me, s, "/chat");
      await me.page.getByTestId("chats-place").waitFor({ timeout: 20_000 });
      await me.page.getByText("Desk work", { exact: true }).first().click();
      await me.page.getByTestId("composer-field").waitFor({ timeout: 20_000 });
    };

    bindComputers(null);   // a runner with Docker wires the real host at boot: start from a Space that has no capable host
    // The Computer tab is always there (no grant button). On a Space with no host that can run it, it says so in one plain line and offers nothing that fails when pressed.
    bindSpaceBrowser(null);
    await showChat();
    if (await me.page.getByTestId("pane-agent").count() === 0) await me.page.getByTestId("pane-button").click();   // the chat header's own button; the pane starts closed
    await me.page.getByTestId("pane-agent").waitFor({ timeout: 20_000 });
    await me.page.getByTestId("tab-computer").click();
    // what a person reads: the Browser says in one line that there is nowhere to run it, and nothing in the tab can be pressed to no effect or waits for ever
    await me.page.getByTestId("browser-note").waitFor({ timeout: 20_000 });
    assert.match(await me.page.getByTestId("browser-note").innerText(), /nowhere to run a browser yet. Add a compute server/);
    for (const id of ["browser-take", "browser-give", "browser-open", "browser-loading", "terminal-loading"]) assert.equal(await me.page.getByTestId(id).count(), 0, `${id} is not offered where nothing can run`);
    await shoot(me.page, dir, "no-host");
    bindComputers(machine);   // the capable host: a Team Space has one from the start, a Personal Space once a server is added
    if (kind === "personal") assert.equal((await w.owner.ok("computers.hosts", {})).available, true, "now a host can run a computer");
    const computerId = (await w.owner.ok("computers.provision", { agentId })).computer.computerId as string;
    await w.owner.ok("computers.wake", { computerId });

    // 1 Run this
    await w.owner.ok("chat.post", { threadId, body: "show me the command", mentions: [{ kind: "agent", id: agentId }] });
    await reply(/ls -la/);
    await showChat();
    await me.page.getByTestId("run-code").waitFor({ timeout: 30_000 });
    await shoot(me.page, dir, "run-bar");
    await me.page.getByTestId("run-code-run").click();
    await me.page.getByTestId("run-code-out").waitFor({ timeout: 30_000 });
    assert.match(await me.page.getByTestId("run-code-out").innerText(), /ran: ls -la/);
    await shoot(me.page, dir, "run-output");

    // 2 the Computer tab: Terminal and Browser; Take over and Give back act on the agent's profile in the Space browser
    const browserd = fakeSpaceBrowser();
    bindSpaceBrowser(browserd.sb);
    browserd.rows.set(agentId, { profileId: agentId, running: true, tabs: 1, busy: false, takeover: false, viewers: 0, lastActiveAt: Date.now(), held: 0, paused: false });
    const profile = async (): Promise<{ takeoverBy?: string } | undefined> => ((await w.owner.ok("computers.browser.profiles", {})).profiles as Array<{ agentId: string; takeoverBy?: string }>).find((x) => x.agentId === agentId);
    const openComputerTab = async (): Promise<void> => {
      if (await me.page.getByTestId("pane-agent").count() === 0) await me.page.getByTestId("pane-button").click();
      await me.page.getByTestId("pane-agent").waitFor({ timeout: 20_000 });
      await me.page.getByTestId("tab-computer").click();
    };
    await showChat();
    await openComputerTab();
    await me.page.getByTestId("terminal-card").waitFor({ timeout: 20_000 });   // the tab is Terminal and Browser, one card each
    await me.page.getByTestId("browser-card").waitFor({ timeout: 20_000 });
    await me.page.getByTestId("browser-take").waitFor({ timeout: 20_000 });
    assert.match(await me.page.getByTestId("browser-state").innerText(), /^Open/);
    await shoot(me.page, dir, "pane-working");
    // who may: a team agent's browser is for an owner or an admin, so a member who is neither does not see it nor can take it over
    if (kind === "team") {
      const pat = await w.join("pat");
      assert.deepEqual(((await pat.ok("computers.browser.profiles", {})).profiles as unknown[]), [], "a member sees none of the team agents' browsers");
      const refused = await pat.call("computers.browser.take_over", { agentId });
      assert.equal(refused.status, 403, `a member cannot take over: ${JSON.stringify(refused)}`);
      assert.match(String(refused.data?.error?.code), /^permission\./);
    }
    await me.page.getByTestId("browser-take").click();
    await me.page.getByTestId("browser-give").waitFor({ timeout: 20_000 });
    assert.match(await me.page.getByTestId("browser-state").innerText(), /in control/);
    assert.equal(await me.page.getByTestId("browser-take").count(), 0, "while you hold it there is only Give back");
    assert.equal((await profile())?.takeoverBy, w.owner.id, "the browser service has the owner at the controls");
    await shoot(me.page, dir, "pane-in-control");
    // the state is the browser's, not the page's: it is still there after a reload
    await showChat();
    await openComputerTab();
    await me.page.getByTestId("browser-give").waitFor({ timeout: 20_000 });
    await me.page.getByTestId("browser-give").click();
    await me.page.getByTestId("browser-take").waitFor({ timeout: 20_000 });
    assert.equal((await profile())?.takeoverBy, undefined, "given back, nobody holds it");
    assert.match(await me.page.getByTestId("browser-state").innerText(), /^Open/);
    await shoot(me.page, dir, "given-back");

    // 3 the live card
    await w.owner.ok("chat.post", { threadId, body: `TOOL screen_click ${JSON.stringify({ computerId, x: 20, y: 20 })}`, mentions: [{ kind: "agent", id: agentId }] });
    const card = me.page.locator('[data-testid^="live-card-"]').first();
    await card.waitFor({ timeout: 40_000 });
    await card.scrollIntoViewIfNeeded();
    await shoot(me.page, dir, "live-card");
    await w.owner.ok("computers.sleep", { computerId });
    await me.page.getByText("Done", { exact: true }).first().waitFor({ timeout: 30_000 });
    await card.scrollIntoViewIfNeeded();
    await shoot(me.page, dir, "live-card-frozen");
    await phonePass(me, s, dir, [{ name: "chat", route: "/chat" }]);
    assert.deepEqual(me.errors, [], "no page errors");
  } finally { bindComputers(null); bindTerminal(null); await s.close(); }
});
}
