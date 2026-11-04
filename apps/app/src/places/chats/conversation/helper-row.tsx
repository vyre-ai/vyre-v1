// One row per helper (owner, 4 Nov 2026): the helper's name and status ("Working · 13s", then "Done"), one line of what it found once done, and Open. The same row changes state as the helper works; no
// second card is posted for it (helper-rows.ts folds the report into this row). The helper's full reply is in its own chat, which Open shows.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Glyph } from "./parts.tsx";
import { helperTag } from "../../../../../../ui/src/blocks/impl-b/logic.ts";
import type { MessageBlock } from "./model.ts";

export function helperRowOf(b: Pick<MessageBlock, "data" | "state">): { title: string; threadId: string; status: "running" | "done" | "failed"; found: string; startedAt: number | null } {
  const d = (b.data && typeof b.data === "object" ? b.data : {}) as Record<string, unknown>;
  const s = (k: string): string => (typeof d[k] === "string" ? (d[k] as string) : "");
  const status = d["status"] === "done" || b.state === "done" ? "done" : d["status"] === "failed" || b.state === "error" ? "failed" : "running";
  return { title: s("title") || "Helper", threadId: s("threadId") || s("helperThreadId"), status, found: s("found"), startedAt: typeof d["startedAt"] === "number" ? (d["startedAt"] as number) : null };
}

export function HelperRow({ block, onOpen }: { block: Pick<MessageBlock, "id" | "data" | "state">; onOpen: (threadId: string) => void }): ReactElement {
  const r = helperRowOf(block);
  const [now, setNow] = useState(() => Date.now());
  const live = r.status === "running" && r.startedAt !== null;
  useEffect(() => { if (!live) return undefined; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [live]);
  const tag = helperTag(r.status, r.startedAt, now);
  return (
    <View testID={`helper-row-${block.id}`} accessibilityRole="summary" style={st.row}>
      <View style={st.head}>
        <Glyph name="helper" size={13} />
        <Text numberOfLines={1} style={st.title}>{r.title}</Text>
        <Text testID={`helper-row-${block.id}-state`} style={[st.tag, r.status === "done" && st.ok, r.status === "failed" && st.bad]}>{tag}</Text>
        <Pressable accessibilityRole="link" accessibilityLabel={`Open ${r.title}`} testID={`helper-row-${block.id}-open`} disabled={r.threadId === ""} onPress={() => onOpen(r.threadId)} style={st.open}><Text style={st.openText}>Open</Text></Pressable>
      </View>
      {r.found !== "" ? <Text numberOfLines={2} testID={`helper-row-${block.id}-found`} style={st.found}>{r.found}</Text> : null}
    </View>
  );
}

const st = StyleSheet.create({
  row: { marginVertical: 3, maxWidth: 520, gap: 4, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, boxShadow: "inset 0 0 0 1px var(--line-2)" } as object,
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: "500", color: "var(--ink)" as string },
  tag: { fontSize: 12, fontWeight: "600", color: "var(--ink-3)" as string },
  ok: { color: "var(--ok)" as string },
  bad: { color: "var(--danger)" as string },
  open: { height: 24, paddingHorizontal: 8, borderRadius: 6, justifyContent: "center" },
  openText: { fontSize: 12.5, color: "var(--accent)" as string, fontWeight: "500" },
  found: { fontSize: 13, lineHeight: 19, color: "var(--ink-2)" as string },
});
