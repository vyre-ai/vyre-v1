// The "Bring your sessions" step on the desktop app: the Claude Code and Codex sessions found on this computer, newest first, as checkable rows with a name, folder and date. A quiet
// "Folder: All" button opens the app's menu to narrow them to one folder (no pill strip), and Select all covers what the filter shows. Importing copies only the ticked ones: in the
// onboarding screen the bar's main button reads "Import 3" and does it, the card then says where they went, and Continue moves on. Each session is read just before its own import, as in Settings.
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CapCall } from "../shell/session/caps.ts";
import { desktopSessionImporter } from "../../../../client/src/session-import/desktop.ts";
import type { SessionSource } from "../../../../client/src/session-import/parse.ts";
import { confirmedSessionInput } from "../places/settings/session-import-model.ts";
import { useMenu } from "../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../ui/src/Menu/index.tsx";
import { Row } from "../../../../ui/src/Row/index.tsx";
import { Mark } from "./ProviderLogo.tsx";
import { failureLine, folderChoices, folderName, folderMenuLabel, importedNote, modifiedAt, newestFirst, relativeDate, rememberImported, selectState, sessionName, whyWords } from "./sessions-model.ts";
import type { ImportTally } from "./sessions-model.ts";
import { CARD } from "./card-style.ts";
import { dropEmpty } from "./sessions-filter.ts";
import { draftGet, draftSet } from "./drafts.ts";

const label = (src: SessionSource): string => `${src.provider === "codex" ? "Codex" : "Claude Code"}`;

/** Where a press happened, so the menu opens under the button. */
function pointOf(e: unknown): { x: number; y: number } {
  const ev = e as { nativeEvent?: { pageX?: number; pageY?: number }; currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } } };
  const box = ev.currentTarget?.getBoundingClientRect?.();
  if (box) return { x: box.left, y: box.bottom + 4 };
  return { x: ev.nativeEvent?.pageX ?? 0, y: ev.nativeEvent?.pageY ?? 0 };
}

export function SessionsCard({ call, onDone, gate, onOpenChats }: { call: CapCall; onDone(): void; gate?(save: (() => Promise<boolean>) | null, label?: string): void; onOpenChats?(): void }): ReactElement {
  // set once the import is done: the card then says where the sessions are, and Continue (the gate) finishes the step
  const [found, setFound] = useState<SessionSource[] | null>(null);
  // reopened from the rail or Back: the ticks and the folder filter are as they were left
  const [on, setOn] = useState<ReadonlySet<string>>(() => new Set(draftGet<string[]>("sessions-on") ?? []));
  const [folder, setFolder] = useState(() => draftGet<string>("sessions-folder") ?? "");
  useEffect(() => { draftSet("sessions-on", [...on]); draftSet("sessions-folder", folder); }, [on, folder]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [imported, setImported] = useState<{ count: number; empty: number } | null>(null);
  // what earlier runs already brought in (a retry does the failed ones only)
  const doneBefore = useRef(0);
  const emptyBefore = useRef(0);
  const menu = useMenu();
  useEffect(() => {
    let off = false;
    const imp = desktopSessionImporter();
    if (!imp) { setFound([]); return undefined; }
    void imp.discover().then(async (r) => { const sorted = newestFirst(r); const keep = await dropEmpty(sorted, async (src) => (await imp.preview(src)).messages.length); if (!off) setFound(keep); }).catch(() => { if (!off) { setFound([]); setError("Could not look for sessions."); } });
    return () => { off = true; };
  }, []);
  const toggle = (key: string): void => setOn((old) => { const n = new Set(old); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const shown = (found ?? []).filter((src) => !folder || folderName(src.cwd) === folder);
  const shownKeys = shown.map((src) => src.sessionKey);
  const all = selectState(shownKeys, on);
  const toggleAll = (): void => setOn((old) => { const n = new Set(old); for (const k of shownKeys) { if (all === "all") n.delete(k); else n.add(k); } return n; });
  const folders = folderChoices(found ?? []);
  const now = Date.now();
  /** Imports the ticked sessions; true when it went through. */
  const run = async (): Promise<boolean> => {
    const imp = desktopSessionImporter();
    if (!imp || busy || on.size === 0) return false;
    setBusy(true); setError("");
    // each ticked session is its own try: one that is empty or refused does not stop the rest, and the card says which failed and why
    const tally: ImportTally = { imported: 0, empty: 0, failed: [] };
    try {
      for (const src of found ?? []) {
        if (!on.has(src.sessionKey)) continue;
        try {
          const at = Date.now();
          const session = await imp.preview(src);
          if (session.messages.length === 0) { tally.empty++; continue; }
          await call("sessions.import", confirmedSessionInput({ source: src, session, at }, Date.now()));
          tally.imported++;
        } catch (e) { tally.failed.push({ key: src.sessionKey, name: sessionName(src), why: whyWords(e) }); }
      }
      doneBefore.current += tally.imported; emptyBefore.current += tally.empty;
      rememberImported(doneBefore.current);
      if (tally.failed.length > 0) {
        // stay on the card with only the failed ones ticked, so the same button retries exactly those
        setOn(new Set(tally.failed.map((f) => f.key)));
        setError(failureLine({ ...tally, imported: doneBefore.current }));
        return false;
      }
      setImported({ count: doneBefore.current, empty: emptyBefore.current });
      if (!gate) onDone();
      return true;
    } finally { setBusy(false); }
  };
  const runRef = useRef(run);
  runRef.current = run;
  // the bar's main button: Import N while some are ticked (it imports and stays, so the card can say where they went), then Continue; with nothing found there is nothing to do, so Continue moves on
  const count = on.size, nothing = found !== null && found.length === 0;
  useEffect(() => {
    if (!gate) return undefined;
    if (imported !== null || nothing) gate(async () => true);
    else if (count > 0) gate(async () => { await runRef.current(); return false; }, busy ? "Importing" : error ? `Retry ${count}` : `Import ${count}`);
    else gate(null);
    return () => gate(null);
  }, [gate, imported, nothing, count, busy, error]);
  const folderMenu = (x: number, y: number): void => {
    const total = (found ?? []).length;
    const entries: MenuEntry[] = [{ label: "All folders", checked: folder === "", count: total, onSelect: () => setFolder("") }, { separator: true }];
    for (const f of folders) entries.push({ label: f.name, checked: folder === f.name, count: f.count, onSelect: () => setFolder(f.name) });
    menu.show(entries, x, y, "other");
  };
  const rows: ReactElement[] = [];
  for (const src of shown) {
    const ticked = on.has(src.sessionKey);
    const dir = folderName(src.cwd), when = relativeDate(modifiedAt(src.updatedAt), now);
    rows.push(
      <Row
        key={src.sessionKey} id={`session-${src.sessionKey}`} title={sessionName(src)} note={[dir, when].filter(Boolean).join(" \u00b7 ") || "Local session"} selected={ticked}
        domProps={{ role: "checkbox", "aria-checked": ticked, ...(src.cwd ? { title: src.cwd } : {}) }}
        leading={<View style={[s.box, ticked && s.boxOn]}>{ticked ? <Text style={s.tick}>{"\u2713"}</Text> : null}</View>}
        trailing={<View style={s.source}><Mark k={src.provider === "codex" ? "openai" : "claude"} size={14} /><Text style={s.sourceText}>{label(src)}</Text></View>}
        onPress={() => toggle(src.sessionKey)}
      />,
    );
  }
  if (imported !== null) {
    return (
      <View testID="sessions-card" style={s.col}>
        <Text testID="sessions-imported" accessibilityRole="text" style={s.name}>{importedNote(imported.count, imported.empty)}</Text>
        {onOpenChats ? <Pressable testID="sessions-open-chats" accessibilityRole="link" onPress={onOpenChats} style={s.ghost}><Text style={s.ghostText}>Open Chats</Text></Pressable> : null}
      </View>
    );
  }
  const any = (found ?? []).length > 0;
  return (
    <View testID="sessions-card" style={s.col}>
      {found === null ? <Text style={s.note}>Looking</Text> : null}
      {nothing ? <Text testID="sessions-none" style={s.note}>No Claude Code or Codex sessions on this computer.</Text> : null}
      {any ? (
        <View style={s.bar}>
          <Pressable testID="sessions-all" accessibilityRole="checkbox" accessibilityLabel="Select all" aria-checked={all === "all" ? true : all === "some" ? "mixed" : false} accessibilityState={{ checked: all === "all" ? true : all === "some" ? "mixed" : false }} onPress={toggleAll} style={s.allRow}>
            <View style={[s.box, all !== "none" && s.boxOn]}><Text style={s.tick}>{all === "all" ? "\u2713" : all === "some" ? "-" : ""}</Text></View>
            <Text style={s.allText}>Select all</Text>
          </Pressable>
          {folders.length > 1 ? (
            <Pressable testID="sessions-folder" accessibilityRole="button" accessibilityLabel={`Filter by folder, ${folderMenuLabel(folder)}`} onPress={(e) => { const p = pointOf(e); folderMenu(p.x, p.y); }} style={({ hovered }: { hovered?: boolean }) => [s.filter, hovered === true && s.filterOver]}>
              <Text style={[s.filterText, folder !== "" && s.filterLit]} numberOfLines={1}>{folderMenuLabel(folder)}</Text>
              <Text style={s.chev}>{"\u25be"}</Text>
            </Pressable>
          ) : null}
          <View style={s.flex} />
          <Text testID="sessions-count" style={s.count}>{`${count} of ${(found ?? []).length} selected`}</Text>
        </View>
      ) : null}
      {rows.length > 0 ? <View testID="sessions-list" style={s.list}>{rows}</View> : null}
      {error ? <Text accessibilityRole="alert" testID="sessions-error" style={s.err}>{error}</Text> : null}
      {!gate && rows.length > 0 ? <Pressable testID="sessions-import" accessibilityRole="button" disabled={busy || count === 0} onPress={() => void run()} style={[s.primary, (busy || count === 0) && s.off]}><Text style={[s.primaryText, (busy || count === 0) && s.offText]}>{busy ? "Importing" : count === 0 ? "Import" : error ? `Retry ${count}` : `Import ${count}`}</Text></Pressable> : null}
      {menu.element}
    </View>
  );
}

const s = StyleSheet.create({
  col: { gap: 10 },
  flex: { flex: 1 },
  list: { maxHeight: 300, overflow: "scroll", borderRadius: 12, borderWidth: 1, borderColor: "var(--line)" as string, padding: 4, backgroundColor: "var(--win)" as string } as object,
  box: { width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: "var(--line-2)" as string, alignItems: "center", justifyContent: "center", marginRight: 10 },
  boxOn: { backgroundColor: "var(--accent)" as string, borderColor: "var(--accent)" as string },
  tick: { color: "var(--accent-ink)" as string, fontSize: 12, lineHeight: 14 },
  name: { fontSize: 13.5, fontWeight: "500", color: "var(--ink)" as string },
  source: { flexDirection: "row", alignItems: "center", gap: 5 },
  sourceText: { fontSize: 12, color: "var(--ink-3)" as string },
  bar: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 2 },
  allRow: { flexDirection: "row", alignItems: "center", height: 28 },
  allText: { fontSize: 13, fontWeight: "500", color: "var(--ink)" as string },
  filter: { flexDirection: "row", alignItems: "center", gap: 4, height: 28, paddingHorizontal: 8, borderRadius: 7, maxWidth: 220 },
  filterOver: { backgroundColor: "var(--hover)" as string },
  filterText: { fontSize: 13, color: "var(--ink-2)" as string, flexShrink: 1 },
  filterLit: { color: "var(--accent)" as string },
  chev: { fontSize: 10, color: "var(--ink-3)" as string },
  count: { fontSize: 12.5, color: "var(--ink-3)" as string },
  note: { flex: 1, fontSize: 12.5, color: "var(--ink-3)" as string },
  err: CARD.err,
  primary: CARD.primary,
  primaryText: CARD.primaryText,
  ghost: { ...CARD.ghost, alignSelf: "flex-start" },
  ghostText: CARD.ghostText,
  off: CARD.off,
  offText: CARD.offText,
});
