// The "Bring your sessions" step on the desktop app: the Claude Code and Codex sessions found on this computer, newest first, as checkable rows with a name, folder and date. Importing copies only
// the ticked ones, and the person pressing Import is the confirmation; each session is read just before its own import, as in Settings.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CapCall } from "../shell/session/caps.ts";
import { desktopSessionImporter } from "../../../../client/src/session-import/desktop.ts";
import type { SessionSource } from "../../../../client/src/session-import/parse.ts";
import { confirmedSessionInput } from "../places/settings/session-import-model.ts";
import { Mark } from "./ProviderLogo.tsx";
import { folderChoices, folderName, importedNote, modifiedAt, newestFirst, relativeDate, rememberImported, selectState, sessionName } from "./sessions-model.ts";

const label = (src: SessionSource): string => `${src.provider === "codex" ? "Codex" : "Claude Code"}`;
const hover = (text: string): object => ({ title: text });

export function SessionsCard({ call, onDone, gate, onOpenChats }: { call: CapCall; onDone(): void; gate?(save: (() => Promise<boolean>) | null): void; onOpenChats?(): void }): ReactElement {
  // set once the import is done: the card then says where the sessions are, and Continue (the gate) finishes the step
  const [found, setFound] = useState<SessionSource[] | null>(null);
  const [on, setOn] = useState<ReadonlySet<string>>(new Set());
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [imported, setImported] = useState<number | null>(null);
  useEffect(() => {
    if (!gate || imported === null) return undefined;
    gate(async () => true);
    return () => gate(null);
  }, [gate, imported]);
  useEffect(() => {
    let off = false;
    const imp = desktopSessionImporter();
    if (!imp) { setFound([]); return undefined; }
    void imp.discover().then((r) => { if (!off) setFound(newestFirst(r)); }).catch(() => { if (!off) { setFound([]); setError("Could not look for sessions."); } });
    return () => { off = true; };
  }, []);
  const toggle = (key: string): void => setOn((old) => { const n = new Set(old); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const shown = (found ?? []).filter((src) => !folder || folderName(src.cwd) === folder);
  const shownKeys = shown.map((src) => src.sessionKey);
  const all = selectState(shownKeys, on);
  const toggleAll = (): void => setOn((old) => { const n = new Set(old); for (const k of shownKeys) { if (all === "all") n.delete(k); else n.add(k); } return n; });
  const folders = folderChoices(found ?? []);
  const now = Date.now();
  const run = async (): Promise<void> => {
    const imp = desktopSessionImporter();
    if (!imp || busy || on.size === 0) return;
    setBusy(true); setError("");
    try {
      let count = 0;
      for (const src of found ?? []) {
        if (!on.has(src.sessionKey)) continue;
        const at = Date.now();
        const session = await imp.preview(src);
        await call("sessions.import", confirmedSessionInput({ source: src, session, at }, Date.now()));
        count++;
      }
      rememberImported(count);
      setImported(count);
      if (!gate) onDone();
    } catch (e) { setError(e instanceof Error ? e.message : "That did not work. Try again."); } finally { setBusy(false); }
  };
  const rows: ReactElement[] = [];
  for (const src of shown) {
    const ticked = on.has(src.sessionKey);
    const dir = folderName(src.cwd), when = relativeDate(modifiedAt(src.updatedAt), now);
    rows.push(
      <Pressable key={src.sessionKey} testID={`session-${src.sessionKey}`} accessibilityRole="checkbox" aria-checked={ticked} accessibilityState={{ checked: ticked }} onPress={() => toggle(src.sessionKey)} style={[s.row, ticked && s.rowOn]}>
        <View style={[s.box, ticked && s.boxOn]}>{ticked ? <Text style={s.tick}>{"✓"}</Text> : null}</View>
        <View style={s.text}>
          <Text style={s.name} numberOfLines={1}>{sessionName(src)}</Text>
          <Text style={s.sub} numberOfLines={1} {...hover(src.cwd ?? "")}>{[dir, when].filter(Boolean).join("  ·  ") || "Local session"}</Text>
        </View>
        <View style={s.source}><Mark k={src.provider === "codex" ? "openai" : "claude"} size={14} /><Text style={s.sourceText}>{label(src)}</Text></View>
      </Pressable>,
    );
  }
  if (imported !== null) {
    return (
      <View testID="sessions-card" style={s.col}>
        <Text testID="sessions-imported" accessibilityRole="text" style={s.name}>{importedNote(imported)}</Text>
        {onOpenChats ? <Pressable testID="sessions-open-chats" accessibilityRole="link" onPress={onOpenChats} style={s.primary}><Text style={s.primaryText}>Open Chats</Text></Pressable> : null}
      </View>
    );
  }
  return (
    <View testID="sessions-card" style={s.col}>
      {found === null ? <Text style={s.note}>Looking</Text> : null}
      {found !== null && found.length === 0 ? <Text testID="sessions-none" style={s.note}>None found</Text> : null}
      {(found ?? []).length > 0 ? (
        <View style={s.bar}>
          <Pressable testID="sessions-all" accessibilityRole="checkbox" accessibilityLabel="Select all" aria-checked={all === "all" ? true : all === "some" ? "mixed" : false} accessibilityState={{ checked: all === "all" ? true : all === "some" ? "mixed" : false }} onPress={toggleAll} style={s.allRow}>
            <View style={[s.box, all !== "none" && s.boxOn]}><Text style={s.tick}>{all === "all" ? "✓" : all === "some" ? "-" : ""}</Text></View>
            <Text style={s.allText}>Select all</Text>
          </Pressable>
          <Text testID="sessions-count" style={s.count}>{`${on.size} of ${(found ?? []).length} selected`}</Text>
        </View>
      ) : null}
      {folders.length > 1 ? (
        <View testID="sessions-folders" style={s.chips}>
          {[{ name: "", count: (found ?? []).length }, ...folders.slice(0, 8)].map((f) => (
            <Pressable key={f.name || "all"} testID={`sessions-folder-${f.name || "all"}`} accessibilityRole="button" accessibilityState={{ selected: folder === f.name }} onPress={() => setFolder(f.name)} style={[s.chip, folder === f.name && s.chipOn]}>
              <Text style={s.chipText} numberOfLines={1}>{f.name ? `${f.name} ${f.count}` : "All folders"}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {rows.length > 0 ? <View style={s.list}>{rows}</View> : null}
      {error ? <Text accessibilityRole="alert" testID="sessions-error" style={s.err}>{error}</Text> : null}
      {rows.length > 0 ? <Pressable testID="sessions-import" accessibilityRole="button" disabled={busy || on.size === 0} onPress={() => void run()} style={[s.primary, (busy || on.size === 0) && s.off]}><Text style={s.primaryText}>{busy ? "Importing" : on.size === 0 ? "Import" : `Import ${on.size}`}</Text></Pressable> : null}
    </View>
  );
}

const s = StyleSheet.create({
  col: { gap: 10 },
  list: { gap: 6, maxHeight: 300, overflow: "scroll" } as object,
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 40, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--win)" as string },
  rowOn: { borderColor: "var(--accent-line)" as string, backgroundColor: "var(--accent-wash)" as string },
  box: { width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: "var(--line-2)" as string, alignItems: "center", justifyContent: "center" },
  boxOn: { backgroundColor: "var(--accent)" as string, borderColor: "var(--accent)" as string },
  tick: { color: "#fff", fontSize: 12, lineHeight: 14 },
  text: { flex: 1, minWidth: 0, paddingVertical: 6 },
  name: { fontSize: 13.5, fontWeight: "500", color: "var(--ink)" as string },
  sub: { fontSize: 12, color: "var(--ink-3)" as string },
  source: { flexDirection: "row", alignItems: "center", gap: 5 },
  sourceText: { fontSize: 12, color: "var(--ink-3)" as string },
  bar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 2 },
  allRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  allText: { fontSize: 13, fontWeight: "500", color: "var(--ink)" as string },
  count: { fontSize: 12.5, color: "var(--ink-3)" as string },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { height: 26, paddingHorizontal: 10, borderRadius: 13, borderWidth: 1, borderColor: "var(--line)" as string, justifyContent: "center", maxWidth: 180 },
  chipOn: { borderColor: "var(--accent-line)" as string, backgroundColor: "var(--accent-wash)" as string },
  chipText: { fontSize: 12, color: "var(--ink)" as string },
  note: { flex: 1, fontSize: 12.5, color: "var(--ink-3)" as string },
  err: { fontSize: 13, color: "var(--danger)" as string },
  primary: { height: 34, paddingHorizontal: 16, borderRadius: 8, backgroundColor: "var(--accent)" as string, alignItems: "center", justifyContent: "center", alignSelf: "flex-start" },
  primaryText: { fontSize: 13.5, fontWeight: "500", color: "#fff" },
  off: { opacity: 0.45 },
});
