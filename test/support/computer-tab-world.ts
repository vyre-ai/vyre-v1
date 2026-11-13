// A team world for the agent's Computer tab walks: one agent, one chat, a workspace that runs with a person's terminal, and a Space browser that is open (stand-ins for Docker and browserd; the app, the chat,
// the terminal and browser capabilities and the daemon are real). Used by the computer-tab.*.walk.live walks.
import test from "node:test";
import http from "node:http";
import { bootScreens, browserOrSkip, open, seat } from "./mail-browser.ts";
import { guardCrashes } from "../../apps/app/tests/crash-guard.ts";
import { agentFor, fakeSpaceBrowser, scriptedTerminal } from "./computers-journey.ts";
import { bindHost as bindTerminal } from "../../modules/terminal/impl.ts";
import { bindWorkspaceStatus, bindWorkspaces } from "../../modules/terminal/projections.ts";
import { bindSpaceBrowser } from "../../modules/computers/sbrowser/port.ts";
import { bindHost as bindComputers } from "../../modules/computers/projections.ts";

/** A team world with one agent, one chat, a workspace that runs with one terminal of a person's, and a Space browser that is open. The chat's right pane is on its Computer tab. */
export async function world(t: test.TestContext) {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return null; }
  const s = await bootScreens({ kind: "team" }, env);
  const w = s.world;
  const { unlockVault } = await import("./mail-world.ts");
  await unlockVault(w);
  bindComputers(null);
  bindTerminal(scriptedTerminal());
  bindWorkspaces(true);
  bindWorkspaceStatus(async () => ({ state: "running" as const, host: "space" as const }));
  const browserd = fakeSpaceBrowser();
  let tickets = 0;
  // the live view's address answers with a picture, so the page can draw it (the real one is an MJPEG stream from browserd)
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  const picture = http.createServer((_q, r) => { r.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" }); r.end(PNG); });
  await new Promise<void>((done) => picture.listen(0, "127.0.0.1", done));
  const port = (picture.address() as { port: number }).port;
  // a ticket is one address for one viewer: every stream call hands out a new one, as the real service does
  browserd.sb.stream = async (a) => ({ transport: "mjpeg", url: `http://127.0.0.1:${port}/live/${a.profileId}?ticket=${++tickets}`, ws: `ws://127.0.0.1:${port}/ws?p=${a.profileId}&ticket=${tickets}` });
  bindSpaceBrowser(browserd.sb);
  const agentId = await agentFor(w, "team");
  browserd.rows.set(agentId, { profileId: agentId, running: true, tabs: 1, busy: false, takeover: false, viewers: 0, lastActiveAt: Date.now(), held: 0, paused: false });
  const threadId = (await w.owner.ok("chat.start", { kind: "chat", agentIds: [agentId], title: "Desk work" })).thread.threadId as string;
  // the person's own terminal in the agent's workspace: "Terminal 1, a person"
  await w.owner.ok("terminal.open", { host: "agent_computer", agentId, idempotencyKey: "walk-term-1" });
  const me = await seat(s, w.owner, "Owner");
  const guard = guardCrashes(me.page);
  const computerTab = async (): Promise<void> => {
    await open(me, s, "/chat");
    await me.page.getByTestId("chats-place").waitFor({ timeout: 20_000 });
    await me.page.getByText("Desk work", { exact: true }).first().click();
    await me.page.getByTestId("composer-field").waitFor({ timeout: 20_000 });
    if (await me.page.getByTestId("pane-agent").count() === 0) await me.page.getByTestId("pane-button").click();
    await me.page.getByTestId("pane-agent").waitFor({ timeout: 20_000 });
    await me.page.getByTestId("tab-computer").click();
  };
  const close = async (): Promise<void> => { picture.close(); bindSpaceBrowser(null); bindWorkspaceStatus(null); bindWorkspaces(false); bindTerminal(null); await s.close(); };
  return { s, w, me, guard, agentId, threadId, browserd, computerTab, close };
}

