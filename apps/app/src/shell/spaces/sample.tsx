// Sample content for the shell's tests and screenshots: every row id starts with its Space's id ("nw-", "hb-", "me-"), so a test can look for one Space's rows in
// another Space's screen. The real places read the replica; this stands in for them.
import type { ReactElement, ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { PLACE_TITLE } from "../rail/kits.ts";
import type { PlaceId } from "../rail/kits.ts";
import type { TabsStorage } from "../tabs/store.ts";
import { useSpaceWatch } from "./context.tsx";
import { createShellHub } from "./hub.ts";
import type { HubOptions, ShellHub } from "./hub.ts";
import { SEED_DEFS } from "./model.ts";
import type { PlaceContext } from "./Shell.tsx";

export interface SampleRow {
  id: string;
  title: string;
}

const rows = (id: string, titles: readonly string[]): SampleRow[] => titles.map((title, i) => ({ id: `${id}-${i + 1}`, title }));

/** What each Space shows in each place. A place a Space has nothing in shows its empty line. */
export const SAMPLE_ROWS: Readonly<Record<string, Readonly<Partial<Record<PlaceId, readonly SampleRow[]>>>>> = {
  nw: {
    home: rows("nw-home", ["Send 12 invoices", "Rivera engagement letter", "County records search"]),
    chats: rows("nw-chat", ["Rivera intake", "October invoices", "Competitor pricing", "Maya Chen"]),
    inbox: rows("nw-inbox", ["Elena Rivera", "Harlow and Price"]),
    records: rows("nw-rec", ["Pruitt matter", "Rivera, Elena"]),
    files: rows("nw-file", ["client-intake.pdf", "Rivera onboarding plan"]),
    apps: rows("nw-app", ["Northwind site", "Intake form"]),
    automations: rows("nw-auto", ["Nightly digest"]),
    vault: rows("nw-vault", ["County portal login"]),
    settings: rows("nw-set", ["Profile", "Appearance"]),
    console: rows("nw-con", ["Members", "Billing"]),
  },
  hb: {
    home: rows("hb-home", ["Review the brand sheet", "Studio invoice"]),
    chats: rows("hb-chat", ["Brand refresh", "Client review"]),
    inbox: rows("hb-inbox", ["Dana Whitfield"]),
    files: rows("hb-file", ["brand-sheet.pdf", "moodboard.png"]),
    apps: rows("hb-app", ["Harbor portfolio"]),
    vault: rows("hb-vault", ["Stock photo account"]),
    settings: rows("hb-set", ["Profile", "Appearance"]),
  },
  me: {
    home: rows("me-home", ["Plan the week"]),
    chats: rows("me-chat", ["Flights to Kuala Lumpur", "Tax papers checklist"]),
    inbox: rows("me-inbox", ["Aina"]),
    records: rows("me-rec", ["Reading list"]),
    files: rows("me-file", ["passport.pdf"]),
    automations: rows("me-auto", ["Sunday review"]),
    vault: rows("me-vault", ["Bank login"]),
    settings: rows("me-set", ["Profile", "Appearance"]),
  },
};

function rowViews(list: readonly SampleRow[]): ReactElement[] {
  const out: ReactElement[] = [];
  for (const r of list) {
    out.push(
      <View key={r.id} testID={r.id} style={styles.row}>
        <Text style={styles.rowText}>{r.title}</Text>
      </View>,
    );
  }
  return out;
}

/** One sample place: its heading and rows, and a live subscription keyed by the Space, as a real place holds. */
export function SamplePlace({ ctx }: { ctx: PlaceContext }): ReactElement {
  useSpaceWatch(ctx.spaceId, ctx.place, "list");
  const list = SAMPLE_ROWS[ctx.spaceId]?.[ctx.place] ?? [];
  return (
    <View testID={`sample-${ctx.place}`} style={styles.page}>
      <Text accessibilityRole="header" style={styles.h1}>{PLACE_TITLE[ctx.place]}</Text>
      {list.length === 0 ? <Text style={styles.empty}>Nothing here yet</Text> : null}
      {rowViews(list)}
      {ctx.hash === "" ? null : <Text style={styles.empty}>{`Opened ${ctx.hash}`}</Text>}
    </View>
  );
}

export function samplePlace(ctx: PlaceContext): ReactNode {
  return <SamplePlace ctx={ctx} />;
}

export function memoryStorage(): TabsStorage & { dump(): Record<string, string> } {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v); },
    dump: () => Object.fromEntries(data),
  };
}

export interface SampleShellOptions extends Partial<Omit<HubOptions, "spaces">> {
  openId?: string;
}

/** A hub over the three seeds: Northwind open, Northwind and Harbor Studio starred (pre-opened), Personal on demand. */
export function createSampleShell(options: SampleShellOptions = {}): ShellHub {
  return createShellHub({
    spaces: SEED_DEFS,
    openId: options.openId ?? "nw",
    personId: options.personId ?? "irfad",
    deviceId: options.deviceId ?? "mac",
    storage: options.storage === undefined ? memoryStorage() : options.storage,
    ...(options.theme === undefined ? {} : { theme: options.theme }),
    ...(options.openReplica === undefined ? {} : { openReplica: options.openReplica }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.later === undefined ? {} : { later: options.later }),
    ...(options.skeletonMs === undefined ? {} : { skeletonMs: options.skeletonMs }),
  });
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 24, gap: 8, backgroundColor: "var(--win)" as string },
  h1: { fontSize: 22, fontWeight: "600", color: "var(--ink)" as string, marginBottom: 8 },
  row: { height: 32, justifyContent: "center", paddingHorizontal: 10, borderRadius: 8, backgroundColor: "var(--sunk)" as string },
  rowText: { fontSize: 13.5, color: "var(--ink)" as string },
  empty: { fontSize: 13, color: "var(--ink-3)" as string },
});
