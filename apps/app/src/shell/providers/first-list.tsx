// A place's first list from the replica. Until a place registers its own screen, the shell mounts this: the place's main list as ui/Row rows in a ui/VirtualList, drawn from the
// kept copy with no network, so a place never opens on a loading frame once the Space is open. The empty state is the shared one. It is also the frame a place shows while its own bundle loads.
import { useMemo, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { States } from "../../../../../ui/src/States/index.tsx";
import { VirtualList } from "../../../../../ui/src/VirtualList/index.tsx";
import type { LiveQuery, QueryState } from "../../../../../client/src/index.ts";
import { Skeleton } from "../../places/home/sections-a/parts.tsx";
import { useOptionalShellRuntime } from "./runtime.tsx";

export interface FirstList { screen: string; query: string; state?: Record<string, unknown>; title: string; empty: string; icon: "inbox" | "files" | "records" | "chat" | "search" | "done" }

/** The main list of each place, by the place's id in the app routes (src/startup/places.ts). Each is a live query of a generated screen. */
export const FIRST_LISTS: Readonly<Record<string, FirstList>> = {
  chat: { screen: "chats.sidebar", query: "recent", title: "Chats", empty: "No chats yet. Start one with your assistant.", icon: "chat" },
  mail: { screen: "inbox.contact-list", query: "rows", title: "Inbox", empty: "Nothing in your inbox.", icon: "inbox" },
  records: { screen: "records.saved-views", query: "views", title: "Records", empty: "No saved views yet.", icon: "records" },
  files: { screen: "files.list", query: "items", title: "Files", empty: "No files here yet.", icon: "files" },
  sites: { screen: "apps.sites", query: "sites", title: "Apps", empty: "No sites or apps yet.", icon: "search" },
  automations: { screen: "automations.sidebar", query: "automations", title: "Automations", empty: "No automations yet.", icon: "done" },
  vault: { screen: "vault.layout", query: "items", title: "Vault", empty: "Nothing in your Vault yet.", icon: "search" },
  settings: { screen: "settings.page", query: "pages", title: "Settings", empty: "No settings pages.", icon: "search" },
};

export interface ListItem { key: string; title: string; note?: string }

const KEYS = ["id", "threadId", "viewId", "fileId", "siteId", "key", "address"] as const;
const TITLES = ["title", "name", "displayName", "label"] as const;
const NOTES = ["lastPreview", "kind", "group", "status"] as const;

const text = (o: Record<string, unknown>, keys: readonly string[]): string | undefined => {
  for (const k of keys) { const v = o[k]; if (typeof v === "string" && v.length > 0) return v; }
  return undefined;
};

/** Every row of a query result, in the order the capability returned it: all the arrays in the output, each item reduced to a key, a title and a quiet second line. */
export function listItems(out: unknown): ListItem[] {
  if (!out || typeof out !== "object") return [];
  const items: ListItem[] = [];
  const seen = new Set<string>();
  for (const value of Object.values(out as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    for (const raw of value) {
      if (!raw || typeof raw !== "object") continue;
      const o = raw as Record<string, unknown>;
      const key = text(o, KEYS) ?? String(items.length);
      const title = text(o, TITLES) ?? key;
      if (seen.has(key)) continue;
      seen.add(key);
      const note = text(o, NOTES);
      items.push(note && note !== title ? { key, title, note } : { key, title });
    }
  }
  return items;
}

const NEVER: LiveQuery<never> = { subscribe: () => () => undefined, getSnapshot: () => ({ status: "loading" }) };

function initial(title: string): string {
  return title.trim().slice(0, 1).toUpperCase();
}

/** The frame before data arrives: the page title and rows of the real height. */
export function FirstListLoading({ title }: { title: string }): ReactElement {
  return (
    <View style={styles.page} testID="place-loading">
      <Text accessibilityRole="header" aria-level={1} style={styles.h1}>{title}</Text>
      <Skeleton rows={8} id="place" />
    </View>
  );
}

export default function FirstListPlace({ place }: { place: string }): ReactElement {
  const rt = useOptionalShellRuntime();
  const cfg = FIRST_LISTS[place];
  const q = useMemo<LiveQuery<unknown>>(() => (rt && cfg ? rt.screens.query(cfg.screen, cfg.query, cfg.state ?? {}) : (NEVER as LiveQuery<unknown>)), [rt, cfg]);
  const snap = useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot) as QueryState<unknown>;
  const online = useSyncExternalStore(
    rt ? rt.connection.subscribe : NEVER.subscribe,
    () => (rt ? rt.connection.get() === "online" : true),
    () => true,
  );
  const items = useMemo(() => (snap.status === "ready" ? listItems(snap.data) : []), [snap]);
  const title = cfg?.title ?? place;
  if (!rt || snap.status !== "ready") return <FirstListLoading title={title} />;
  return (
    <View style={styles.page} testID={`place-${place}`}>
      <Text accessibilityRole="header" aria-level={1} style={styles.h1}>{title}</Text>
      {online ? null : <Text style={styles.offline} accessibilityRole="status" testID="place-offline">Offline, showing your saved copy</Text>}
      {items.length === 0 ? (
        <States kind="empty" title={cfg?.empty ?? "Nothing here yet."} icon={cfg?.icon ?? "inbox"} />
      ) : (
        <VirtualList
          data={items}
          rowHeight={items.some((it) => it.note !== undefined) ? 44 : 28}
          keyOf={(it) => it.key}
          renderItem={(it) => (
            <Row
              id={`${place}:${it.key}`}
              title={it.title}
              {...(it.note ? { note: it.note } : {})}
              leading={<View style={styles.badge}><Text style={styles.badgeText}>{initial(it.title)}</Text></View>}
              onPress={() => rt.open({ subject: { type: place, id: it.key } })}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "var(--win)" as string, paddingTop: 34, paddingHorizontal: 28 },
  h1: { margin: 0, marginBottom: 16, fontSize: 28, lineHeight: 34, fontWeight: "600", letterSpacing: -0.6, color: "var(--ink)" as string },
  offline: { marginBottom: 8, fontSize: 12.5, color: "var(--ink-3)" as string },
  badge: { width: 20, height: 20, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: "var(--hover)" as string, marginRight: 8 },
  badgeText: { fontSize: 11, fontWeight: "600", color: "var(--ink-2)" as string },
});
