// Vault > Connections (owner ruling D28): the one home for every connection an agent can use. Mine (for me and my agents) and Space (for Everyone or groups, set by an admin), plus each agent's
// own when there are any. Built-in integrations, MCP servers, app hubs, and the servers plugins and skills bring sit in one list. Each row has a steady health dot, who can use it, which agents
// used it and when; its menu has Test, Sign in or Reconnect, Share, Turn off and Remove. Add opens the sheet (the MCP registry, an address, or a Claude Code or Codex config). Admins see the
// Space's rules here too: who may add Space connections, and the allow-list. Settings and the Console link here.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { Linking, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { States } from "../../../../../../ui/src/States/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { AppHubsCard } from "../../../hubs/AppHubs.tsx";
import { useOnline, usePrincipals, useVaultData } from "../layout/data.tsx";
import { Btn, IconBtn, QuietLine } from "../layout/parts.tsx";
import { attemptKey, check, messageOf, signIn } from "./actions.ts";
import { assemble, dotColor, healthWords, noteOf } from "./model.ts";
import type { Account, ConnRow, Connector, Health, Home } from "./model.ts";
import { AddConnection } from "./AddConnection.tsx";
import type { AddInitial } from "./AddConnection.tsx";
import { RulesPanel } from "./RulesPanel.tsx";
import { ShareSheet } from "./ShareSheet.tsx";

export interface ConnectionsData { home: Home | null; accounts: Account[]; connectors: Connector[]; groups: Map<string, string>; error: string | null; loaded: boolean }

/** Reads the three sources; a source the person cannot read (built-in integrations for a guest) is left out, never an error for the page. */
export function useConnections(call: (cap: string, input: unknown) => Promise<unknown>, admin = true, initial?: ConnectionsData): ConnectionsData & { refresh(): void } {
  const [state, setState] = useState<ConnectionsData>(initial ?? { home: null, accounts: [], connectors: [], groups: new Map(), error: null, loaded: false });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    void (async () => {
      const soft = <T,>(p: Promise<unknown>, d: T): Promise<T> => p.then((x) => x as T, () => d);
      try {
        const [home, accounts, connectors, groups] = await Promise.all([
          call("plugins.connections.home", {}) as Promise<Home>,
          soft<{ connections: Account[] }>(call("connections.list", { whose: "all" }), { connections: [] }),
          soft<{ connectors: Connector[] }>(call("connectors.list", {}), { connectors: [] }),
          admin ? soft<{ groups: { id: string; name: string }[] }>(call("access.groups.list", {}), { groups: [] }) : Promise.resolve({ groups: [] }),
        ]);
        if (live) setState({ home, accounts: accounts.connections ?? [], connectors: connectors.connectors ?? [], groups: new Map((groups.groups ?? []).map((g) => [g.id, g.name] as const)), error: null, loaded: true });
      } catch (e) { if (live) setState((s) => ({ ...s, error: messageOf(e), loaded: true })); }
    })();
    return () => { live = false; };
  }, [call, tick, admin]);
  return { ...state, refresh: () => setTick((n) => n + 1) };
}

interface Tested { health: Health; tools?: number; note?: string }

export interface ConnectionsViewProps {
  onClose?: (() => void) | undefined;
  /** Open on the Add sheet (the address asked for it, or a screenshot mount). */
  initialAdd?: boolean | AddInitial;
  /** What the page shows before its first read answers (a test that renders once, a screenshot mount). */
  initialData?: ConnectionsData;
}

export function ConnectionsView({ onClose, initialAdd = false, initialData }: ConnectionsViewProps): ReactElement {
  const data = useVaultData();
  const online = useOnline();
  const names = usePrincipals();
  const menu = useMenu();
  const conns = useConnections(data.call, true, initialData);
  const [adding, setAdding] = useState<boolean | AddInitial>(initialAdd);
  const [sharing, setSharing] = useState<ConnRow | null>(null);
  const [tested, setTested] = useState<Record<string, Tested>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const now = data.clock().now;
  const agentName = useCallback((id: string) => names.name(id), [names]);
  const groupName = useCallback((id: string) => conns.groups.get(id) ?? "a group", [conns.groups]);
  const sections = useMemo(() => assemble(conns.home, conns.accounts, conns.connectors, data.me.id, groupName, agentName), [conns.home, conns.accounts, conns.connectors, data.me.id, groupName, agentName]);
  const admin = conns.home?.admin === true;
  const canAddSpace = conns.home?.canAddSpace === true;
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin ?? "";

  const run = async (row: ConnRow, what: string, f: () => Promise<string | void>): Promise<void> => {
    setBusy(row.id);
    try { const said = await f(); setNote(said || what); conns.refresh(); }
    catch (e) { setNote(messageOf(e)); }
    finally { setBusy(null); }
  };
  const test = (row: ConnRow): void => {
    void run(row, `Checked ${row.title}`, async () => {
      if (row.accountId) {
        const r = (await data.call("connections.test", { connectionId: row.accountId })) as { state: string; detail?: string };
        setTested((t) => ({ ...t, [row.id]: { health: r.state === "healthy" ? "ok" : r.state === "degraded" ? "needs_signin" : "not_answering", ...(r.detail ? { note: r.detail } : {}) } }));
        return;
      }
      const r = await check(data.call, { key: row.key ?? "", connectionId: row.connectionId, oauth: row.oauth }, data.assistantId);
      setTested((t) => ({ ...t, [row.id]: r }));
      return `${row.title}: ${healthWords(r.health, r.tools)}`;
    });
  };
  const reconnect = (row: ConnRow): void => {
    void run(row, `Finish signing in to ${row.title} in your browser`, async () => {
      if (row.accountId) {
        const r = (await data.call("connections.reconnect", { connectionId: row.accountId })) as { authUrl?: string };
        if (r.authUrl) await Linking.openURL(r.authUrl);
        return r.authUrl ? undefined : "Put the key back in its Vault item, then test it";
      }
      if (!row.connectionId) return;
      const url = await signIn(data.call, row.connectionId, origin);
      await Linking.openURL(url);
    });
  };
  const remove = (row: ConnRow): void => {
    void run(row, `Removed ${row.title}`, async () => {
      if (row.accountId) { await data.call("connections.delete", { connectionId: row.accountId }); return; }
      if (row.connectionId) await data.call("plugins.connection.forget", { connectionId: row.connectionId, idempotencyKey: attemptKey() });
    });
  };
  const toggle = (row: ConnRow, on: boolean): void => {
    void run(row, on ? `Turned ${row.title} on` : `Turned ${row.title} off`, async () => {
      if (row.connectionId) await data.call("plugins.connection.update", { connectionId: row.connectionId, enabled: on, idempotencyKey: attemptKey() });
    });
  };

  const rowMenu = (row: ConnRow, x: number, y: number): void => {
    const mcp = row.kind !== "app" && row.kind !== "plugin" && row.kind !== "skill";
    const entries: MenuEntry[] = [
      { label: "Test", onSelect: () => test(row) },
      ...(row.kind === "app" || (mcp && row.oauth) ? [{ label: row.health === "ok" ? "Reconnect" : "Sign in", onSelect: () => reconnect(row) } as MenuEntry] : []),
      ...(mcp && row.section === "space" && row.canManage && !data.personal ? [{ label: "Share…", onSelect: () => setSharing(row) } as MenuEntry] : []),
      ...(mcp && row.canManage ? [row.health === "off" ? { label: "Turn on", onSelect: () => toggle(row, true) } as MenuEntry : { label: "Turn off", onSelect: () => toggle(row, false) } as MenuEntry] : []),
      ...((mcp || row.kind === "app") && row.canManage ? [{ separator: true } as MenuEntry, { label: "Remove", danger: true, onSelect: () => remove(row) } as MenuEntry] : []),
      ...(row.kind === "plugin" ? [{ separator: true } as MenuEntry, { label: "Managed on its plugin", disabled: true, reason: "Turn the plugin off or remove it in the Console's Plugins page" } as MenuEntry] : []),
      ...(row.kind === "skill" ? [{ separator: true } as MenuEntry, { label: "Managed on its skill", disabled: true, reason: "Set its keys, turn it off or remove it on the skill's page" } as MenuEntry] : []),
    ];
    menu.show(entries, x, y, "other");
  };

  const rowsOf = (list: readonly ConnRow[]): ReactElement[] => {
    const out: ReactElement[] = [];
    for (const r of list) {
      const t = tested[r.id];
      const health = t?.health ?? r.health;
      const tools = t ? t.tools : r.tools;
      out.push(
        <Row
          key={r.id} id={`conn-${r.id}`} title={r.title} titleSuffix={healthWords(health, tools)} note={noteOf(r, now, agentName)}
          leading={<View style={s.lead}><View style={[s.dot, { backgroundColor: dotColor(health) as string }]} accessibilityLabel={healthWords(health, tools)} testID={`conn-dot-${r.id}`} /></View>}
          trailing={busy === r.id ? <Text style={s.quiet}>Working…</Text> : <IconBtn icon="more" label={`Actions for ${r.title}`} onPress={(e) => { const p = pointOf(e); rowMenu(r, p.x - 180, p.y); }} testID={`conn-more-${r.id}`} />}
          onPress={(e) => { const p = pointOf(e); rowMenu(r, p.x, p.y); }}
        />,
      );
    }
    return out;
  };

  const section = (title: string, list: readonly ConnRow[], empty: string, testID: string): ReactElement => (
    <View style={s.section} testID={testID}>
      <Text style={s.sectionHead} accessibilityRole="header">{title}<Text style={s.count}>{`  ${list.length}`}</Text></Text>
      {list.length === 0 ? <Text style={s.emptyLine}>{empty}</Text> : rowsOf(list)}
    </View>
  );

  const narrow = useWindowDimensions().width < 640;
  return (
    <View style={s.frame} testID="vault-connections">
      {menu.element}
      <ScrollView style={s.scroll} contentContainerStyle={s.page}>
      <View style={s.head}>
        {onClose ? <Btn label="Back" icon="back" onPress={onClose} testID="connections-back" /> : null}
        <Text accessibilityRole="header" style={s.title}>Connections</Text>
        <View style={{ flex: 1 }} />
        <Btn label={narrow ? "Add" : "Add a connection"} icon="plus" primary onPress={() => setAdding(true)} disabled={!online} why={!online ? "Adding needs the Space to be online" : undefined} testID="connections-add" />
      </View>
      <Text style={s.intro}>{data.personal ? "Apps and tool servers you and your agents can use. Keys stay in your Vault." : "Apps and tool servers you and your agents can use. Yours are only yours; the Space's are for everyone or the groups an admin picks. Keys stay in the Vault."}</Text>
      {!conns.loaded ? <Text style={s.quiet} testID="connections-loading">Loading</Text>
        : conns.error ? <States kind="error" message="Couldn't load your connections" cause={conns.error} retryable onRetry={conns.refresh} />
        : (
          <>
            {section("Mine", sections.mine, "Nothing of yours yet. Add a connection to use an app or a tool server in your chats.", "connections-mine")}
            {data.personal && sections.space.length === 0 ? null : section(data.personal ? "This Space" : "Space", sections.space, canAddSpace ? "Nothing for the whole Space yet." : "Nothing shared with you yet. An admin adds connections for the Space.", "connections-space")}
            {sections.agents.length > 0 ? section("Your agents' own", sections.agents, "", "connections-agents") : null}
            {admin && !data.personal ? <View style={s.section} testID="connections-hubs"><Text style={s.sectionHead} accessibilityRole="header">App hubs</Text><AppHubsCard call={data.call} /></View> : null}
            {admin && !data.personal && conns.home ? <RulesPanel policy={conns.home.policy} onSaved={(t) => { setNote(t); conns.refresh(); }} /> : null}
          </>
        )}
      <View style={s.lineSlot}>{note ? <QuietLine text={note} testID="connections-line" /> : null}</View>
      </ScrollView>
      {adding ? <AddConnection canAddSpace={canAddSpace && !data.personal} canAsk={!!conns.home && !canAddSpace && !data.personal} {...(typeof adding === "object" ? { initial: adding } : {})} onClose={() => setAdding(false)} onAdded={(t) => { setNote(t); conns.refresh(); }} /> : null}
      {sharing ? <ShareSheet row={sharing} groups={conns.groups} onClose={() => setSharing(null)} onSaved={(t) => { setSharing(null); setNote(t); conns.refresh(); }} /> : null}
    </View>
  );
}

function pointOf(e: unknown): { x: number; y: number } {
  const ev = e as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number; right: number } }; nativeEvent?: { pageX?: number; pageY?: number } };
  const box = ev?.currentTarget?.getBoundingClientRect?.();
  return box ? { x: box.right, y: box.bottom } : { x: ev?.nativeEvent?.pageX ?? 0, y: ev?.nativeEvent?.pageY ?? 0 };
}

const s = StyleSheet.create({
  // static, not relative: the Add and Share sheets are absolute, so they cover and centre on the whole Vault place (sidebar included), as the Vault's own sheets do
  frame: { flex: 1, minWidth: 0, position: "static" as "relative" },
  scroll: { flex: 1 },
  page: { width: "100%", maxWidth: 860, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24, gap: 6 },
  head: { height: 48, flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 20, fontWeight: "600", letterSpacing: -0.2, color: "var(--ink)" as string },
  intro: { fontSize: 13, color: "var(--ink-3)" as string, marginBottom: 6, maxWidth: 640 },
  section: { marginTop: 14, gap: 1 },
  sectionHead: { fontSize: 12, fontWeight: "600", color: "var(--ink-3)" as string, paddingHorizontal: 8, paddingBottom: 6, textTransform: "uppercase" as const, letterSpacing: 0.4 },
  count: { fontWeight: "400" },
  emptyLine: { fontSize: 13, color: "var(--ink-3)" as string, paddingHorizontal: 8, paddingVertical: 8 },
  lead: { width: 22, alignItems: "flex-start", justifyContent: "center" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  quiet: { fontSize: 12.5, color: "var(--ink-3)" as string },
  lineSlot: { height: 32, justifyContent: "center", marginTop: 8 },
});
