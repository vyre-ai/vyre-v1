// App hubs (rc.9): one card in Console > Plugins to connect a hub (Composio, Pipedream) with one key, and the hub's apps as tools for every agent. A hub is an ordinary outside-tool connection made from the
// hub's template; its key is saved to the Vault here and only its handle goes in the connection. Every row and tool from it says "Runs through Composio". Each app has a link to the hub's own page to sign
// it in, and the tool list refreshes when the person comes back. Remote servers that sign in with OAuth get a Sign in button in the same place. Mail, files, CRM and the Vault never route through a hub.
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { AppState, Linking, Text, View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { HUBS, connectLink, hubById, hubLine } from "../../../../../lib/mcp-hubs.ts";
import type { HubTemplate } from "../../../../../lib/mcp-hubs.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Empty, Group, Section } from "../shell/ui.tsx";
import { Button, Field, FormSheet, Help, Note, Segmented, attempt, useAction, useRead } from "./shared.tsx";
import { useConsoleData } from "../shell/data.tsx";

type Connection = CapMap["plugins.connections.list"]["out"]["connections"][number];
type Servers = CapMap["engine.mcp.tools"]["out"]["servers"];

/** The tools of a hub grouped by the app each belongs to, in a stable order. Pure, so the grouping is tested without a screen. */
export function groupByApp(hub: HubTemplate, tools: readonly { name: string; description: string; readOnly: boolean }[]): { app: string; tools: { name: string; label: string; description: string; readOnly: boolean }[] }[] {
  const by = new Map<string, { name: string; label: string; description: string; readOnly: boolean }[]>();
  for (const t of tools) {
    const app = hub.appOf(t.name);
    const label = t.name.replace(/^[A-Za-z0-9]+[_-]/, "").replace(/[_-]+/g, " ").toLowerCase();
    by.set(app, [...(by.get(app) ?? []), { name: t.name, label: label.charAt(0).toUpperCase() + label.slice(1), description: t.description, readOnly: t.readOnly }]);
  }
  return [...by.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([app, list]) => ({ app, tools: list }));
}

/** The headers of a new hub connection: the hub's header, the key as a Vault handle, never a value. */
export function hubHeaders(hub: HubTemplate, handle: string): Record<string, string> {
  return { [hub.header]: `${hub.prefix}${handle}` };
}

/** Runs `onBack` when the person comes back to this window (from the hub's page), so a list can be read again. */
function useComeBack(onBack: () => void): void {
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

function HubTools({ conn, agentId }: { conn: Connection; agentId: string }): ReactElement {
  const hub = hubById(conn.hub);
  const tools = useRead<{ servers: Servers }>("engine.mcp.tools", { agentId, server: conn.name });
  useComeBack(tools.refresh);
  const server = tools.data?.servers.find((s) => s.key === conn.name);
  if (!hub) return <></>;
  if (!server) return <Note>Loading the apps</Note>;
  if (!server.ok) return <Note>{`${hub.name} did not answer${server.error ? `: ${server.error}` : ""}. Check the key and try again.`}</Note>;
  const groups = groupByApp(hub, server.tools);
  if (groups.length === 0) return <Empty>{`No apps yet. Sign one in on ${hub.name}, then come back.`}</Empty>;
  return <>
    {/* ui-rows-lint: not a list (each app is a header row followed by its own tool rows) */}
    {groups.map((g) => <View key={g.app} testID={`hub-app-${g.app}`}>
      <Row id={`hub-app-row-${g.app}`} title={g.app.charAt(0).toUpperCase() + g.app.slice(1)} note={`${g.tools.length} ${g.tools.length === 1 ? "tool" : "tools"} · ${hubLine(hub.id)}`}
        trailing={<Button label="Connect" testID={`hub-connect-${g.app}`} onPress={() => { void Linking.openURL(connectLink(hub, g.app)); }} />} />
      {g.tools.map((t) => <Row key={t.name} id={`hub-tool-${t.name}`} title={t.label} note={`${t.readOnly ? "Reads" : "Changes things, asks first"} · ${hubLine(hub.id)}`}
        trailing={<Text style={{ fontSize: 12, color: "var(--ink-3)" as string }} testID={`hub-badge-${t.name}`}>{hub.name}</Text>} />)}
    </View>)}
  </>;
}

export function AppHubsSection({ connections, agentId, refresh }: { connections: readonly Connection[]; agentId: string | undefined; refresh: () => void }): ReactElement {
  const { call } = useConsoleData();
  const action = useAction(refresh);
  const [adding, setAdding] = useState(false);
  const [hubId, setHubId] = useState<string>(HUBS[0]!.id);
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const hub = hubById(hubId) ?? HUBS[0]!;
  const mine = connections.filter((c) => c.hub !== undefined);
  const connect = async (): Promise<void> => {
    // the key goes to the Vault first; the connection holds only its handle
    const folders = ((await call("vault.folders.list", {})) as { folders: { id: string; scope: string }[] }).folders;
    const folderId = folders.find((f) => f.scope === "mine")?.id ?? ((await call("vault.folders.create", { name: "Mine", scope: "mine", idempotencyKey: attempt() })) as { folder: { id: string } }).folder.id;
    const itemName = `${hub.name}_key`;
    await call("vault.item.put", { folderId, name: itemName, kind: "api_key", fields: [{ key: "api_key", value: key.trim(), secret: true }], idempotencyKey: attempt() });
    setKey("");
    const made = await action.run("plugins.connection.add", { name: hub.id, scope: "space", url: url.trim(), headers: hubHeaders(hub, `#${itemName}.api_key`), hub: hub.id, idempotencyKey: attempt() }, `${hub.name} connected`);
    if (made) { setAdding(false); setUrl(""); }
  };
  return <Section title="App hubs" count={mine.length} right={<Button label="Connect an app hub" testID="hub-new" onPress={() => { setAdding(true); setUrl(hub.urlExample.startsWith("https://remote") ? hub.urlExample : ""); }} />}><Group>
    <Help>One key gives every agent a hub's apps as tools. They run on the hub, not here.</Help>
    {action.note ? <Note>{action.note}</Note> : null}
    {mine.length === 0 ? <Empty action={{ label: "Connect an app hub", onPress: () => setAdding(true) }}>No app hub yet</Empty> : mine.map((c) => {
      const h = hubById(c.hub)!;
      return <View key={c.connectionId}>
        <Row id={`hub-${c.name}`} title={h.name} note={hubLine(h.id)} onPress={() => setOpen(open === c.connectionId ? null : c.connectionId)}
          trailing={<Button label="Disconnect" disabled={action.busy} onPress={() => void action.run("plugins.connection.remove", { connectionId: c.connectionId, idempotencyKey: attempt() }, "Disconnected")} />} />
        {open === c.connectionId && agentId ? <HubTools conn={c} agentId={agentId} /> : null}
      </View>;
    })}
    {adding ? <FormSheet title="Connect an app hub" testID="hub-sheet" submit="Connect" onClose={() => setAdding(false)} disabled={action.busy || key.trim() === "" || url.trim() === ""} why={key.trim() === "" ? "Paste the key first" : url.trim() === "" ? "Add the address first" : ""}
      onSubmit={() => void connect()}>
      <Segmented options={HUBS.map((h) => ({ key: h.id, title: h.name }))} value={hubId} onChange={(id) => { setHubId(id); const h = hubById(id)!; setUrl(h.urlExample.startsWith("https://remote") ? h.urlExample : ""); }} />
      <Field label={`Address, such as ${hub.urlExample}`} testID="hub-url" value={url} onChange={setUrl} />
      <Field label={`${hub.name} key`} testID="hub-key" value={key} onChange={setKey} secure />
      <Help>{`${hub.keyHint} It is saved to the Vault; this Space keeps only its name.`}</Help>
      <Button label={`Open ${hub.name}`} onPress={() => { void Linking.openURL(hub.keyUrl); }} />
    </FormSheet> : null}
  </Group></Section>;
}

/** The sign-in button of a remote connection that uses OAuth; it reads "Sign in again" once a token is held. */
export function OauthSignIn({ conn, refresh }: { conn: Connection; refresh: () => void }): ReactElement {
  const status = useRead<{ signedIn: boolean }>("engine.mcp.oauth_status", { connectionId: conn.connectionId });
  const action = useAction(() => { status.refresh(); refresh(); });
  useComeBack(status.refresh);
  const signIn = (): void => {
    const origin = (globalThis as { location?: { origin?: string } }).location?.origin ?? "";
    void action.run("engine.mcp.oauth_start", { connectionId: conn.connectionId, redirectUri: `${origin}/oauth/callback` }, (out: { authUrl: string }) => { void Linking.openURL(out.authUrl); return "Finish signing in in your browser"; });
  };
  return <Button label={status.data?.signedIn ? "Sign in again" : "Sign in"} testID={`oauth-${conn.name}`} disabled={action.busy} onPress={signIn} why={action.note || undefined} />;
}
