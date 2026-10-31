// The host picker (rc.8): every computer the person has, nothing for what does not exist, offline ones greyed with the reason.
import test from "node:test";
import assert from "node:assert/strict";
import { agentHosts, deviceHosts, loadHosts, openHostCall } from "./hosts.ts";

const NOW = 1_760_000_000_000;
const dev = (o: Record<string, unknown>) => ({ id: "dev_a", person: "usr_1", name: "MacBook", class: "desktop", epoch: 1, ...o }) as never;

test("this computer is named so and is on; other computers are on when seen in the last five minutes; phones and revoked ones are not listed", () => {
  const hosts = deviceHosts([dev({ current: true }), dev({ id: "dev_b", name: "home-box", class: "daemon", lastSeenAt: NOW - 60_000 }), dev({ id: "dev_c", name: "old", lastSeenAt: NOW - 3_600_000 }), dev({ id: "dev_p", class: "phone" }), dev({ id: "dev_r", revokedAt: 1 })], NOW);
  assert.deepEqual(hosts.map((h) => [h.label, h.online, h.why]), [["This computer", true, undefined], ["home-box", true, undefined], ["old", false, "Offline"]]);
});

test("agent computers are listed by their agent; one that is starting or failing is not choosable", () => {
  const hosts = agentHosts([{ computerId: "cmp_1", agentId: "agt_a", state: "working" }, { computerId: "cmp_2", agentId: "agt_b", state: "error" }, { computerId: "cmp_3", agentId: "agt_c", state: "asleep" }] as never, (id) => ({ agt_a: "Intake", agt_b: "Docs", agt_c: "Scout" })[id] ?? id);
  assert.deepEqual(hosts.map((h) => [h.label, h.online, h.why]), [["Intake's computer", true, undefined], ["Docs's computer", false, "Not working"], ["Scout's computer", true, undefined]]);
});

test("a Personal Space lists only computers; a Team Space adds the server and the agent computers; a failed read leaves its part out", async () => {
  const call = async (cap: string): Promise<unknown> => {
    if (cap === "devices.mine") return { devices: [dev({ current: true })], sessions: [] };
    if (cap === "computers.list") throw new Error("down");
    return {};
  };
  const personal = await loadHosts(call, { team: false, now: NOW, nameOf: (x) => x });
  assert.deepEqual(personal.map((h) => h.key), ["device:dev_a"]);
  const team = await loadHosts(call, { team: true, now: NOW, nameOf: (x) => x });
  assert.deepEqual(team.map((h) => h.key), ["device:dev_a", "server"]);
});

test("each host opens with the call that fits it", () => {
  assert.deepEqual(openHostCall({ key: "device:dev_a", label: "x", kind: "device", online: true, deviceId: "dev_a" }, "k"), { cap: "terminal.open", input: { host: "device", deviceId: "dev_a", idempotencyKey: "k" } });
  assert.deepEqual(openHostCall({ key: "server", label: "x", kind: "server", online: true }, "k"), { cap: "terminal.open_server", input: { idempotencyKey: "k" } });
  assert.deepEqual(openHostCall({ key: "agent:cmp_1", label: "x", kind: "agent", online: true, agentId: "agt_a", computerId: "cmp_1" }, "k"), { cap: "terminal.open", input: { host: "agent_computer", agentId: "agt_a", computerId: "cmp_1", idempotencyKey: "k" } });
});
