// The agent-computer proof for the rc.22 cut (lane l-machines): a Team server installed from compose.server.yml (project vyre-cut), then, in the real app as the Space's owner, create two agents, press "Set up its computer",
// watch it reach Ready, look at its desktop, run one command in its Terminal, and check from inside the computers that each sits on its own network with no route to vyred or to the other. VYRE_CUT_URL, VYRE_CUT_CLAIM and
// VYRE_APP_DIST name the running server, its one-time claim link and the app export; without them it skips. Pass lines start with PASS; shots go to VYRE_CUT_SHOTS.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { claimOnEdge, edge, dismissOnboarding } from "../apps/app/tests/real-app-harness.test.ts";
import { guardCrashes } from "../apps/app/tests/crash-guard.ts";

const sh = (c: string): string => { try { return execSync(c, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); } catch (e) { return String((e as { stdout?: string; stderr?: string }).stdout ?? "") + String((e as { stderr?: string }).stderr ?? ""); } };
const pass = (s: string): void => { console.log(`PASS ${s}`); };

test("agent computers on a real Team server: Set up, Ready, desktop, Terminal, own network", { timeout: 900_000 }, async (t) => {
  const url = process.env["VYRE_CUT_URL"], claim = process.env["VYRE_CUT_CLAIM"], dist = process.env["VYRE_APP_DIST"];
  if (process.env["VYRE_HEAVY_DOCKER"] !== "1") { t.skip("VYRE_HEAVY_DOCKER=1 is required (this test starts real agent computers on a server running from compose.server.yml)"); return; }
  assert.ok(url && claim && dist, "VYRE_CUT_URL, VYRE_CUT_CLAIM and VYRE_APP_DIST must name the running server, its claim link and the app export (scripts/release/cut-agent-computer-proof.sh sets them up)");
  const shots = process.env["VYRE_CUT_SHOTS"] ?? "/tmp/vyre-cut-shots"; fs.mkdirSync(shots, { recursive: true });
  const web = await edge(dist, url);
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const guard = guardCrashes(page);
  const shot = async (name: string): Promise<void> => { await guard.check(name); await page.screenshot({ path: path.join(shots, `${name}.png`) }); };
  try {
    await page.goto(claimOnEdge(claim, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Cut Owner"); await page.getByTestId("claim-username").fill("cutowner");
    await page.getByTestId("claim-password").fill("fixture password 123"); await page.getByTestId("claim-confirm").fill("fixture password 123");
    await page.getByTestId("claim-next").click(); await page.getByTestId("claim-saved").click(); await page.getByTestId("claim-create").click(); await dismissOnboarding(page);
    await page.getByTestId("shell").waitFor({ timeout: 60_000 });
    await guard.check("signed in");
    pass("the Space was claimed through the app on the compose-installed server");
    const token = await page.evaluate(() => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string);
    const api = async (cap: string, data: unknown): Promise<any> => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await context.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${token}` }, data });
      const body = await r.json().catch(() => ({})); assert.ok(r.status() === 200 || r.status() === 201, `${cap}: ${r.status()} ${JSON.stringify(body).slice(0, 400)}`); return body.data ?? body;
    };
    const hosts = await api("computers.hosts", {});
    assert.equal(hosts.available, true, `the runner can start computers: ${JSON.stringify(hosts).slice(0, 300)}`);
    pass("computers.hosts: a host can run agent computers (the runner reaches Docker)");
    const made: Array<{ agentId: string; name: string; thread: string; computerId: string }> = [];
    for (const name of ["Cutone", "Cuttwo"]) {
      const agent = (await api("agents.create", { name, role: "You help.", idempotencyKey: `cut-agent-${name}` })).agent as { agentId: string };
      const thread = (await api("chat.start", { kind: "chat", agentIds: [agent.agentId], title: `${name} chat`, idempotencyKey: `cut-chat-${name}` })).thread.threadId as string;
      made.push({ agentId: agent.agentId, name, thread, computerId: "" });
    }
    // the first agent through the real panel: open the pane's Computer tab and press Set up its computer
    const first = made[0]!;
    await page.goto(`${web.origin}/chat#subject=thread:${first.thread}`, { waitUntil: "load" });
    await page.getByTestId("composer-field").first().waitFor({ timeout: 60_000 });
    if (await page.getByTestId("pane-agent").count() === 0) await page.getByTestId("pane-button").click();
    await page.getByTestId("pane-agent").waitFor({ timeout: 30_000 });
    const tabIds = async (pg: typeof page): Promise<string> => (await pg.locator('[data-testid^="tab-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")))).join(" ");
    // an agent without a computer has no Computer tab: About offers "Give <name> a computer", which opens the Computer tab on its Set up panel
    await page.getByTestId("about-give").waitFor({ timeout: 60_000 }).catch(async (e) => { await shot("1b-no-give-offer"); console.log("TABS", await tabIds(page)); throw e; });
    await page.getByTestId("about-give").click();
    await page.getByTestId("computer-provision").waitFor({ timeout: 60_000 }).catch(async (e) => { await shot("1c-no-provision"); console.log("BODY", (await page.getByTestId("chats-right-pane").innerText().catch(() => "")).slice(0, 600)); throw e; });
    await shot("1-set-up-its-computer");
    pass("the Computer tab offers Set up its computer for an agent without one");
    await page.getByTestId("computer-provision").click();
    await page.getByTestId("computer-setting-up").waitFor({ timeout: 30_000 }).catch(() => undefined);
    await shot("2-setting-up");
    // Ready: the computer's screen is on the panel
    const readyOrWhy = async (): Promise<string> => { for (let i = 0; i < 100; i++) { const l = (await api("computers.list", {})) as { computers: Array<Record<string, unknown>> }; const c = l.computers.find((x) => x["agentId"] === first.agentId); if (c && (c["state"] === "ready" || c["state"] === "failed")) return JSON.stringify(c).slice(0, 700); await page.waitForTimeout(3000); } return "timeout: " + JSON.stringify(((await api("computers.list", {})) as { computers: unknown[] }).computers).slice(0, 700); };
    await page.getByTestId("computer-screen").waitFor({ timeout: 240_000 }).catch(async (e) => { await shot("2b-not-ready"); console.log("COMPUTER", await readyOrWhy()); console.log("CONTAINERS", sh("docker ps -a --filter label=vyre.computer --format '{{.Names}} {{.Status}}'").split("\n").slice(0, 4).join(" | ")); throw e; });
    await page.waitForTimeout(4000);
    await shot("3-ready-desktop");
    pass("Set up its computer reached Ready: the computer's screen is on the panel");
    const comps = (await api("computers.list", {})) as { computers: Array<{ computerId: string; agentId: string; state: string }> };
    for (const m of made.slice(0, 1)) m.computerId = comps.computers.find((c) => c.agentId === m.agentId)!.computerId;
    assert.ok(made[0]!.computerId, "the computer exists");
    // the second agent's computer by the API (the same provision the button calls), to check the two apart
    const two = made[1]!;
    two.computerId = (await api("computers.provision", { agentId: two.agentId, idempotencyKey: "cut-two" })).computer.computerId as string;
    await api("computers.wake", { computerId: two.computerId });
    const names = (): string[] => sh(`docker ps --filter label=vyre.computer --format '{{.Names}}'`).split("\n").filter((n) => /^vyre-comp-/.test(n));
    for (let i = 0; i < 90 && names().filter((n) => n.includes(two.computerId.replace(/^cmp_/, "").slice(0, 8)) || true).length < 2; i++) await page.waitForTimeout(2000);
    const mine = names().filter((n) => sh(`docker inspect -f '{{index .Config.Labels "vyre.computer"}}' ${n}`) === made[0]!.computerId || sh(`docker inspect -f '{{index .Config.Labels "vyre.computer"}}' ${n}`) === two.computerId);
    assert.equal(mine.length, 2, `both computers run: ${mine.join(",")}`);
    pass(`both agent computers are running: ${mine.join(", ")}`);
    // the desktop: wallpaper and a dock of Chrome, Terminal and Files
    const procs = sh(`docker exec ${mine[0]} ps -eo comm`);
    for (const p of ["Xvfb", "openbox", "tint2", "feh"]) assert.ok(procs.includes(p), `the desktop runs ${p}: ${procs.replace(/\n/g, " ").slice(0, 300)}`);
    const dock = sh(`docker exec ${mine[0]} sh -c 'cat ~/.config/tint2/tint2rc /home/agent/.config/tint2/tint2rc 2>/dev/null | grep -i launcher_item_app'`);
    pass(`the desktop runs Xvfb, openbox, tint2 (the dock) and feh (the wallpaper); dock launchers: ${dock.replace(/\n/g, " | ")}`);
    // Terminal: one command in the agent computer's own Terminal
    const term = (await api("terminal.open", { host: "agent_computer", agentId: first.agentId, computerId: made[0]!.computerId, idempotencyKey: "cut-term" })).terminal as { terminalId: string };
    const ran = await api("terminal.run", { terminalId: term.terminalId, command: "echo cut-proof-$(hostname)-$(id -un)", idempotencyKey: "cut-run" });
    assert.equal(ran.exitCode, 0, JSON.stringify(ran).slice(0, 300));
    assert.match(ran.output, /cut-proof-/);
    pass(`a command ran in the agent computer's Terminal: ${String(ran.output).trim().slice(0, 120)}`);
    // each computer on its own network, no route to vyred or to the other
    const nets = (n: string): string[] => sh(`docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{$v.IPAddress}};{{end}}' ${n}`).split(";").filter(Boolean);
    const [n0, n1] = [nets(mine[0]!), nets(mine[1]!)];
    assert.equal(n0.length, 1, `computer one is on exactly one network: ${n0.join("|")}`); assert.equal(n1.length, 1, `computer two is on exactly one network: ${n1.join("|")}`);
    assert.notEqual(n0[0]!.split(" ")[0], n1[0]!.split(" ")[0], "the two computers are on different networks");
    assert.ok(!/vyre-cut_default/.test(n0[0]!) && !/vyre-cut_default/.test(n1[0]!), "neither computer is on vyred's network");
    pass(`each computer is on a network of its own: ${n0[0]} and ${n1[0]}`);
    const vyredIp = sh(`docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' vyre-cut-vyred-1`);
    const probe = (from: string, host: string, port: number): string => sh(`docker exec ${from} node -e "const s=require('net').connect({host:'${host}',port:${port},timeout:4000});s.on('connect',()=>{console.log('CONNECTED');process.exit(0)});s.on('timeout',()=>{console.log('TIMEOUT');process.exit(0)});s.on('error',e=>{console.log('ERR '+e.code);process.exit(0)})"`);
    const toVyred = probe(mine[0]!, vyredIp, 8420), toOther = probe(mine[0]!, n1[0]!.split(" ")[1]!, 22);
    assert.ok(!/CONNECTED|ECONNREFUSED/.test(toVyred), `no route to vyred's port 8420 (${vyredIp}): ${toVyred}`);
    assert.ok(!/CONNECTED|ECONNREFUSED/.test(toOther), `no route to the other agent computer: ${toOther}`);
    pass(`from computer one: vyred ${vyredIp}:8420 -> ${toVyred}; computer two ${n1[0]!.split(" ")[1]}:22 -> ${toOther} (a refused connection would mean a route, so only a timeout or no route passes)`);
    // the everyday case: a member (not the owner) with an agent of their own presses Set up its computer; the server's permission path differs
    const roles = (await api("access.roles.list", {})).roles as Array<{ id: string; name: string }>;
    const invited = await api("members.invites.create", { role: roles.find((r) => r.name === "Member")!.id, idempotencyKey: "cut-member-invite" }) as { link: string };
    const joinUrl = new URL(invited.link);
    const mctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const mp = await mctx.newPage();
    const mguard = guardCrashes(mp);
    const mshot = async (name: string): Promise<void> => { await mguard.check(name); await mp.screenshot({ path: path.join(shots, `${name}.png`) }); };
    await mp.goto(web.origin + joinUrl.pathname + joinUrl.hash, { waitUntil: "load" });
    await mp.getByTestId("step-accept").waitFor({ timeout: 30_000 });
    await mp.getByTestId("web").click(); await mp.getByTestId("first").fill("Cut"); await mp.getByTestId("last").fill("Member"); await mp.getByTestId("next").click();
    await mp.getByTestId("username").fill("cutmember"); await mp.getByTestId("password").fill("fixture member password123"); await mp.getByTestId("confirm").fill("fixture member password123"); await mp.getByTestId("next").click();
    await mp.getByTestId("device").fill("Cut browser"); await mp.getByTestId("next").click(); await mp.getByTestId("ai-none").click(); await mp.getByTestId("next").click();
    await mp.getByTestId("shell").waitFor({ timeout: 60_000 }); await dismissOnboarding(mp);
    await mguard.check("the member is in");
    pass("a member joined the Team Space through an invite");
    const mtoken = await mp.evaluate(() => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string);
    const mapi = async (cap: string, data: unknown): Promise<any> => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await mctx.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${mtoken}` }, data });
      const body = await r.json().catch(() => ({})); assert.ok(r.status() === 200 || r.status() === 201, `member ${cap}: ${r.status()} ${JSON.stringify(body).slice(0, 400)}`); return body.data ?? body;
    };
    const mine2 = (await mapi("agents.create", { name: "Memberbot", role: "You help.", idempotencyKey: "cut-member-agent" })).agent as { agentId: string };
    const mthread = (await mapi("chat.start", { kind: "chat", agentIds: [mine2.agentId], title: "Memberbot chat", idempotencyKey: "cut-member-chat" })).thread.threadId as string;
    await mp.goto(`${web.origin}/chat#subject=thread:${mthread}`, { waitUntil: "load" });
    await mp.getByTestId("composer-field").first().waitFor({ timeout: 60_000 });
    if (await mp.getByTestId("pane-agent").count() === 0) await mp.getByTestId("pane-button").click();
    await mp.getByTestId("pane-agent").waitFor({ timeout: 30_000 });
    await mp.getByTestId("about-give").waitFor({ timeout: 60_000 }).catch(async (e) => { await mshot("5a-member-no-give-offer"); throw e; });
    await mp.getByTestId("about-give").click();
    await mp.waitForTimeout(3000);
    await mshot("5-member-computer-tab");
    const memberButton = await mp.getByTestId("computer-provision").count();
    const memberNote = await mp.getByTestId("computer-provision-admin").count();
    console.log(`MEMBER sees: Set up button=${memberButton}, owner-or-admin note=${memberNote}`);
    assert.equal(memberButton, 1, "a member sees Set up its computer for an agent of their own");
    await mp.getByTestId("computer-provision").click();
    await mp.getByTestId("computer-screen").waitFor({ timeout: 360_000 }).catch(async (e) => { await mshot("5b-member-not-ready"); throw e; });
    await mp.waitForTimeout(4000);
    await mshot("6-member-ready-desktop");
    pass("a member pressed Set up its computer for their own agent and it reached Ready");
    await mctx.close();
    await shot("4-done");
    assert.deepEqual(guard.crashes(), []);
  } finally { await browser.close(); web.close(); }
});
