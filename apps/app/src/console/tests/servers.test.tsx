// Console > Computers > Servers: the server list opens each machine, Add server is the one shared flow, the empty state, Updates, and the old page that moved in (Agent computers, Machines).
import test from "node:test";
import assert from "node:assert/strict";
import { ServersPage, serverLine } from "../pages/Servers.tsx";
import { MachinesPage } from "../pages/Machines.tsx";
import { AgentComputersPage } from "../pages/AgentComputersPage.tsx";
import { createRoot } from "test-renderer";
import { mountPage } from "./page-kit.tsx";

const UP = { current: "1.4.1", channel: "stable" as const };
const SERVERS = { servers: [
  { serverId: "srv_home", name: "Northwind server", state: "healthy", role: "space" },
  { serverId: "srv_box", name: "Berlin box", state: "down", role: "compute", enrollment: "approved" },
  { serverId: "srv_new", name: "New box", state: "down", role: "compute", enrollment: "pending", fingerprint: "ab cd" },
] };

test("a server's line says online, offline or waiting", () => {
  assert.equal(serverLine({ serverId: "a", name: "a", state: "healthy", role: "space" }), "Online");
  assert.equal(serverLine({ serverId: "a", name: "a", state: "down", role: "space" }), "Offline");
  assert.equal(serverLine({ serverId: "a", name: "a", state: "down", role: "compute", enrollment: "pending" }), "Waiting for approval");
});

test("each server opens that machine; a server still waiting for approval does not", async () => {
  const p = await mountPage(createRoot, <ServersPage />, { "network.servers": SERVERS, "updates.status": UP });
  try {
    assert.ok(p.text().includes("Northwind server") && p.text().includes("Berlin box"));
    await p.press("row-server-srv_box");
    assert.deepEqual(p.opened.at(-1), { page: "machines", args: { machineId: "srv_box" } });
    assert.equal(p.find("row-server-srv_new")?.props["onClick"], undefined, "pending servers are approved in the Add a server flow");
  } finally { p.restore(); }
});

test("Add server opens the shared Add a server sheet and asks the Space for a join command", async () => {
  const p = await mountPage(createRoot, <ServersPage />, { "network.servers": SERVERS, "updates.status": UP }, (cap) => cap === "network.server_join_code" ? { code: "ABC123", expiresAt: Date.now() + 600000, address: "https://team.example.com" } : { ok: true });
  try {
    assert.ok(!p.has("add-server-sheet"));
    await p.press("servers-add");
    assert.ok(p.has("add-server-sheet"), "the same sheet the Machines page uses");
    await p.type("add-nickname", "home-box");
    await p.press("add-make");
    const made = p.called("network.server_join_code");
    assert.equal(made.length, 1);
    assert.equal(made[0]!.input["nickname"], "home-box");
  } finally { p.restore(); }
});

test("with no servers the page says so in plain words and still offers Add server", async () => {
  const p = await mountPage(createRoot, <ServersPage />, { "network.servers": { servers: [] }, "updates.status": UP });
  try {
    assert.ok(p.text().includes("No servers yet. Add one to run agents around the clock."));
    await p.press("servers-empty-action");
    assert.ok(p.has("add-server-sheet"));
  } finally { p.restore(); }
});

test("Updates: up to date says so; a newer version offers Review update, which opens the Updates view", async () => {
  const quiet = await mountPage(createRoot, <ServersPage />, { "network.servers": SERVERS, "updates.status": UP });
  try { assert.ok(quiet.text().includes("Up to date") && !quiet.has("servers-review-update")); } finally { quiet.restore(); }
  const p = await mountPage(createRoot, <ServersPage />, { "network.servers": SERVERS, "updates.status": { ...UP, available: "1.5.0" } });
  try {
    assert.ok(p.text().includes("1.5.0"));
    await p.press("servers-review-update");
    assert.deepEqual(p.opened.at(-1), { page: "updates", args: undefined });
  } finally { p.restore(); }
});

test("Machines no longer draws the agent computers under its list; they are their own tab", async () => {
  const rows = { "machines.list": { machines: [], waiting: [] }, "computers.list": { computers: [] }, "agents.list": { agents: [] }, "computers.health": { state: "healthy", runtime: "docker" } };
  const machines = await mountPage(createRoot, <MachinesPage />, rows);
  try { assert.ok(!machines.has("console-agent-computers")); } finally { machines.restore(); }
  const tab = await mountPage(createRoot, <AgentComputersPage />, rows);
  try { assert.ok(tab.has("console-agent-computers")); } finally { tab.restore(); }
});
