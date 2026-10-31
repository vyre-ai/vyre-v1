// App hubs (rc.9): the card that connects Composio or Pipedream with one key and lists the hub's apps and their tools. One component, two mounts (Console > Plugins and Settings > Connections), so it takes
// `call` and nothing else from its surroundings. A hub is an ordinary outside-tool connection made from the hub's template; the key goes to the Vault here and only its handle is kept on the connection.
// The hub row says "Runs through Composio" once; apps sit under it, tools under their app, collapsed until pressed. A tool that changes things carries a small "Asks first" mark. Each app has a
// Connect button to the hub's own page, and the tool list is read again when the person comes back to the window. Mail, files, CRM and the Vault never route through a hub.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { AppState, Linking, Pressable, Text, View } from "react-native";
import { HUBS, appName, connectLink, hubById, hubLine } from "../../../../lib/mcp-hubs.ts";
import type { HubTemplate } from "../../../../lib/mcp-hubs.ts";
import { AppIcon } from "../../../../ui/src/AppIcon/index.tsx";
import { Dialog } from "../../../../ui/src/Dialog/index.tsx";
import { useMenu } from "../../../../ui/src/Menu/index.tsx";
import { Row } from "../../../../ui/src/Row/index.tsx";
import { Segmented } from "../../../../ui/src/Segmented/index.tsx";
import { TextField } from "../../../../ui/src/TextField/index.tsx";

export type Call = (cap: string, input: unknown) => Promise<unknown>;
export interface HubConnection { connectionId: string; name: string; hub: string }
export interface HubTool { name: string; description: string; readOnly: boolean }
export interface HubServer { ok: boolean; error?: string | undefined; tools: readonly HubTool[] }

/** The tools of a hub grouped by app, in a stable order. Pure, so the grouping is tested without a screen. */
export function groupByApp(hub: HubTemplate, tools: readonly HubTool[]): { app: string; label: string; tools: { name: string; label: string; readOnly: boolean }[] }[] {
  const by = new Map<string, { name: string; label: string; readOnly: boolean }[]>();
  for (const t of tools) {
    const app = hub.appOf(t.name);
    const words = t.name.replace(/^[A-Za-z0-9]+[_-]/, "").replace(/[_-]+/g, " ").toLowerCase();
    by.set(app, [...(by.get(app) ?? []), { name: t.name, label: words.charAt(0).toUpperCase() + words.slice(1), readOnly: t.readOnly }]);
  }
  return [...by.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([app, list]) => ({ app, label: appName(app), tools: list }));
}

/** The headers of a new hub connection: the hub's header and the key as a Vault handle, never a value. */
export function hubHeaders(hub: HubTemplate, handle: string): Record<string, string> {
  return { [hub.header]: `${hub.prefix}${handle}` };
}

/** Runs `onBack` when the person comes back to this window (from the hub's page), so a list can be read again. */
export function useComeBack(onBack: () => void): void {
  const ref = useRef(onBack);
  ref.current = onBack;
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") ref.current(); });
    const win = globalThis as { addEventListener?: (t: string, f: () => void) => void; removeEventListener?: (t: string, f: () => void) => void };
    const on = (): void => ref.current();
    win.addEventListener?.("focus", on);
    return () => { sub.remove(); win.removeEventListener?.("focus", on); };
  }, []);
}

const lead = { width: 24, marginRight: 10, alignItems: "center", justifyContent: "center" } as const;
const mark = { fontSize: 12, color: "var(--ink-3)" } as const;

export interface AppHubsViewProps {
  connections: readonly HubConnection[];
  servers: Readonly<Record<string, HubServer | undefined>>;
  /** Saves the key and makes the connection; resolves to words for a person when it failed, nothing when it worked. */
  onConnect(input: { hub: HubTemplate; url: string; key: string }): Promise<string | undefined>;
  onDisconnect(connectionId: string): void;
}

export function AppHubsView({ connections, servers, onConnect, onDisconnect }: AppHubsViewProps): ReactElement {
  const menu = useMenu();
  const [dialog, setDialog] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [hubId, setHubId] = useState<string>(HUBS[0]!.id);
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const hub = hubById(hubId) ?? HUBS[0]!;
  const addressFor = (h: HubTemplate): string => (h.urlExample.includes("<") ? "" : h.urlExample);
  const pickHub = (id: string): void => { setHubId(id); setUrl(addressFor(hubById(id) ?? HUBS[0]!)); };
  const submit = async (): Promise<void> => {
    setBusy(true); setProblem("");
    const bad = await onConnect({ hub, url: url.trim(), key: key.trim() });
    setBusy(false);
    if (bad) { setProblem(bad); return; }
    setKey(""); setDialog(false);
  };
  const rows: ReactElement[] = [];
  for (const c of connections) {
    const h = hubById(c.hub);
    if (!h) continue;
    const here = open[c.connectionId] !== false;
    rows.push(<Row key={c.connectionId} id={`hub-${c.name}`} title={h.name} note={hubLine(h.id)} leading={<View style={lead}><AppIcon brand={h.id} name={h.name} size={24} /></View>}
      onPress={() => setOpen({ ...open, [c.connectionId]: !here })}
      trailing={<Pressable accessibilityRole="button" accessibilityLabel={`More about ${h.name}`} testID={`hub-more-${c.name}`} onPress={(e) => {
        const r = (e?.currentTarget as unknown as { getBoundingClientRect?(): { left: number; bottom: number } } | undefined)?.getBoundingClientRect?.();
        menu.show([{ label: "Disconnect", danger: true, onSelect: () => onDisconnect(c.connectionId) }], r?.left ?? 20, r?.bottom ?? 100, "other");
      }} style={{ paddingHorizontal: 10, paddingVertical: 4 }}><Text style={{ fontSize: 18, color: "var(--ink-3)" }}>{"⋯"}</Text></Pressable>} />);
    if (!here) continue;
    const server = servers[c.name];
    if (!server) { rows.push(<Row key={`${c.connectionId}-wait`} id={`hub-wait-${c.name}`} title="Loading the apps" />); continue; }
    if (!server.ok) { rows.push(<Row key={`${c.connectionId}-bad`} id={`hub-bad-${c.name}`} title={`${h.name} did not answer`} note="Check the key" />); continue; }
    const groups = groupByApp(h, server.tools);
    if (groups.length === 0) rows.push(<Row key={`${c.connectionId}-none`} id={`hub-none-${c.name}`} title="No apps yet" note={`Sign one in on ${h.name}, then come back`} />);
    for (const g of groups) {
      const key2 = `${c.connectionId}:${g.app}`;
      const tools = open[key2] === true;
      rows.push(<Row key={key2} id={`hub-app-${g.app}`} title={g.label} note={`${g.tools.length} ${g.tools.length === 1 ? "tool" : "tools"}`} leading={<View style={lead}><AppIcon brand={g.app} name={g.label} size={24} /></View>}
        onPress={() => setOpen({ ...open, [key2]: !tools })}
        trailing={<Pressable accessibilityRole="link" accessibilityLabel={`Connect ${g.label} on ${h.name}`} testID={`hub-connect-${g.app}`} onPress={() => { void Linking.openURL(connectLink(h, g.app)); }} style={{ paddingHorizontal: 10, paddingVertical: 4 }}><Text style={{ fontSize: 13, color: "var(--accent)" }}>Connect</Text></Pressable>} />);
      if (tools) for (const t of g.tools) rows.push(<Row key={`${key2}:${t.name}`} id={`hub-tool-${t.name}`} title={t.label} leading={<View style={lead} />}
        trailing={t.readOnly ? undefined : <Text style={mark} testID={`hub-asks-${t.name}`}>Asks first</Text>} />);
    }
  }
  rows.push(<Row key="add" id="hub-add" title={connections.length === 0 ? "Connect many apps at once" : "Connect an app hub"} note={connections.length === 0 ? "Composio or Pipedream, one key" : undefined} leading={<View style={lead}><Text style={{ textAlign: "center", fontSize: 18, color: "var(--ink-3)" }}>+</Text></View>}
    onPress={() => { setProblem(""); setUrl(addressFor(hub)); setDialog(true); }} />);
  return <View>
    {rows}
    {menu.element}
    {dialog ? <Dialog title="Connect an app hub" width={480} testID="hub-sheet" onClose={() => setDialog(false)} actions={[
      { label: `Get a ${hub.name} key`, onPress: () => { void Linking.openURL(hub.keyUrl); }, testID: "hub-getkey" },
      { label: "Cancel", onPress: () => setDialog(false), testID: "sheet-cancel" },
      { label: "Connect", primary: true, disabled: busy || key.trim() === "" || url.trim() === "", why: key.trim() === "" ? "Paste the key first" : url.trim() === "" ? "Add the address first" : "", onPress: () => { void submit(); }, testID: "sheet-submit" },
    ]}>
      <View style={{ gap: 12 }}>
        <Segmented label="Hub" options={HUBS.map((h) => ({ id: h.id, label: h.name }))} value={hub.id} onChange={pickHub} testID="hub-pick" />
        <TextField value={url} onChangeText={setUrl} placeholder={hub.urlExample} accessibilityLabel="Address" testID="hub-url" autoCapitalize="none" autoCorrect={false} />
        <TextField value={key} onChangeText={setKey} placeholder={`${hub.name} key`} accessibilityLabel={`${hub.name} key`} testID="hub-key" secureTextEntry autoCapitalize="none" autoCorrect={false} />
        {problem ? <Text accessibilityRole="alert" style={{ fontSize: 13, color: "var(--danger)" }}>{problem}</Text> : null}
      </View>
    </Dialog> : null}
  </View>;
}

/** The card, wired to the Space: reads the hub connections and their tools, saves a new key to the Vault, makes and removes connections. */
export function AppHubsCard({ call }: { call: Call }): ReactElement {
  const [connections, setConnections] = useState<HubConnection[]>([]);
  const [servers, setServers] = useState<Record<string, HubServer | undefined>>({});
  const agent = useRef<string | undefined>(undefined);
  const load = useCallback(async (tools: boolean): Promise<void> => {
    try {
      const out = (await call("plugins.connections.list", {})) as { connections: { connectionId: string; name: string; hub?: string }[] };
      const hubs = out.connections.filter((c) => c.hub).map((c) => ({ connectionId: c.connectionId, name: c.name, hub: c.hub! }));
      setConnections(hubs);
      if (!tools || hubs.length === 0) return;
      if (!agent.current) agent.current = ((await call("agents.list", {})) as { agents: { agentId: string }[] }).agents[0]?.agentId;
      if (!agent.current) return;
      for (const c of hubs) {
        try {
          const r = (await call("engine.mcp.tools", { agentId: agent.current, server: c.name })) as { servers: { key: string; ok: boolean; error?: string; tools: HubTool[] }[] };
          const s = r.servers.find((x) => x.key === c.name);
          setServers((was) => ({ ...was, [c.name]: s ? { ok: s.ok, error: s.error, tools: s.tools } : { ok: false, tools: [] } }));
        } catch { setServers((was) => ({ ...was, [c.name]: { ok: false, tools: [] } })); }
      }
    } catch { /* the rows stay as they were; the Space shows its own offline state */ }
  }, [call]);
  useEffect(() => { void load(true); }, [load]);
  useComeBack(() => { void load(true); });
  const onConnect: AppHubsViewProps["onConnect"] = async ({ hub, url, key }) => {
    try {
      const folders = ((await call("vault.folders.list", {})) as { folders: { id: string; scope: string }[] }).folders;
      const folderId = folders.find((f) => f.scope === "mine")?.id ?? ((await call("vault.folders.create", { name: "Mine", scope: "mine", idempotencyKey: crypto.randomUUID() })) as { folder: { id: string } }).folder.id;
      const itemName = `${hub.name}_key`;
      await call("vault.item.put", { folderId, name: itemName, kind: "api_key", fields: [{ key: "api_key", value: key, secret: true }], idempotencyKey: crypto.randomUUID() });
      await call("plugins.connection.add", { name: hub.id, scope: "space", url, headers: hubHeaders(hub, `#${itemName}.api_key`), hub: hub.id, idempotencyKey: crypto.randomUUID() });
      await load(true);
      return undefined;
    } catch (e) {
      const err = e as { message?: string; code?: string };
      return `${err.message ?? "That did not connect"}${err.code ? ` (${err.code})` : ""}.`;
    }
  };
  return <AppHubsView connections={connections} servers={servers} onConnect={onConnect}
    onDisconnect={(id) => { void call("plugins.connection.remove", { connectionId: id, idempotencyKey: crypto.randomUUID() }).then(() => load(false)); }} />;
}
