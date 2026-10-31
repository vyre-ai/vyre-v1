// Right pane > Comments (the pieces): the field that takes a comment with its @mention picker, and one thread. Comments are notes on the record that everyone who can see it reads: a person
// @mentioned gets a request in Needs you, an agent @mentioned answers under the comment on its own, and "Intake is replying" shows while it works.
import { createElement, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { CommentReply } from "../../../../../../ui/src/CommentReply/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { Tooltip } from "../../../../../../ui/src/Tooltip/index.tsx";
import type { PickEntry } from "../../../../../../ui/src/PeoplePicker/index.tsx";
import { ago } from "../recordpage/model.ts";
import { candidates, insertMention, kindOfId, mentionPieces, mentionQuery, mentionsIn, replyingLine } from "./model.ts";
import type { Comment, Mention, Thread } from "./model.ts";

export interface CommentApi {
  now(): number;
  nameOf(id: string): string;
  meId: string;
  people: readonly PickEntry[];
  add(text: string, mentions: Mention[], parentId?: string): Promise<void>;
  edit(commentId: string, text: string): Promise<void>;
  resolve(commentId: string, resolved: boolean): Promise<void>;
  remove(commentId: string): Promise<void>;
}

function Glyph({ name }: { name: "check" | "undo" | "more" }): ReactElement | null {
  if (Platform.OS !== "web") return null;
  const d = name === "check" ? "M3 8.5l3 3 7-7" : name === "undo" ? "M5.5 3.5L3 6l2.5 2.5M3 6h6a3.5 3.5 0 010 7H6" : "M3.5 8h.01M8 8h.01M12.5 8h.01";
  return createElement("svg", { viewBox: "0 0 16 16", width: 14, height: 14, "aria-hidden": true, style: { display: "block", stroke: "var(--ink-3)", strokeWidth: name === "more" ? 2.4 : 1.4, fill: "none", strokeLinecap: "round", strokeLinejoin: "round" } }, createElement("path", { d }));
}

/** The field a comment or reply is written in. Typing @ opens the people and agents; a press or Enter takes one. Enter otherwise sends, Shift-Enter makes a new line. A refused post keeps the text. */
export function MentionField({ api, id, placeholder, onSend }: { api: CommentApi; id: string; placeholder: string; onSend(text: string, mentions: Mention[]): Promise<void> }): ReactElement {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const q = mentionQuery(value);
  const list = q ? candidates(api.people, q.query) : [];
  const send = (text: string): void => {
    // Enter with the picker open takes the first name instead of sending the half-typed @. The field's own text decides (the sent text is trimmed, so "@Intake " would look unfinished).
    const first = list[0];
    if (first) { setValue(insertMention(value, first.name)); return; }
    setBusy(true);
    setFailed(false);
    onSend(text, mentionsIn(text, api.people)).then(
      () => { setBusy(false); setValue(""); },
      () => { setBusy(false); setFailed(true); setValue(text); },
    );
  };
  return (
    <View style={s.field} testID={`comment-field-${id}`}>
      {list.length ? (
        <View style={s.pick} testID={`mention-picker-${id}`}>
          {/* ui-rows-lint: not a list (at most six names under the field) */}
          {list.map((e) => (
            <View key={e.id} style={{ height: 30 }}>
              <Row id={`mention-${id}-${e.id}`} title={e.name} {...(e.sub ? { titleSuffix: e.sub } : {})} leading={<View style={s.face}><Avatar name={e.name} seedId={e.id} kind={e.kind} size={18} /></View>} onPress={() => setValue((v) => insertMention(v, e.name))} />
            </View>
          ))}
        </View>
      ) : null}
      <CommentReply threadId={id} value={value} placeholder={placeholder} disabled={busy} density="regular" onChange={(t) => setValue(t)} onSend={(t) => send(t)} testID={`comment-reply-${id}`} />
      {failed ? <Text accessibilityRole="alert" testID={`comment-error-${id}`} style={s.error}>Could not post. Try again</Text> : null}
    </View>
  );
}

function Body({ c, api }: { c: Comment; api: CommentApi }): ReactElement {
  const names = [...api.people.map((p) => p.name)];
  const pieces = mentionPieces(c.text, names);
  const kids: ReactElement[] = [];
  pieces.forEach((p, i) => kids.push(<Text key={i} style={p.mention ? s.mention : undefined}>{p.text}</Text>));
  return <Text selectable style={s.text}>{kids}{c.editedAt !== undefined ? <Text style={s.edited}> (edited)</Text> : null}</Text>;
}

function One({ c, api, root }: { c: Comment; api: CommentApi; root: boolean }): ReactElement {
  const [editing, setEditing] = useState(false);
  const menu = useMenu();
  const mine = c.by === api.meId;
  const items = (): MenuEntry[] => [
    ...(mine ? [{ label: "Edit", onSelect: () => setEditing(true) } as MenuEntry] : []),
    ...(mine ? [{ label: "Delete", danger: true, onSelect: () => void api.remove(c.commentId).catch(() => undefined) } as MenuEntry] : []),
  ];
  const entries = items();
  const more = (e: unknown): void => {
    const ev = e as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } }; nativeEvent?: { pageX?: number; pageY?: number } };
    const box = ev.currentTarget?.getBoundingClientRect?.();
    menu.show(entries, box ? box.left : ev.nativeEvent?.pageX ?? 0, box ? box.bottom + 4 : ev.nativeEvent?.pageY ?? 0, "other");
  };
  return (
    <View style={s.comment} testID={`comment-${c.commentId}`}>
      <View style={s.head}>
        <Avatar name={api.nameOf(c.by)} seedId={c.by} kind={kindOfId(c.by)} size={20} />
        <Text numberOfLines={1} style={s.who}>{api.nameOf(c.by)}</Text>
        <Text style={s.when}>{ago(c.at, api.now())}</Text>
        <View style={{ flex: 1 }} />
        {root ? (
          <Tooltip text={c.resolved ? "Reopen" : "Resolve"}>
            <Pressable accessibilityRole="button" accessibilityLabel={c.resolved ? "Reopen" : "Resolve"} testID={`${c.resolved ? "reopen" : "resolve"}-${c.commentId}`} onPress={() => void api.resolve(c.commentId, !c.resolved).catch(() => undefined)} style={({ hovered }: { hovered?: boolean }) => [s.tool, hovered === true && s.toolOver]}>
              <Glyph name={c.resolved ? "undo" : "check"} />
            </Pressable>
          </Tooltip>
        ) : null}
        {entries.length ? (
          <Tooltip text="More">
            <Pressable accessibilityRole="button" accessibilityLabel="More" testID={`more-${c.commentId}`} onPress={more} style={({ hovered }: { hovered?: boolean }) => [s.tool, hovered === true && s.toolOver]}><Glyph name="more" /></Pressable>
          </Tooltip>
        ) : null}
      </View>
      {editing ? (
        <EditField c={c} api={api} done={() => setEditing(false)} />
      ) : <Body c={c} api={api} />}
      {menu.element}
    </View>
  );
}

function EditField({ c, api, done }: { c: Comment; api: CommentApi; done(): void }): ReactElement {
  const [failed, setFailed] = useState(false);
  return (
    <View style={{ gap: 4 }}>
      <CommentReply
        threadId={`edit-${c.commentId}`} value={c.text} placeholder="Edit" disabled={false} density="regular" testID={`edit-field-${c.commentId}`}
        onSend={(t) => { api.edit(c.commentId, t).then(done, () => setFailed(true)); }}
      />
      {failed ? <Text accessibilityRole="alert" style={s.error}>Could not save. Try again</Text> : null}
      <Text accessibilityRole="button" testID={`edit-cancel-${c.commentId}`} onPress={done} style={s.cancel}>Cancel</Text>
    </View>
  );
}

/** A thread: the root, its replies, who is replying, and the one reply field at the end. */
export function ThreadView({ t, api }: { t: Thread; api: CommentApi }): ReactElement {
  const replying = [...new Set([t.root, ...t.replies].flatMap((c) => c.replying))];
  const kids: ReactElement[] = [];
  for (const r of t.replies) kids.push(<View key={r.commentId} style={s.reply}><One c={r} api={api} root={false} /></View>);
  return (
    <View style={[s.thread, t.root.resolved && s.resolved]} testID={`thread-${t.root.commentId}`}>
      <One c={t.root} api={api} root />
      {kids}
      {t.root.resolved ? <Text style={s.by} testID={`resolved-by-${t.root.commentId}`}>{`Resolved${t.root.resolvedBy ? ` by ${api.nameOf(t.root.resolvedBy)}` : ""}`}</Text> : null}
      {replying.length ? <Text style={s.replying} testID={`replying-${t.root.commentId}`}>{replyingLine(replying, api.nameOf)}</Text> : null}
      {!t.root.resolved ? (
        <View style={s.replyField}>
          <MentionField api={api} id={t.root.commentId} placeholder="Reply" onSend={(text, mentions) => api.add(text, mentions, t.root.commentId)} />
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  field: { gap: 6 },
  pick: { borderRadius: 10, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line)" as string, paddingVertical: 3 },
  face: { marginRight: 6, width: 18, height: 18 },
  thread: { gap: 6, paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  resolved: { opacity: 0.6 },
  comment: { gap: 4 },
  head: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 24 },
  who: { fontSize: 12.5, fontWeight: "600", color: "var(--ink)" as string, flexShrink: 1 },
  when: { fontSize: 11.5, color: "var(--ink-3)" as string },
  text: { fontSize: 13, lineHeight: 19, color: "var(--ink)" as string },
  mention: { color: "var(--accent)" as string, fontWeight: "500" },
  edited: { fontSize: 11.5, color: "var(--ink-3)" as string },
  tool: { width: 22, height: 22, borderRadius: 5, alignItems: "center", justifyContent: "center" },
  toolOver: { backgroundColor: "var(--hover)" as string },
  reply: { marginLeft: 14, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: "var(--line)" as string },
  replyField: { marginTop: 2 },
  by: { fontSize: 11.5, color: "var(--ink-3)" as string },
  replying: { fontSize: 12, color: "var(--accent)" as string },
  error: { fontSize: 12.5, color: "var(--danger)" as string },
  cancel: { fontSize: 12, color: "var(--ink-3)" as string },
});
