// Plugins and outside tools (CHAT-DESIGN ruling 6). An admin adds a marketplace (a git address or a folder), browses it and installs a plugin into the whole Space or into one agent. What a
// plugin brings is listed by kind: skills, / commands, sub-agents (which can start an agent), hooks and MCP servers. Plugin code runs only in the agent's sandbox. A secret option takes a Vault
// handle and never a value. Any MCP server can also be connected on its own, by URL or by command.
import { useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Empty, Group, Section } from "../shell/ui.tsx";
import { Help,  Actions, Button, Field, FormSheet, Note, ReadState, Select, attempt, useAction, useRead } from "./shared.tsx";
import { Tick } from "./ai-controls.tsx";

type Markets = CapMap["plugins.marketplaces.list"]["out"];
type Browse = CapMap["plugins.browse"]["out"];
type Installed = CapMap["plugins.list"]["out"];
type Connections = CapMap["plugins.connections.list"]["out"];
type Agents = CapMap["agents.list"]["out"];
type Plugin = Installed["plugins"][number];

const n = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`;
export const partsLine = (p: Plugin["parts"]): string =>
  [p.skills.length ? n(p.skills.length, "skill") : "", p.commands.length ? n(p.commands.length, "command") : "", p.agents.length ? n(p.agents.length, "sub-agent") : "", p.hooks ? n(p.hooks, "hook") : "", p.mcpServers.length ? n(p.mcpServers.length, "tool server") : ""].filter(Boolean).join(" · ") || "Nothing recognised";

export function PluginsPage(): ReactElement {
  const markets = useRead<Markets>("plugins.marketplaces.list");
  const installed = useRead<Installed>("plugins.list");
  const connections = useRead<Connections>("plugins.connections.list");
  const agents = useRead<Agents>("agents.list", {});
  const [marketId, setMarketId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const browse = useRead<Browse>("plugins.browse", { ...(marketId ? { marketplaceId: marketId } : {}), ...(q.trim() ? { q: q.trim() } : {}) });
  const [source, setSource] = useState("");
  const [addingMarket, setAddingMarket] = useState(false);
  const [target, setTarget] = useState("space");
  const [openPlugin, setOpenPlugin] = useState<string | null>(null);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [conn, setConn] = useState({ name: "", url: "", command: "", header: "" });
  const refresh = (): void => { markets.refresh(); installed.refresh(); connections.refresh(); browse.refresh(); };
  const action = useAction(refresh);
  if (!markets.data || !installed.data) return <ReadState error={markets.error ?? installed.error} retry={refresh} />;
  const agentOptions = [{ key: "space", title: "The whole Space" }, ...(agents.data?.agents ?? []).map((a) => ({ key: a.agentId, title: `Only ${a.name}` }))];
  const selected = installed.data.plugins.find((p) => p.pluginId === openPlugin) ?? null;
  const optionFields: ReactElement[] = [];
  for (const u of selected?.userConfig ?? []) optionFields.push(<Field key={u.key} label={`${u.title}${u.sensitive ? " (a Vault handle such as #Name.field)" : ""}`} testID={`opt-${u.key}`} value={config[u.key] ?? selected?.config[u.key] ?? ""} onChange={(v) => setConfig({ ...config, [u.key]: v })} />);
  const market = markets.data.marketplaces.find((m) => m.marketplaceId === marketId) ?? null;
  const install = (m: string, plugin: string): void => void action.run("plugins.install", { marketplaceId: m, plugin, scope: target === "space" ? "space" : "agent", ...(target === "space" ? {} : { agentId: target }), idempotencyKey: attempt() }, (out: { plugin: Plugin }) => `${out.plugin.name} installed`).then((out) => { if (out) setOpenPlugin((out as { plugin: Plugin }).plugin.pluginId); });
  return <View testID="console-plugins">
    {action.note ? <Note>{action.note}</Note> : null}
    <Help>Skills, commands and tools for agents. They run in the agent's sandbox.</Help>
    <Section title="Marketplaces" count={markets.data.marketplaces.length} right={<Button label="Add marketplace" testID="mk-new" onPress={() => setAddingMarket(true)} />}><Group>
      {markets.data.marketplaces.length === 0 ? <Empty icon="plug" action={{ label: "Add marketplace", onPress: () => setAddingMarket(true) }}>No marketplace yet</Empty> : markets.data.marketplaces.map((m) =>
        <Row key={m.marketplaceId} id={`mk-${m.name}`} title={m.name} note={`${n(m.plugins, "plugin")} · ${m.owner} · ${m.allowed ? "Allowed" : "Not allowed"}${m.warnings.length ? ` · ${n(m.warnings.length, "warning")}` : ""}`}
          onPress={() => setMarketId(marketId === m.marketplaceId ? null : m.marketplaceId)}
          trailing={<View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}><Text style={{ fontSize: 12, color: "var(--ink-3)" as string }}>{m.allowed ? "Allowed" : "Not allowed"}</Text><Tick label={`Allow ${m.name}`} checked={m.allowed} disabled={action.busy} onChange={(on) => void action.run("plugins.allow.set", { kind: "marketplace", marketplace: m.name, allowed: on, idempotencyKey: attempt() }, on ? "Marketplace allowed" : "Marketplace no longer allowed")} /></View>} />)}
    </Group>
      {market ? <Actions><Button label="Fetch again" disabled={action.busy} onPress={() => void action.run("plugins.marketplace.refresh", { marketplaceId: market.marketplaceId, idempotencyKey: attempt() }, "Marketplace updated")} /><Button label="Remove marketplace" danger disabled={action.busy} onPress={() => void action.run("plugins.marketplace.remove", { marketplaceId: market.marketplaceId, idempotencyKey: attempt() }, "Marketplace removed").then(() => setMarketId(null))} /></Actions> : null}
      {addingMarket ? <FormSheet title="Add a marketplace" testID="market-sheet" submit="Add marketplace" onClose={() => setAddingMarket(false)} disabled={action.busy || source.trim() === ""} why={source.trim() === "" ? "Add a source first" : undefined} note="A git address (https) or a folder on this server that holds .claude-plugin/marketplace.json"
        onSubmit={() => void action.run("plugins.marketplace.add", { source: source.trim(), idempotencyKey: attempt() }, (out: { marketplace: { name: string } }) => `${out.marketplace.name} added and allowed`).then((out) => { if (out) { setSource(""); setAddingMarket(false); } })}>
        <Field label="Git address or folder" testID="mk-source" value={source} onChange={setSource} />
      </FormSheet> : null}
    </Section>
    <Section title="Plugins to install" count={browse.data?.total ?? ""}><Group>
      <Field label="Search" value={q} onChange={setQ} />
      <Select label="Install into" value={target} options={agentOptions} onChange={setTarget} />
      {!browse.data ? <ReadState error={browse.error} retry={browse.refresh} /> : browse.data.plugins.length === 0 ? <Empty icon="plug">Nothing to install yet</Empty> : browse.data.plugins.map((p) => {
        const here = p.installed.some((i) => (target === "space" ? i.scope === "space" : i.agentId === target));
        return <Row key={`${p.marketplaceId}:${p.name}`} id={`browse-${p.name}`} title={p.name} note={`${p.description ?? "No description"} · ${p.marketplace}${p.allowed ? "" : " · Not allowed"}`}
          trailing={here ? <Text style={{ fontSize: 12, color: "var(--ink-3)" as string }}>Installed</Text> : <Button label="Install" testID={`install-${p.name}`} disabled={action.busy || !p.allowed} why={!p.allowed?"Blocked by policy":undefined} onPress={() => install(p.marketplaceId, p.name)} />} />;
      })}
    </Group></Section>
    <Section title="Installed" count={installed.data.plugins.length}><Group>
      {installed.data.plugins.length === 0 ? <Row id="inst-none" title="No plugins installed" /> : installed.data.plugins.map((p) =>
        <Row key={p.pluginId} id={`plugin-${p.name}-${p.agentId ?? "space"}`} title={p.name} note={`${partsLine(p.parts)} · ${p.scope === "space" ? "Whole Space" : `One agent`}${p.enabled ? "" : " · Off"}`}
          onPress={() => { setOpenPlugin(openPlugin === p.pluginId ? null : p.pluginId); setConfig({}); }}
          trailing={<View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}><Text style={{ fontSize: 12, color: "var(--ink-3)" as string }}>{p.enabled ? "On" : "Off"}</Text><Tick label={`${p.name} is on`} checked={p.enabled} disabled={action.busy} onChange={(on) => void action.run("plugins.set_enabled", { pluginId: p.pluginId, enabled: on, idempotencyKey: attempt() }, on ? "Plugin on" : "Plugin off")} /></View>} />)}
    </Group></Section>
    {selected ? <Section title={selected.name}><Group>
      {selected.description ? <Note>{selected.description}</Note> : null}
      {selected.parts.skills.length ? <Row id="pp-skills" title="Skills" note={selected.parts.skills.map((s) => `${selected.name}:${s}`).join(", ")} /> : null}
      {selected.parts.commands.length ? <Row id="pp-commands" title="/ commands" note={selected.parts.commands.map((c) => `/${selected.name}:${c}`).join(", ")} /> : null}
      {selected.parts.mcpServers.length ? <Row id="pp-servers" title="Tool servers" note={`${selected.parts.mcpServers.join(", ")} · run in the sandbox`} /> : null}
      {selected.parts.hooks ? <Row id="pp-hooks" title="Hooks" note={`${n(selected.parts.hooks, "hook")} · run in the sandbox`} /> : null}
      {selected.parts.agents.map((a) => <Row key={a} id={`pp-agent-${a}`} title={`Sub-agent ${a}`} trailing={<Button label="Make an agent" disabled={action.busy} onPress={() => void action.run("plugins.agent_template.use", { pluginId: selected.pluginId, name: a, idempotencyKey: attempt() }, "Agent created")} />} />)}
      {selected.warnings.length > 0 ? <Note>{selected.warnings.join(" ")}</Note> : null}
      {optionFields}
      <Actions>
        {selected.userConfig.length ? <Button label="Save options" testID="plugin-config" disabled={action.busy || Object.keys(config).length === 0} onPress={() => void action.run("plugins.config.set", { pluginId: selected.pluginId, config, idempotencyKey: attempt() }, "Options saved").then(() => setConfig({}))} /> : null}
        <Button label="Remove plugin" danger testID="plugin-remove" disabled={action.busy} onPress={() => void action.run("plugins.uninstall", { pluginId: selected.pluginId, idempotencyKey: attempt() }, "Plugin removed").then(() => setOpenPlugin(null))} />
      </Actions>
    </Group></Section> : null}
    <Section title="Outside tools" count={connections.data?.connections.length ?? ""}><Group>
      <Help>Connect an MCP server by its https address or a sandbox command.</Help>
      {(connections.data?.connections ?? []).map((c) => <Row key={c.connectionId} id={`conn-${c.name}`} title={c.name} note={c.url ?? `${c.command ?? ""} ${c.args.join(" ")}`.trim()} trailing={<Button label="Disconnect" disabled={action.busy} onPress={() => void action.run("plugins.connection.remove", { connectionId: c.connectionId, idempotencyKey: attempt() }, "Disconnected")} />} />)}
      <Field label="Name" testID="conn-name" value={conn.name} onChange={(v) => setConn({ ...conn, name: v })} />
      <Field label="Address (https) or leave empty and give a command" testID="conn-url" value={conn.url} onChange={(v) => setConn({ ...conn, url: v })} />
      <Field label="Command" testID="conn-command" value={conn.command} onChange={(v) => setConn({ ...conn, command: v })} />
      <Field label="Authorization, as a Vault handle such as #Crm_Key.token" testID="conn-header" value={conn.header} onChange={(v) => setConn({ ...conn, header: v })} />
      <Actions><Button label="Connect" testID="conn-add" disabled={action.busy || conn.name.trim() === "" || (conn.url.trim() === "") === (conn.command.trim() === "")}
        onPress={() => void action.run("plugins.connection.add", { name: conn.name.trim(), scope: "space", ...(conn.url.trim() ? { url: conn.url.trim(), ...(conn.header.trim() ? { headers: { Authorization: conn.header.trim() } } : {}) } : { command: conn.command.trim().split(/\s+/)[0], args: conn.command.trim().split(/\s+/).slice(1) }), idempotencyKey: attempt() }, "Connected").then((out) => { if (out) setConn({ name: "", url: "", command: "", header: "" }); })} /></Actions>
    </Group></Section>
  </View>;
}
