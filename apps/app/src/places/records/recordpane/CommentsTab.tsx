// Right pane > Comments: the threads on this record, a Resolved filter, and a field at the bottom for a new comment. Resolving a thread hides it from the default view; the filter brings it back.
import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { PickEntry } from "../../../../../../ui/src/PeoplePicker/index.tsx";
import { Tooltip } from "../../../../../../ui/src/Tooltip/index.tsx";
import { useLive, usePageData } from "../recordpage/data.tsx";
import { MentionField, ThreadView } from "./Comments.tsx";
import type { CommentApi } from "./Comments.tsx";
import { PaneEmpty } from "./Empty.tsx";
import { threadsOf } from "./model.ts";
import type { Mention } from "./model.ts";

const key = (): string => `cmt:${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;

export function CommentsTab({ type, recordId }: { type: string; recordId: string }): ReactElement {
  const data = usePageData();
  const [resolved, setResolved] = useState(false);
  const q = useLive("records.comments.list", { type, recordId, includeResolved: resolved });
  const people: readonly PickEntry[] = data.mentionables?.() ?? [];
  const meId = data.me?.id ?? "";
  const api: CommentApi = useMemo(() => ({
    now: data.now, nameOf: data.nameOf, meId, people,
    add: async (text: string, mentions: Mention[], parentId?: string) => { await data.call("records.comments.add", { type, recordId, text, ...(parentId ? { parentId } : {}), ...(mentions.length ? { mentions } : {}), idempotencyKey: key() }); },
    edit: async (commentId: string, text: string) => { await data.call("records.comments.edit", { commentId, text }); },
    resolve: async (commentId: string, r: boolean) => { await data.call("records.comments.resolve", { commentId, resolved: r }); },
    remove: async (commentId: string) => { await data.call("records.comments.delete", { commentId }); },
  }), [data, type, recordId, meId, people]);
  const ready = q.status === "ready";
  const threads = ready ? threadsOf(q.data.comments) : [];
  const hidden = ready ? q.data.resolvedCount : 0;
  const rows: ReactElement[] = [];
  for (const t of threads) rows.push(<ThreadView key={t.root.commentId} t={t} api={api} />);
  return (
    <View style={s.root} testID="pane-comments">
      {hidden > 0 || resolved ? (
        <View style={s.bar}>
          <Tooltip text={resolved ? "Hide resolved threads" : "Show resolved threads"}>
            <Pressable accessibilityRole="button" accessibilityState={{ selected: resolved }} testID="filter-resolved" onPress={() => setResolved(!resolved)} style={({ hovered }: { hovered?: boolean }) => [s.chip, resolved && s.chipOn, hovered === true && s.chipOver]}>
              <Text style={[s.chipText, resolved && s.chipTextOn]}>Resolved{hidden > 0 ? ` ${hidden}` : ""}</Text>
            </Pressable>
          </Tooltip>
        </View>
      ) : null}
      <ScrollView style={s.list} testID="comment-threads">
        {!ready ? <Text style={s.quiet}>Loading</Text> : rows.length ? rows : <PaneEmpty icon="comment" text={resolved ? "Nothing resolved" : "No comments"} testID="pane-comments-empty" />}
      </ScrollView>
      <View style={s.new}><MentionField api={api} id="new" placeholder="Comment, or @ someone" onSend={(text, mentions) => api.add(text, mentions)} /></View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  bar: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: 12, paddingTop: 8 },
  chip: { height: 24, paddingHorizontal: 10, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "var(--line)" as string },
  chipOn: { backgroundColor: "var(--accent-wash)" as string, borderColor: "transparent" },
  chipOver: { backgroundColor: "var(--hover)" as string },
  chipText: { fontSize: 12, color: "var(--ink-3)" as string },
  chipTextOn: { color: "var(--accent)" as string, fontWeight: "600" },
  list: { flex: 1, minHeight: 0 },
  quiet: { fontSize: 13, color: "var(--ink-3)" as string, padding: 16 },
  new: { padding: 10 },
});
