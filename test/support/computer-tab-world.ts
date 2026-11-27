// A team world for the agent's Computer tab walks: one agent, one chat, a workspace that runs with a person's terminal, and a Space browser that is open (stand-ins for Docker and browserd; the app, the chat,
// the terminal and browser capabilities and the daemon are real). Used by the computer-tab.*.walk.live walks.
import test from "node:test";
import http from "node:http";
import { bootScreens, browserOrSkip, open, seat } from "./mail-browser.ts";
import { guardCrashes } from "../../apps/app/tests/crash-guard.ts";
import { agentFor, fakeSpaceBrowser, modelWithCommand, scriptedTerminal } from "./computers-journey.ts";
import { bindHost as bindTerminal } from "../../modules/terminal/impl.ts";
import { bindWorkspaceStatus, bindWorkspaces } from "../../modules/terminal/projections.ts";
import { bindSpaceBrowser } from "../../modules/computers/sbrowser/port.ts";
import { createDockerSpaceBrowser } from "../../modules/computers/sbrowser/docker.ts";
import { createDockerApi, unixSocketHttp } from "../../sandbox/src/docker.ts";
import { bindHost as bindComputers } from "../../modules/computers/projections.ts";
import { acceptPeer } from "../../host/src/ws.ts";
import type { Peer } from "../../host/src/ws.ts";
import { realTmuxHost, stopRealTmux } from "./real-tmux.ts";

/** A team world with one agent, one chat, a workspace that runs with one terminal of a person's, and a Space browser that is open. The chat's right pane is on its Computer tab. */
/** `noTerminal`: nothing is opened for the person (the pane must open the agent's terminal by itself). `realBrowser`: an image name; the Space browser is then the real one in Docker (the profile of the agent is started with a page open) instead of the stand-in. */
export async function world(
  t: test.TestContext,
  o: { realBrowser?: string; noTerminal?: boolean; tmux?: boolean; realWorkspace?: boolean; model?: boolean } = {},
) {
  const env = await browserOrSkip();
  if (typeof env === "string") {
    t.skip(env);
    return null;
  }
  // the image is read when the daemon starts
  const savedImage = process.env["VYRE_WORKSPACE_IMAGE"];
  if (o.realWorkspace === true) process.env["VYRE_WORKSPACE_IMAGE"] = process.env["VYRE_WORKSPACE_TEST_IMAGE"];
  const s = await bootScreens(
    { kind: "team", ...(o.model === true ? { engineOpenSession: modelWithCommand } : {}) },
    env,
  );
  const w = s.world;
  const { unlockVault } = await import("./mail-world.ts");
  await unlockVault(w);
  bindComputers(null);
  // `realWorkspace`: the daemon's own terminal host runs the agent's computer as a real container (VYRE_WORKSPACE_TEST_IMAGE); nothing is bound over it, so the folders, users and rows are the product's own
  if (o.realWorkspace !== true) {
    bindTerminal(o.tmux === true ? realTmuxHost() : scriptedTerminal());
    bindWorkspaces(true);
    bindWorkspaceStatus(async () => ({ state: "running" as const, host: "space" as const }));
  }
  const browserd = fakeSpaceBrowser();
  let tickets = 0;
  // the live view's address answers with a picture, so the page can draw it (the real one is an MJPEG stream from browserd)
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  );
  const picture = http.createServer((_q, r) => {
    r.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
    r.end(PNG);
  });
  // the live view's frames come on a WebSocket since rc.44 (watchers as well as the person in control): the stand-in sends the picture a few times a second and answers the view's pings, and `outage` cuts every
  // socket and refuses new ones and new addresses for a while, the way a daemon that is killed and started again does
  // a real JPEG (the view decodes what comes on the socket as a JPEG frame, as browserd sends them)
  const JPEG = Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAKABADASIAAhEBAxEB/8QAFwAAAwEAAAAAAAAAAAAAAAAAAAUGB//EACMQAAADBwUBAAAAAAAAAAAAAAAVMgEEBhESEyEWIjE1UjP/xAAVAQEBAAAAAAAAAAAAAAAAAAADBP/EACARAAEDAgcAAAAAAAAAAAAAAAECAxEAEgQTIUFhkbH/2gAMAwEAAhEDEQA/ANQijXR68kPW7bXw8sqVlU+RVQuZkTsfdluup9NpThMuA1ALncVmNJasSIjUCCYG595oEtWqKpJnqv/Z",
    "base64",
  );
  const peers = new Set<Peer>();
  let downUntil = 0;
  const sockets = new Set<import("node:net").Socket>();
  const opened: string[] = [];
  picture.on("connection", (c) => {
    sockets.add(c);
    c.on("close", () => sockets.delete(c));
  });
  picture.on("upgrade", (req, socket, head) => {
    if (Date.now() < downUntil) {
      socket.destroy();
      return;
    }
    const peer = acceptPeer(req, socket, head, 1 << 20);
    if (!peer) return;
    opened.push(String(req.url));
    peers.add(peer);
    peer.onClose(() => peers.delete(peer));
    peer.onMessage((data) => {
      try {
        const m = JSON.parse(data.toString("utf8")) as { t?: string; seq?: number };
        if (m.t === "ping") peer.send(JSON.stringify({ t: "pong", seq: m.seq ?? 0 }));
      } catch {
        /* not JSON */
      }
    });
    const tick = setInterval(() => {
      if (!peer.open) clearInterval(tick);
      else peer.send(JPEG);
    }, 150);
    tick.unref();
  });
  const outage = (ms: number): void => {
    downUntil = Date.now() + ms;
    for (const c of sockets) c.destroy();
    peers.clear();
  };
  await new Promise<void>((done) => picture.listen(0, "127.0.0.1", done));
  const port = (picture.address() as { port: number }).port;
  // a ticket is one address for one viewer: every stream call hands out a new one, as the real service does
  browserd.sb.stream = async (a) => {
    if (Date.now() < downUntil) throw new Error("The Space browser did not answer in time.");
    return {
      transport: "mjpeg",
      url: `http://127.0.0.1:${port}/live/${a.profileId}?ticket=${++tickets}`,
      ws: `ws://127.0.0.1:${port}/ws?p=${a.profileId}&ticket=${tickets}`,
    };
  };
  const dockerName = `vyre-sbrowser-cw${process.pid}${Math.random().toString(36).slice(2, 6)}`;
  const dockerHttp = unixSocketHttp();
  const dockerApi = createDockerApi(dockerHttp);
  const real = o.realBrowser
    ? createDockerSpaceBrowser({
        api: dockerApi,
        http: dockerHttp,
        name: dockerName,
        image: o.realBrowser,
        user: { uid: 10001, gid: 10001 },
        startTimeoutMs: 90_000,
      })
    : null;
  bindSpaceBrowser(real ?? browserd.sb);
  const agentId = await agentFor(w, "team");
  if (real) {
    await real.tool({ profileId: agentId, tool: "chrome_open", args: { url: "about:blank" }, timeoutMs: 60_000 });
    // a page that changes all the time, so the live view has a new frame every few milliseconds
    await real.tool({
      profileId: agentId,
      tool: "chrome_eval",
      args: {
        expression:
          "document.body.style.margin = '0'; document.body.style.height = '5000px'; const i = document.createElement('input'); i.id = 't'; i.style.cssText = 'position:fixed;left:100px;top:100px;width:300px;height:40px;font:20px monospace'; document.body.appendChild(i); const c = document.createElement('div'); c.id = 'c'; c.style.cssText = 'position:fixed;left:100px;top:200px;font:72px monospace'; document.body.appendChild(c); setInterval(() => { c.textContent = String(Date.now()); }, 40); 1",
      },
      timeoutMs: 30_000,
    });
  } else
    browserd.rows.set(agentId, {
      profileId: agentId,
      running: true,
      tabs: 1,
      busy: false,
      takeover: false,
      viewers: 0,
      lastActiveAt: Date.now(),
      held: 0,
      paused: false,
    });
  const threadId = (await w.owner.ok("chat.start", { kind: "chat", agentIds: [agentId], title: "Desk work" })).thread
    .threadId as string;
  // the person's own terminal in the agent's workspace: "Terminal 1, a person"
  if (o.noTerminal !== true)
    await w.owner.ok("terminal.open", { host: "agent_computer", agentId, idempotencyKey: "walk-term-1" });
  const me = await seat(s, w.owner, "Owner");
  const guard = guardCrashes(me.page);
  const computerTabOf = async (who: typeof me): Promise<void> => {
    await open(who, s, "/chat");
    await who.page.getByTestId("chats-place").waitFor({ timeout: 20_000 });
    await who.page.getByText("Desk work", { exact: true }).first().click();
    await who.page.getByTestId("composer-field").waitFor({ timeout: 20_000 });
    // the chat frame of 15 Nov: the chat's right pane has no agent header and may already be on its Computer tab
    if ((await who.page.getByTestId("chats-right-pane").count()) === 0)
      await who.page.getByTestId("pane-button").click();
    await who.page.getByTestId("chats-right-pane").waitFor({ timeout: 20_000 });
    await who.page.getByTestId("tab-computer").or(who.page.getByTestId("tab-computer-selected")).first().click();
  };
  const computerTab = (): Promise<void> => computerTabOf(me);
  /** The same person on a second device (another browser window), on the Computer tab: two watchers of one browser. */
  const watcher = async (): Promise<typeof me> => {
    const other = await seat(s, w.owner, "Owner");
    await computerTabOf(other);
    return other;
  };
  const close = async (): Promise<void> => {
    if (o.realWorkspace === true) {
      const { execFile } = await import("node:child_process");
      await new Promise<void>((done) =>
        execFile(
          "sh",
          [
            "-c",
            `docker rm -f vyre-ws-${agentId} >/dev/null 2>&1; docker volume rm -f vyre-ws-${agentId}-home vyre-ws-${agentId}-files vyre-ws-${agentId}-people >/dev/null 2>&1; true`,
          ],
          () => done(),
        ),
      );
    }
    if (real) {
      await dockerApi.containerStop(dockerName, 5).catch(() => undefined);
      await dockerApi.containerRemove(dockerName).catch(() => undefined);
      await dockerHttp({ method: "DELETE", path: `/volumes/${dockerName}-data`, query: { force: "true" } }).catch(
        () => undefined,
      );
      await dockerHttp({ method: "DELETE", path: `/networks/${dockerName}net` }).catch(() => undefined);
    }
    picture.close();
    bindSpaceBrowser(null);
    if (o.realWorkspace === true) {
      if (savedImage === undefined) delete process.env["VYRE_WORKSPACE_IMAGE"];
      else process.env["VYRE_WORKSPACE_IMAGE"] = savedImage;
    } else {
      bindWorkspaceStatus(null);
      bindWorkspaces(false);
      bindTerminal(null);
    }
    if (o.tmux === true) await stopRealTmux();
    await s.close();
  };
  return {
    s,
    w,
    me,
    guard,
    agentId,
    threadId,
    browserd,
    real,
    dockerName,
    computerTab,
    watcher,
    close,
    outage,
    socketsOpened: opened,
  };
}
