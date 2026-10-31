// Settings > Computers: the list (this computer, servers by nickname, online dot, what runs there, Remove), the one command, and the steps of the Add a server sheet.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { AddServerSheet, ComputersBody, ComputersSection } from "./Computers.tsx";
import { SettingsDataProvider } from "./data.tsx";
import { emptySheet, factsLine, joinCommand, phaseOf, runsLine, validNickname } from "./computers-model.ts";
import type { HostInfo, ServerInfo } from "./computers-model.ts";
import { createSampleSettings, northwind } from "./sample.ts";

const here: HostInfo = { hostId: "this", kind: "this", name: "This computer", online: true, canRun: false, runs: 0, reason: "No Docker" };
const box: HostInfo = { hostId: "srv_home", kind: "server", name: "home-box", online: true, canRun: true, runs: 2 };
const server = (o: Partial<ServerInfo> = {}): ServerInfo => ({ serverId: "srv_home", name: "home-box", state: "healthy", enrollment: "approved", facts: { os: "linux", arch: "x64", docker: true, version: "1" }, ...o });
const noop = (): void => undefined;
const body = (hosts: HostInfo[], servers: ServerInfo[], removing: string | null = null): string =>
  renderToStaticMarkup(<ComputersBody hosts={hosts} servers={servers} removing={removing} onAdd={noop} onAskRemove={noop} onRemove={noop} />).replaceAll("<!-- -->", "");

test("the command carries the address and the code, and a server's facts read as one short line", () => {
  assert.equal(joinCommand("https://home.example", "VYRE-AB12-CD34"), "vyred --role compute --server https://home.example --join VYRE-AB12-CD34");
  assert.equal(factsLine({ os: "linux", arch: "x64", docker: true, version: "1" }), "Linux x64, Docker");
  assert.equal(factsLine({ os: "darwin", arch: "arm64", docker: false, version: "1" }), "Mac arm64");
  assert.equal(factsLine(undefined), "");
  assert.equal(runsLine({ runs: 2, canRun: true }), "2 agent computers");
  assert.equal(runsLine({ runs: 1, canRun: true }), "1 agent computer");
  assert.equal(runsLine({ runs: 0, canRun: false, reason: "No Docker" }), "No Docker");
  assert.equal(runsLine({ runs: 0, canRun: true }), "");
  assert.deepEqual(["home-box", "x", "My Mac 2", "", " ", "-no", "a".repeat(41)].map(validNickname), [true, true, true, false, false, false, false]);
});

test("the list shows this computer first, each approved server by its nickname with an online dot and what runs there, and Add a server last", () => {
  const out = body([here, box], [server(), server({ serverId: "srv_off", name: "old-mac", state: "down", facts: { os: "darwin", arch: "arm64", docker: false, version: "1" } }), server({ serverId: "srv_wait", name: "new", enrollment: "pending" })]);
  const at = (t: string): number => { const i = out.indexOf(t); assert.ok(i >= 0, t); return i; };
  assert.ok(at("This computer") < at("home-box") && at("home-box") < at("old-mac") && at("old-mac") < at("Add a server"));
  assert.ok(out.includes("Linux x64, Docker · 2 agent computers"), "what runs on it");
  assert.equal((out.match(/data-testid="dot-on"/g) ?? []).length, 2, "this computer and home-box are online");
  assert.equal((out.match(/data-testid="dot-off"/g) ?? []).length, 1, "old-mac is not");
  assert.ok(!out.includes(">new<"), "a server still waiting for approval is in the sheet, not the list");
  assert.ok(out.includes('data-testid="remove-srv_home"'));
  assert.ok(!out.includes("Needs a Team Space"));
});

test("asking to remove a server turns its button into Cancel and Remove", () => {
  const out = body([here, box], [server()], "srv_home");
  assert.ok(out.includes('data-testid="remove-yes-srv_home"') && !out.includes('data-testid="remove-srv_home"'));
});

test("the sheet goes from naming, to a command and waiting, to comparing the fingerprint, to done", () => {
  const made = { ...emptySheet(), nickname: "home-box", code: "VYRE-AB12-CD34", expiresAt: 10 * 60_000, address: "https://home.example" };
  assert.equal(phaseOf(emptySheet(), []).phase, "name");
  assert.equal(phaseOf(made, []).phase, "waiting");
  assert.equal(phaseOf(made, [server({ name: "other", enrollment: "pending" })]).phase, "waiting", "a server under another name is not this one");
  const waiting = server({ enrollment: "pending", state: "down", fingerprint: "K7QD-4M2X" });
  assert.deepEqual([phaseOf(made, [waiting]).phase, phaseOf(made, [waiting]).arrived?.serverId], ["compare", "srv_home"]);
  assert.equal(phaseOf({ ...made, approved: true, serverId: "srv_home" }, [server()]).phase, "done");

  const render = (sheet = made, servers: ServerInfo[] = [], error = ""): string =>
    renderToStaticMarkup(<AddServerSheet sheet={sheet} servers={servers} busy={false} error={error} now={0} onNickname={noop} onMake={noop} onApprove={noop} onDecline={noop} onCopy={noop} onClose={noop} />).replaceAll("<!-- -->", "");
  const name = render(emptySheet());
  assert.ok(name.includes('data-testid="add-nickname"') && name.includes('data-testid="add-make"') && !name.includes("add-command"));
  const wait = render();
  assert.ok(wait.includes("vyred --role compute --server https://home.example --join VYRE-AB12-CD34") && wait.includes('data-testid="add-copy"') && wait.includes('data-testid="add-waiting"') && wait.includes("10 min"));
  const compare = render(made, [waiting]);
  assert.ok(compare.includes("K7QD-4M2X") && compare.includes("Linux x64, Docker") && compare.includes('data-testid="add-approve"') && compare.includes('data-testid="add-decline"'));
  const done = render({ ...made, approved: true, serverId: "srv_home" }, [server()]);
  assert.ok(done.includes('data-testid="add-added"') && done.includes("home-box") && done.includes('data-testid="add-done"'));
  assert.ok(render(made, [], "Couldn't approve it. Try again.").includes('data-testid="add-error"'));
});

test("the section reads the hosts and your servers through the capabilities", async () => {
  const s = createSampleSettings(northwind);
  const asked: string[] = [];
  const data = { ...s.data, call: async (cap: string): Promise<unknown> => { asked.push(cap); return cap === "computers.hosts" ? { available: true, hosts: [here] } : { computers: [] }; } };
  const out = renderToStaticMarkup(<SettingsDataProvider value={data}><ComputersSection /></SettingsDataProvider>);
  assert.ok(out.includes("This computer") && out.includes("Add a server"));
  assert.equal(out.includes("Needs a Team Space"), false);
});
