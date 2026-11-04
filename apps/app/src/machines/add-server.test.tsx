// Add a server, the one flow (Console, Machines and Settings, This device): the one command, the steps of the sheet, and which capabilities each scope calls.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { AddServerSheet, addCalls } from "./AddServer.tsx";
import { addressKind, emptySheet, factsLine, joinCommand, peerServerCommand, phaseOf, runsLine, validNickname } from "../places/settings/computers-model.ts";
import type { ServerInfo } from "../places/settings/computers-model.ts";

const server = (o: Partial<ServerInfo> = {}): ServerInfo => ({ serverId: "srv_home", name: "home-box", state: "healthy", enrollment: "approved", facts: { os: "linux", arch: "x64", docker: true, version: "1" }, ...o });
const noop = (): void => undefined;

test("the command carries the address and the code, and a server's facts read as one short line", () => {
  const cmd = joinCommand("https://home.example", "VYRE-AB12-CD34");
  assert.ok(cmd.startsWith("VYRE_JOIN=VYRE-AB12-CD34 sh -c '") && cmd.includes("--role compute --server https://home.example"), cmd);
  assert.ok(cmd.includes("install-mac.sh") && cmd.includes("releases/latest/download") && cmd.includes('env VYRE_JOIN="$VYRE_JOIN"'), "the Mac or Linux installer, the code through the environment");
  assert.ok(!/--join/.test(cmd), "the code is not an argument");
  assert.deepEqual(["", null, "http://localhost:8420", "http://127.0.0.1:8420", "https://192.168.1.20:8420", "http://10.0.0.5:8420", "http://mac.local:8420", "https://home.vyre.run", "home.example.com"].map((a) => addressKind(a)), ["none", "none", "loopback", "loopback", "lan", "lan", "lan", "public", "public"]);
  assert.equal(factsLine({ os: "linux", arch: "x64", docker: true, version: "1" }), "Linux x64, Docker");
  assert.equal(factsLine({ os: "darwin", arch: "arm64", docker: false, version: "1" }), "Mac arm64");
  assert.equal(factsLine(undefined), "");
  assert.equal(runsLine({ runs: 2, canRun: true }), "2 agent computers");
  assert.equal(runsLine({ runs: 1, canRun: true }), "1 agent computer");
  assert.equal(runsLine({ runs: 0, canRun: false, reason: "No Docker" }), "No Docker");
  assert.equal(runsLine({ runs: 0, canRun: true }), "");
  assert.deepEqual(["home-box", "x", "My Mac 2", "", " ", "-no", "a".repeat(41)].map(validNickname), [true, true, true, false, false, false, false]);
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
  assert.ok(wait.includes("VYRE_JOIN=VYRE-AB12-CD34") && wait.includes("--role compute --server https://home.example") && wait.includes('data-testid="add-copy"') && wait.includes('data-testid="add-waiting"') && wait.includes("10 min"));
  assert.ok(!wait.includes('data-testid="add-lan-warning"') && !wait.includes('data-testid="add-no-address"'), "a public address needs no warning");
  const lan = render({ ...made, address: "http://192.168.1.20:8420" });
  assert.ok(lan.includes("--server http://192.168.1.20:8420") && lan.includes('data-testid="add-lan-warning"') && lan.includes('data-testid="add-copy"'), "the local network address, with its warning");
  for (const address of ["http://127.0.0.1:8420", null]) {
    const none = render({ ...made, address });
    assert.ok(none.includes('data-testid="add-no-address"') && none.includes("Needs an address") && none.includes("Phone access"), `no address another machine can reach: ${address}`);
    assert.ok(!none.includes('data-testid="add-copy"') && !none.includes("--role compute"), "no command to paste");
  }
  const compare = render(made, [waiting]);
  assert.ok(compare.includes("K7QD-4M2X") && compare.includes("Linux x64, Docker") && compare.includes('data-testid="add-approve"') && compare.includes('data-testid="add-decline"'));
  const done = render({ ...made, approved: true, serverId: "srv_home" }, [server()]);
  assert.ok(done.includes('data-testid="add-added"') && done.includes("home-box") && done.includes('data-testid="add-done"'));
  assert.ok(render(made, [], "Couldn't approve it. Try again.").includes('data-testid="add-error"'));
});

test("a Personal Space adds a server with no address: the line carries the one-time code, and the server is in once it is one of the Space's computers", () => {
  const cmd = peerServerCommand("VYRE-PS-abc123");
  assert.ok(cmd.startsWith("VYRE_PEER_JOIN=VYRE-PS-abc123 sh -c '") && cmd.includes('env VYRE_PEER_JOIN="$VYRE_PEER_JOIN"'), cmd);
  assert.ok(!/--server|--role/.test(cmd), "no address and no compute role: the server joins through the relay and holds the whole Space");
  const sheet = { ...emptySheet(), nickname: "home-server", code: "VYRE-PS-abc123", expiresAt: 30 * 60_000, peer: true };
  const waiting = renderToStaticMarkup(<AddServerSheet sheet={sheet} servers={[]} busy={false} error="" now={0} onNickname={() => undefined} onMake={() => undefined} onApprove={() => undefined} onDecline={() => undefined} onCopy={() => undefined} onClose={() => undefined} />);
  assert.ok(waiting.includes("VYRE_PEER_JOIN=VYRE-PS-abc123"), "the line is shown");
  assert.ok(!waiting.includes("Needs an address"), "a Personal Space needs no address for its server");
  assert.equal(phaseOf(sheet, []).phase, "waiting");
  const joined: ServerInfo = { serverId: "peer_srv", name: "home-server", state: "healthy", enrollment: "approved" };
  assert.equal(phaseOf(sheet, [joined]).phase, "done", "no fingerprint to compare: the code was the yes");
});

test("one flow, two scopes: an admin adds a server the Space holds, a person adds one only they use, and a Personal Space joins through the relay", () => {
  assert.deepEqual(addCalls("space", false), { code: "network.server_join_code", approve: "network.server_approve", decline: "network.server_decline" });
  assert.deepEqual(addCalls("mine", false), { code: "network.my_computer_code", approve: "network.my_computer_approve", decline: "network.my_computer_decline" });
  assert.equal(addCalls("mine", true).code, "network.peer_server_code");
  assert.equal(addCalls("space", true).code, "network.server_join_code", "the Console of a Team Space is never a Personal Space");
});
