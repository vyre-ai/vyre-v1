// The machine row's right-click menu (lane l-chrome2a): Open, Drain or Undrain, Fix (clear caches, stop idle sessions, pin an agent), Copy Address, Remove from the Space last and asked first. What shows follows whose machine
// it is and whether the asker is an admin; each item is one capability call on the row's own id.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { act } from "react";
import { find, flush, installDom, mount, press } from "../../../../ui/src/testing/dom.ts";
import { MachineList } from "./MachinesView.tsx";
import { machineMenu } from "../places/chats/menus/kinds-b.ts";
import type { MachineRow, MachinesOut } from "./model.ts";
import type { MenuEntry } from "../../../../ui/src/Menu/index.tsx";

installDom();
const NOW = 1_760_000_000_000;
const base = (o: Partial<MachineRow> & { serverId: string; name: string }): MachineRow => ({ kind: "server", mine: false, state: "healthy", online: true, private: false, runs: { turns: 1, agentComputers: 0, sites: 0, automations: 0 }, can: ["docker"], room: { n: 60, why: "" }, limits: { maxTurns: null, maxAgentComputers: null }, drain: false, pins: [], ...o }) as MachineRow;
const space = base({ serverId: "space", name: "Northwind server", kind: "space" });
const box = base({ serverId: "srv_box", name: "Berlin box" });
const maya = base({ serverId: "dev_maya", name: "Maya's MacBook", kind: "linked", owner: "usr_maya", private: true });
const mine = base({ serverId: "dev_me", name: "Irfad's MacBook", kind: "linked", mine: true, owner: "usr_me" });
const out = (ms: MachineRow[], admin: boolean): MachinesOut => ({ machines: ms, waiting: [], alerts: [], admin, now: NOW });
const labels = (e: readonly MenuEntry[]): string[] => e.map((x) => ("separator" in x ? "-" : "head" in x ? `# ${x.head}` : x.label));
const menuLabels = (root: unknown): string[] => { const o: string[] = []; const walk = (n: unknown): void => { const x = n as { props?: Record<string, unknown>; children?: unknown[] }; const t = x.props?.["data-testid"] ?? x.props?.["testID"]; if (typeof t === "string" && t.startsWith("menu-item-")) o.push(t.slice(10)); (x.children ?? []).forEach((c) => typeof c === "object" && walk(c)); }; walk(root); return o.filter((l) => l !== "report"); };
async function open(root: unknown, id: string): Promise<void> { const n = find(root as never, `machine-${id}`) as { props: Record<string, (e: unknown) => void> } | null; assert.ok(n && typeof n.props["onContextMenu"] === "function", `${id} has a menu`); await act(async () => { n!.props["onContextMenu"]!({ preventDefault() {}, clientX: 5, clientY: 5, nativeEvent: {} }); }); await flush(); }
async function page(ms: MachineRow[], admin: boolean) {
  const calls: { cap: string; input: any }[] = [];   // eslint-disable-line @typescript-eslint/no-explicit-any
  const root = await mount(createRoot as never, <MachineList data={out(ms, admin)} who={(id) => id} narrow={false} now={NOW} onOpen={() => undefined} onAdd={() => undefined} scope="space" call={async (cap: string, input: unknown) => { calls.push({ cap, input: input as never }); return {}; }} reload={async () => undefined} />);
  await flush();
  return { root, calls };
}

test("the menu follows whose machine it is: an admin may drain and fix the Space server and servers and remove a server; of a member's computer only drain", () => {
  const d = { open() {}, drain() {}, clearCaches() {}, stopIdle() {}, pinAgent() {}, copyAddress() {}, remove() {} };
  assert.deepEqual(labels(machineMenu({ name: "Berlin box", draining: false, canDrain: true, canFix: true, canRemove: true }, d)), ["Open", "Drain", "-", "# Fix", "Clear Old Caches", "Stop Idle Sessions", "Pin an Agent…", "-", "Copy Address", "-", "Remove from the Space…"]);
  assert.ok(labels(machineMenu({ name: "x", draining: true, canDrain: true, canFix: true, canRemove: false }, d)).includes("Undrain"), "the words follow the state");
  assert.deepEqual(labels(machineMenu({ name: "Maya", draining: false, canDrain: true, canFix: false, canRemove: false }, d)), ["Open", "Drain", "-", "Copy Address"]);
  assert.deepEqual(labels(machineMenu({ name: "x", draining: false, canDrain: false, canFix: false, canRemove: false }, d)), ["Open", "-", "Copy Address"]);
});

test("an admin's row for a server: Drain and the fixes call machines.set and machines.fix on its id; Remove asks first, then network.server_remove", async () => {
  const w = await page([space, box, maya, mine], true);
  await open(w.root, "srv_box");
  assert.deepEqual(menuLabels(w.root), ["Open", "Drain", "Clear Old Caches", "Stop Idle Sessions", "Pin an Agent…", "Copy Address", "Remove from the Space…"]);
  await press(find(w.root as never, "menu-item-Drain") as never); await flush();
  await open(w.root, "srv_box");
  await press(find(w.root as never, "menu-item-Stop Idle Sessions") as never); await flush();
  await open(w.root, "srv_box");
  await press(find(w.root as never, "menu-item-Remove from the Space…") as never); await flush();
  assert.equal(w.calls.some((c) => c.cap === "network.server_remove"), false, "it asks first");
  await press(find(w.root as never, "menu-item-Remove") as never); await flush();
  assert.deepEqual(w.calls.map((c) => [c.cap, c.input]), [["machines.set", { machineId: "srv_box", drain: true }], ["machines.fix", { machineId: "srv_box", fix: "stop_idle" }], ["network.server_remove", { serverId: "srv_box" }]]);
});

test("the Space server cannot be removed, a member's computer only drains for an admin, and a member's own computer has the fixes but no Remove", async () => {
  const admin = await page([space, maya], true);
  await open(admin.root, "space");
  assert.ok(!menuLabels(admin.root).some((l) => /Remove/.test(l)));
  await open(admin.root, "dev_maya");
  assert.deepEqual(menuLabels(admin.root), ["Open", "Drain", "Copy Address"]);
  const member = await page([mine], false);
  await open(member.root, "dev_me");
  assert.deepEqual(menuLabels(member.root), ["Open", "Drain", "Clear Old Caches", "Stop Idle Sessions", "Pin an Agent…", "Copy Address"]);
  const watcher = await page([base({ serverId: "srv_x", name: "Shared box" })], false);
  await open(watcher.root, "srv_x");
  assert.deepEqual(menuLabels(watcher.root), ["Open", "Copy Address"], "a member has nothing to change on a server that is not theirs");
});
