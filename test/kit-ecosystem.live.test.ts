// A Kit installs everything a way of working needs in one click (CHAT-DESIGN ruling 5), on a booted daemon: a record type, a skill, a plugin marketplace, a plugin from it (with its option set to a
// Vault handle), an outside tool server and an agent. The install sheet names each before Install; after Install they are all there; the plugin's skill and command work.
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { boot, call, codeRootWithKit, connect, ok, scriptedModel, seededDir, stop } from "./support/eco-live.ts";

const MARKET = fileURLToPath(new URL("../fixtures/plugins/test-marketplace", import.meta.url));
const SKILL = "---\nname: matter-intake\ndescription: How this firm opens a matter. Use when a new client calls.\n---\n\nGet the conflict names before anything else.\n";

const KIT = {
  key: "ways-of-working", title: "Ways of working", version: "1.0.0", channel: "stable", description: "A skill, a plugin, an outside tool server, an agent and a record type, installed together.",
  items: [
    {
      key: "rt.matter_note", content: "structure", type: "record_type", title: "Matter note", recordType: "matter_note",
      apply: { cap: "schema.apply", input: { ops: [{ op: "type.create", type: "matter_note", def: { title: "Matter note", plural: "Matter notes", icon: "note", group: "Notes", label: "internal", titleField: "title", fields: [{ key: "title", type: "text", title: "Title", required: true }] } }], idempotencyKey: "kit.wow.rt", reason: "Kit install" } },
      undo: { cap: "schema.apply", input: { ops: [{ op: "type.drop", type: "matter_note" }], confirm: ["matter_note"], idempotencyKey: "kit.wow.rt.undo", reason: "Kit rollback" } },
    },
    { key: "sk.matter_intake", content: "tools", type: "skill", title: "Matter intake", skill: { text: SKILL } },
    { key: "mk.test", content: "tools", type: "marketplace", title: "Test marketplace", marketplace: { name: "vyre-test-market", source: MARKET } },
    { key: "pl.greeter", content: "tools", type: "plugin", title: "Greeter", plugin: { marketplace: "vyre-test-market", name: "greeter", config: { echo_token: "#Olivia_Echo.token" } } },
    { key: "mcp.crm", content: "tools", type: "connection", title: "CRM", connection: { name: "crm", url: "https://crm.example.com/mcp", headers: { Authorization: "#Crm_Key.token" } } },
    { key: "ag.clerk", content: "tools", type: "agent", title: "Intake clerk", agent: { name: "Intake clerk", role: "Opens matters and asks for the conflict names." } },
  ],
};

test("a Kit installs a record type, a skill, a marketplace, a plugin, an outside tool server and an agent in one click", async () => {
  const d = await boot(seededDir(), scriptedModel(async function* () {}), { codeRoot: codeRootWithKit(KIT) });
  try {
    await connect(d);
    const kit = ((await ok(d, "kits.list", {})).kits as Array<{ key: string; kitId: string; installed: boolean }>).find((k) => k.key === KIT.key)!;
    assert.equal(kit.installed, false);

    // the sheet names what the Kit brings, before anyone presses Install
    const sheet = (await ok(d, "kits.install_sheet", { kitId: kit.kitId })).sheet;
    assert.deepEqual([sheet.skills, sheet.marketplaces, sheet.plugins, sheet.connections, sheet.agents], [["matter-intake"], [MARKET], ["greeter from vyre-test-market"], ["crm"], ["Intake clerk"]]);
    assert.deepEqual(sheet.recordTypes, ["matter_note"]);
    assert.ok(sheet.vaultNames.includes("#Olivia_Echo"), JSON.stringify(sheet.vaultNames));
    assert.deepEqual(sheet.problems, [], JSON.stringify(sheet.problems));
    assert.notEqual((await call(d, "kits.install", { kitId: kit.kitId })).status, 200, "refused until the sheet is accepted");

    const done = await call(d, "kits.install", { kitId: kit.kitId, accepted: true });
    assert.equal(done.status, 200, JSON.stringify(done.data));
    assert.equal(done.data.kit.installed, true);

    // everything is there
    assert.ok(JSON.stringify((await ok(d, "schema.types.list", {})).types ?? await ok(d, "schema.types.list", {})).includes("matter_note"));
    const skills = (await ok(d, "skills.list", {})).skills as Array<{ name: string; tier: string; source: string }>;
    assert.deepEqual(skills.filter((s) => s.name === "matter-intake").map((s) => [s.tier, s.source]), [["space", "kit:ways-of-working"]]);
    assert.ok(skills.some((s) => s.name === "greeter:greeting"), "the plugin's own skill came with it");
    assert.deepEqual(((await ok(d, "plugins.marketplaces.list", {})).marketplaces as Array<{ name: string; allowed: boolean }>).map((m) => [m.name, m.allowed]), [["vyre-test-market", true]]);
    const plugins = (await ok(d, "plugins.list", {})).plugins as Array<{ name: string; enabled: boolean; config: Record<string, string> }>;
    assert.deepEqual(plugins.map((p) => [p.name, p.enabled, p.config]), [["greeter", true, { echo_token: "#Olivia_Echo.token" }]]);
    assert.deepEqual(((await ok(d, "plugins.connections.list", {})).connections as Array<{ name: string; url?: string; headers: Record<string, string> }>).map((c) => [c.name, c.url, c.headers]), [["crm", "https://crm.example.com/mcp", { Authorization: "#Crm_Key.token" }]]);
    assert.ok(((await ok(d, "agents.list", {})).agents as Array<{ name: string }>).some((a) => a.name === "Intake clerk"));
    const cmds = (await ok(d, "plugins.commands.list", {})).commands as Array<{ name: string }>;
    assert.deepEqual(cmds.map((c) => c.name), ["greeter:hello"]);
    const servers = ((await ok(d, "plugins.mcp.servers", {})).servers as Array<{ key: string }>).map((s) => s.key).sort();
    assert.deepEqual(servers, ["crm", "greeter/echo"]);

    // installing it again is the same install
    const again = await call(d, "kits.install", { kitId: kit.kitId, accepted: true });
    assert.notEqual(again.status, 200, "a second install is refused");
  } catch (e) { console.error("FAILED:", e instanceof Error ? e.message.slice(0, 1500) : e); throw e; } finally { await stop(d); }
});
