// The "Bring your sessions" step on the desktop app: the Claude Code and Codex sessions found on this computer, as checkable rows. Importing copies only the ticked ones, and the
// person pressing Import is the confirmation; each session is read just before its own import, as in Settings.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CapCall } from "../shell/session/caps.ts";
import { desktopSessionImporter } from "../../../../client/src/session-import/desktop.ts";
import type { SessionSource } from "../../../../client/src/session-import/parse.ts";
import { confirmedSessionInput } from "../places/settings/session-import-model.ts";

const label = (src: SessionSource): string => `${src.provider === "codex" ? "Codex" : "Claude Code"}`;
const where = (src: SessionSource): string => (src.cwd ?? "").split("/").filter(Boolean).slice(-2).join("/") || "Local session";

export function SessionsCard({ call, onDone }: { call: CapCall; onDone(): void }): ReactElement {
  const [found, setFound] = useState<SessionSource[] | null>(null);
  const [on, setOn] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let off = false;
    const imp = desktopSessionImporter();
    if (!imp) { setFound([]); return undefined; }
    void imp.discover().then((r) => { if (!off) setFound(r); }).catch(() => { if (!off) { setFound([]); setError("Could not look for sessions."); } });
    return () => { off = true; };
  }, []);
  const toggle = (key: string): void => setOn((old) => { const n = new Set(old); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const run = async (): Promise<void> => {
    const imp = desktopSessionImporter();
    if (!imp || busy || on.size === 0) return;
    setBusy(true); setError("");
    try {
      for (const src of found ?? []) {
        if (!on.has(src.sessionKey)) continue;
        const at = Date.now();
        const session = await imp.preview(src);
        await call("sessions.import", confirmedSessionInput({ source: src, session, at }, Date.now()));
      }
      onDone();
    } catch (e) { setError(e instanceof Error ? e.message : "That did not work. Try again."); } finally { setBusy(false); }
  };
  const rows: ReactElement[] = [];
  for (const src of found ?? []) {
    const ticked = on.has(src.sessionKey);
    rows.push(
      <Pressable key={src.sessionKey} testID={`session-${src.sessionKey}`} accessibilityRole="checkbox" accessibilityState={{ checked: ticked }} onPress={() => toggle(src.sessionKey)} style={[s.row, ticked && s.rowOn]}>
        <View style={[s.box, ticked && s.boxOn]}>{ticked ? <Text style={s.tick}>{"✓"}</Text> : null}</View>
        <Text style={s.name} numberOfLines={1}>{label(src)}</Text>
        <Text style={s.note} numberOfLines={1}>{where(src)}</Text>
      </Pressable>,
    );
  }
  return (
    <View testID="sessions-card" style={s.col}>
      {found === null ? <Text style={s.note}>Looking</Text> : null}
      {found !== null && found.length === 0 ? <Text testID="sessions-none" style={s.note}>None found</Text> : null}
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
  name: { fontSize: 13.5, fontWeight: "500", color: "var(--ink)" as string },
  note: { flex: 1, fontSize: 12.5, color: "var(--ink-3)" as string },
  err: { fontSize: 13, color: "var(--danger)" as string },
  primary: { height: 34, paddingHorizontal: 16, borderRadius: 8, backgroundColor: "var(--accent)" as string, alignItems: "center", justifyContent: "center", alignSelf: "flex-start" },
  primaryText: { fontSize: 13.5, fontWeight: "500", color: "#fff" },
  off: { opacity: 0.45 },
});
