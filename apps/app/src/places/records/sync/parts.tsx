// Records > sync, the small pieces: the app's logo on a synced type, the sync dot, the source chip on a record, and the mark beside a field (a lock, a spinner, a check, a retry).
// Labels are short; every explanation is a tooltip (ui/Tip), so a page with many synced fields stays calm.
import { createElement } from "react";
import type { ReactElement } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { AppIcon } from "../../../../../../ui/src/AppIcon/index.tsx";
import { Tip } from "../../../../../../ui/src/Tip/index.tsx";
import { injectCss } from "../../../../../../ui/src/theme/css.ts";
import { brandOf, dotTip } from "./model.ts";
import type { App, DotState, MarkKind, SyncedRow } from "./model.ts";

const web = Platform.OS === "web";

/** The app's own mark on a tile (a letter tile when the app has none). */
export function SyncLogo({ app, connector, size = 18 }: { app?: App | undefined; connector?: string | undefined; size?: number }): ReactElement {
  const brand = brandOf(app, connector);
  const name = app?.title ?? (connector ?? "app").replace(/^crm_/, "");
  return <AppIcon brand={brand ?? name.toLowerCase().replace(/[^a-z0-9]+/g, "")} name={name} size={size} testID={`sync-logo-${connector ?? name}`} />;
}

const DOT: Record<DotState, string> = { live: "var(--ok)", syncing: "var(--accent)", needs: "var(--warn)", paused: "var(--ink-4)" };

/** A quiet 8 px dot: green when in step, the accent while it works, amber when it needs a person, grey when paused. Pressing it opens the Sync page. */
export function SyncDot({ row, app, onPress }: { row: Pick<SyncedRow, "state" | "pending" | "conflicts" | "schemaChanges">; app: string; onPress?: (() => void) | undefined }): ReactElement {
  const state = row.conflicts > 0 || row.schemaChanges > 0 || row.state === "error" || row.state === "needs_review" ? "needs" : row.state === "paused" ? "paused" : row.state === "initial" || row.pending > 0 ? "syncing" : "live";
  ensureSyncCss();
  const dot = web
    ? createElement("span", { "aria-hidden": true, "data-testid": `sync-dot-${state}`, style: { width: 8, height: 8, borderRadius: 4, display: "block", background: DOT[state], ...(state === "syncing" ? { animation: "vyre-sync-pulse 1.4s ease-in-out infinite" } : {}) } })
    : <View style={[s.dot, { backgroundColor: DOT[state] as string }]} testID={`sync-dot-${state}`} />;
  return (
    <Tip help={dotTip(row, app)}>
      {onPress
        ? <Pressable accessibilityRole="button" accessibilityLabel={dotTip(row, app)} testID="sync-dot" onPress={onPress} hitSlop={6} style={s.dotHit}>{dot}</Pressable>
        : <View accessible accessibilityLabel={dotTip(row, app)} testID="sync-dot" style={s.dotHit}>{dot}</View>}
    </Tip>
  );
}

/** Opens an address outside the app (the web: a new tab). */
export function openOutside(url: string): void {
  if (web) (globalThis as { open?: (u: string, t: string, f: string) => unknown }).open?.(url, "_blank", "noopener,noreferrer");
  else void Linking.openURL(url);
}

/** The source of a record: the app's logo and name (opens the Sync page) and Open in the app. */
export function SyncChip({ app, openUrl, onSync }: { app: App; openUrl?: string | undefined; onSync?: (() => void) | undefined }): ReactElement {
  return (
    <View style={s.chip} testID="sync-chip">
      <Tip help={`Synced from ${app.title}. Open the sync.`}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Synced from ${app.title}`} testID="sync-chip-open-sync" disabled={!onSync} onPress={onSync} style={s.chipMain}>
          <SyncLogo app={app} size={16} />
          <Text numberOfLines={1} style={s.chipText}>{app.title}</Text>
        </Pressable>
      </Tip>
      {openUrl ? (
        <Tip help={`Open this record in ${app.title}`}>
          <Pressable accessibilityRole="link" accessibilityLabel={`Open in ${app.title}`} testID="sync-chip-open-app" onPress={() => openOutside(openUrl)} style={s.chipOpen}>
            <Text style={s.chipOpenText}>Open</Text>
            {web ? createElement("svg", { viewBox: "0 0 16 16", width: 11, height: 11, "aria-hidden": true, style: { display: "block", stroke: "currentColor", fill: "none", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } }, createElement("path", { d: "M6 3.5H3.5v9h9V10M9 3.5h3.5V7M12.5 3.5L7.5 8.5" })) : null}
          </Pressable>
        </Tip>
      ) : null}
    </View>
  );
}

const ICONS: Record<Exclude<MarkKind, "none" | "saving">, string[]> = {
  lock: ["M4.5 7.5h7v5.5h-7z", "M6 7.5V5.8a2 2 0 014 0v1.7"],
  saved: ["M3.5 8.5l3 3 6-6.5"],
  failed: ["M8 3v6M8 12h.01"],
  local: ["M4 8h8"],
};
const MARK_COLOR: Record<MarkKind, string> = { none: "var(--ink-4)", lock: "var(--ink-4)", saving: "var(--accent)", saved: "var(--ok)", failed: "var(--danger)", local: "var(--ink-4)" };

/** The mark beside a field. It is a button when pressing does something: retry a failed save, or open the earlier values when there are any. */
export function FieldMark({ kind, tip, history, onRetry, onHistory }: { kind: MarkKind; tip: string; history: number; onRetry?: (() => void) | undefined; onHistory?: ((x: number, y: number) => void) | undefined }): ReactElement | null {
  if (kind === "none") return null;
  ensureSyncCss();
  const glyph = kind === "saving"
    ? (web ? createElement("span", { "aria-hidden": true, style: { width: 10, height: 10, borderRadius: 5, border: "1.5px solid var(--accent)", borderTopColor: "transparent", display: "block", animation: "vyre-sync-spin 0.8s linear infinite" } }) : <Text style={{ color: MARK_COLOR.saving as string, fontSize: 10 }}>...</Text>)
    : web
      ? createElement("svg", { viewBox: "0 0 16 16", width: 13, height: 13, "aria-hidden": true, style: { display: "block", stroke: MARK_COLOR[kind], fill: "none", strokeWidth: kind === "saved" ? 1.8 : 1.5, strokeLinecap: "round", strokeLinejoin: "round" } }, ...ICONS[kind as keyof typeof ICONS].map((d, i) => createElement("path", { key: i, d })))
      : <Text style={{ color: MARK_COLOR[kind] as string, fontSize: 11 }}>{kind === "lock" ? "L" : kind === "failed" ? "!" : "ok"}</Text>;
  const body = (
    <View style={s.mark} testID={`field-mark-${kind}`} accessible accessibilityLabel={tip}>
      {glyph}
      {history > 0 ? <View style={s.hist} testID="field-mark-history-badge" /> : null}
    </View>
  );
  if (kind === "failed" && onRetry) return <Tip help={tip}><Pressable accessibilityRole="button" accessibilityLabel={tip} testID="field-mark-retry" onPress={onRetry}>{body}</Pressable></Tip>;
  if (history > 0 && onHistory) {
    return (
      <Tip help={`${tip}. Earlier values: ${history}`}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Earlier values of this field: ${history}`} testID="field-mark-earlier" onPress={(e) => { const n = (e as unknown as { nativeEvent?: { pageX?: number; pageY?: number } }).nativeEvent; onHistory(n?.pageX ?? 0, n?.pageY ?? 0); }}>{body}</Pressable>
      </Tip>
    );
  }
  return <Tip help={tip}>{body}</Tip>;
}

const SYNC_CSS = "@keyframes vyre-sync-spin { to { transform: rotate(360deg); } } @keyframes vyre-sync-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }";
/** The two small animations (the spinner of a field on its way, the pulse of a dot that is working), added to the page once. */
export function ensureSyncCss(): void {
  if (web) injectCss((globalThis as { document?: Parameters<typeof injectCss>[0] }).document, "vyre-records-sync", SYNC_CSS);
}

const s = StyleSheet.create({
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotHit: { width: 16, height: 16, alignItems: "center", justifyContent: "center" },
  chip: { flexDirection: "row", alignItems: "center", height: 26, borderRadius: 13, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--sunk)" as string, overflow: "hidden" },
  chipMain: { flexDirection: "row", alignItems: "center", gap: 6, height: 26, paddingLeft: 5, paddingRight: 9, maxWidth: 160 },
  chipText: { fontSize: 12.5, color: "var(--ink-2)" as string, fontWeight: "500" },
  chipOpen: { flexDirection: "row", alignItems: "center", gap: 4, height: 26, paddingHorizontal: 9, borderLeftWidth: 1, borderLeftColor: "var(--line)" as string },
  chipOpenText: { fontSize: 12.5, color: "var(--accent)" as string },
  mark: { width: 20, height: 20, alignItems: "center", justifyContent: "center" },
  hist: { position: "absolute", right: 1, top: 2, width: 5, height: 5, borderRadius: 3, backgroundColor: "var(--accent)" as string },
});
