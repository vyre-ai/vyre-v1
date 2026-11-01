// The real app, the agent's computer in a chat (rc.9 flows 11 to 13), in a real Chromium against a Team world with a scripted computer and a scripted terminal (no Docker: the Docker proof of the
// same machine is host/tests/computers.live.test.ts in the heavy lane). Needs the production web export (VYRE_APP_DIST) and Chromium; without them it skips and says why, and with VYRE_REQUIRE_CHROME=1
// (CI) it fails instead. Screenshots of every step, light and dark, desktop and phone, go to shots-evidence/computers/<journey>/.
// Run in Team and in Personal (a Personal Space has the person's own key and no Shared folder).
//   1 Run this: the agent shows a command, the bar offers Run on the agent's computer, a read-only command runs and its output is shown under the block.
//   2 The computer in the pane: its live view, Take over in place, Give back, and the chat says "I took care of it. Carry on."
//   3 The live card: the agent starts working on its computer for the chat, the message holds the live view, and it freezes to the last picture when the computer sleeps.
import test from "node:test";
import assert from "node:assert/strict";
import { connectClaude, makeAgent, unlockVault, until } from "./support/mail-world.ts";
import { bootScreens, browserOrSkip, open, phonePass, seat, shoot } from "./support/mail-browser.ts";
import { standIn } from "./memory-live-kit.ts";
import { bindHost as bindComputers } from "../modules/computers/projections.ts";
import type { ComputerHost } from "../modules/computers/projections.ts";
import { fakeHost } from "../modules/computers/fixtures/fake-host.ts";
import { bindHost as bindTerminal } from "../modules/terminal/impl.ts";
import type { TerminalHost } from "../modules/terminal/projections.ts";
import type { OpenSession } from "../agent/src/turn-engine/index.ts";

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

const KEY = "sk-ant-api03-JOURNEYkeyVALUE9876543210zyxwvuts"; // secret-scan: fake

/** Team: the admin files the AI account in a Shared folder and the agent is pinned to it. Personal: the person's own key, and the agent answers on it as they ask. */
async function agentFor(w: Awaited<ReturnType<typeof bootScreens>>["world"], kind: "personal" | "team"): Promise<string> {
  if (kind === "team") return makeAgent(w.owner, "Desk", await connectClaude(w));
  await w.owner.ok("providers.add", { providerKey: "anthropic", connection: "api_key", apiKey: KEY, name: "My Claude", scope: "mine" });
  return (await w.owner.ok("agents.create", { name: "Desk", role: "You work at a computer." })).agent.agentId as string;
}

for (const kind of ["team", "personal"] as const) test(`computers journey, ${kind}: Run this on the agent's computer, the computer in the pane with Take over and Give back, and the live card`, async (t) => {
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
    // A Personal Space shows agent computers only once a capable server exists, and nothing about them before: no Computer tab at all. A Team Space always does.
    if (kind === "personal") {
      await showChat();
      if (await me.page.getByTestId("pane-agent").count() === 0) await me.page.getByTestId("pane-button").click();   // the chat header's own button; the pane starts closed
      await me.page.getByTestId("pane-agent").waitFor({ timeout: 20_000 });
      await me.page.waitForTimeout(1500);   // the Space has been asked where a computer can run; the answer is no
      assert.equal(await me.page.locator('[data-testid^="tab-computer"]').count(), 0, "no capable server, no Computer tab");
      assert.equal((await w.owner.ok("computers.hosts", {})).available, false);
      await shoot(me.page, dir, "no-computers");
    }
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

    // 2 the computer in the pane
    if (await me.page.getByTestId("pane-agent").count() === 0) await me.page.getByTestId("pane-button").click();
    await me.page.getByTestId("pane-agent").waitFor({ timeout: 20_000 });
    if (await me.page.getByTestId("tab-computer").count() > 0) await me.page.getByTestId("tab-computer").click();   // it is already the open tab when it is the first
    await me.page.getByTestId("computer-screen").waitFor({ timeout: 20_000 });
    await shoot(me.page, dir, "pane-working");
    await me.page.getByTestId("computer-take").click();
    await me.page.getByTestId("computer-give").waitFor({ timeout: 20_000 });
    await shoot(me.page, dir, "pane-in-control");
    await me.page.getByTestId("computer-give").click();
    await me.page.getByText("I took care of it. Carry on.").first().waitFor({ timeout: 30_000 });
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
