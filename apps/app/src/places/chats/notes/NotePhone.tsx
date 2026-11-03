// Notes on a phone: the note opened as its own page (Back to Notes, pin and share at the top, the text to edit, labels and who sees it, a bar at the foot with colour, labels, image,
// when it was edited and More), and the action sheet a long press or More opens: Ask about this note, Turn into task, Turn into record, Share, Pin, Make a copy, Delete. The sheet's rows
// are the note menu's own entries (ui/Menu entries drawn as ui/Row), so the phone and the computer offer the same actions.
import { MarkdownEditor } from "../../../../../../ui/src/RichEditor/index.tsx";
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { MenuIcon } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry, MenuItem } from "../../../../../../ui/src/Menu/index.tsx";
import { Ico } from "./icons.tsx";
import { noteFill } from "./look.ts";
import { fromLine, shareWords } from "./model.ts";
import type { Note, Who } from "./model.ts";
import { IconBtn, LinkCard, Picture, Quote, dom, web } from "./parts.tsx";

const isItem = (e: MenuEntry): e is MenuItem => "label" in e;

/** The note's actions as a sheet over the phone: the menu's rows, big enough for a thumb; a tap outside closes it. */
export function ActionSheet({ entries, onClose }: { entries: readonly MenuEntry[]; onClose(): void }): ReactElement {
  // the rows between separators, each group drawn under a rule
  const groups: MenuItem[][] = [[]];
  for (const e of entries) { if (isItem(e)) groups[groups.length - 1]!.push(e); else if (groups[groups.length - 1]!.length) groups.push([]); }
  return (
    <View style={s.sheetLayer} testID="note-action-sheet" {...dom({ dataSet: { nlayer: "true" } })}>
      <Pressable accessibilityLabel="Close" onPress={onClose} style={s.scrim} testID="note-action-scrim" />
      <View role="menu" style={s.sheet}>
        {/* ui-rows-lint: not a list (the sheet's groups, each one a list of ui/Row) */}
        {groups.map((g, gi) => (
          <View key={gi} style={gi > 0 ? s.dv : null}>
            {g.map((e) => (
              <Row
                key={e.label} id={`note-act-${e.label.toLowerCase().replace(/\s+/g, "-")}`} title={e.label}
                leading={<View style={s.sheetIcon}>{e.icon ? <MenuIcon icon={e.icon} size={18} color={e.danger ? "var(--danger)" : "var(--ink-3)"} /> : null}</View>}
                onPress={() => { onClose(); e.onSelect?.(); }}
              />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

export interface PhoneNoteActions {
  back(): void;
  pin(): void;
  share(): void;
  colour(x: number, y: number): void;
  labels(x: number, y: number): void;
  image(): void;
  more(): void;
  title(v: string): void;
  body(v: string): void;
  openFrom(threadId: string, messageId: string): void;
}

export function PhoneNote({ n, image, who, edited, from, a }: { n: Note; image: string | null; who: Who; edited: string; from?: ReturnType<typeof fromLine>; a: PhoneNoteActions }): ReactElement {
  const [title, setTitle] = useState(n.title);
  const [body, setBody] = useState(n.body);
  const words = shareWords(n, who);
  const fill = noteFill(n.color);
  return (
    <View style={[s.page, { backgroundColor: fill }]} testID="note-phone-page">
      <View style={s.nav}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to Notes" onPress={a.back} style={s.back} testID="note-phone-back">
          <Ico name="back" size={18} color="var(--accent)" />
          <Text style={s.backText}>Notes</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        <IconBtn icon={n.pinned ? "pinf" : "pin"} label={n.pinned ? "Unpin" : "Pin"} size={40} iconSize={20} color="var(--ink-2)" onPress={() => a.pin()} testID="note-phone-pin" />
        {n.mine ? <IconBtn icon="share" label="Share" size={40} iconSize={20} color="var(--ink-2)" onPress={() => a.share()} testID="note-phone-share" /> : null}
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.body}>
        {n.hasImage ? <View style={s.bleed}><Picture uri={image} alt="Note image" /></View> : null}
        <TextInput value={title} editable={n.canEdit} onChangeText={(v) => { setTitle(v); a.title(v); }} placeholder="Title" placeholderTextColor="var(--ink-3)" accessibilityLabel="Title" style={s.title} testID="note-phone-title" />
        <MarkdownEditor testID="note-phone-body" label="Note" value={body} mode={n.canEdit ? "edit" : "read"} onChange={(v) => { setBody(v); a.body(v); }} placeholder="Note" bare density="compact" minHeight={100} />
        {n.clip?.selection?.trim() ? <Quote text={n.clip.selection.trim()} big /> : null}
        {n.link ? <LinkCard link={n.link} noteId={n.noteId} /> : null}
        {from ? (
          <View style={s.metaRow} testID="note-from">
            <Ico name="chat" size={14} color="var(--ink-3)" />
            <Text numberOfLines={1} style={[s.metaText, { flexShrink: 1 }]}>{from.text}</Text>
            {from.open ? <Pressable accessibilityRole="link" onPress={() => a.openFrom(from.open!.threadId, from.open!.messageId)} testID="note-from-open"><Text style={s.fromOpen}>Open message</Text></Pressable> : null}
          </View>
        ) : null}
        <View style={s.meta}>
          <View style={s.metaRow}><Ico name="tag" size={14} color="var(--ink-3)" /><Text style={s.metaText}>{n.labels.join(", ") || "No labels"}</Text></View>
          <View style={s.metaRow}><Ico name={words.icon} size={14} color="var(--ink-3)" /><Text style={s.metaText}>{words.long}</Text></View>
        </View>
      </ScrollView>
      <View style={[s.bar, { backgroundColor: fill }]}>
        {n.canEdit ? <IconBtn icon="palette" label="Colour" size={40} iconSize={22} onPress={a.colour} testID="note-phone-colour" /> : null}
        <IconBtn icon="tag" label="Labels" size={40} iconSize={22} onPress={a.labels} testID="note-phone-labels" />
        {n.canEdit ? <IconBtn icon="image" label="Add an image" size={40} iconSize={22} onPress={() => a.image()} testID="note-phone-image" /> : null}
        <View style={{ flex: 1 }} />
        <Text style={s.ed}>{edited}</Text>
        <View style={{ flex: 1 }} />
        <IconBtn icon="more" label="More" size={40} iconSize={22} onPress={() => a.more()} testID="note-phone-more" />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  page: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, zIndex: 20 },
  nav: { height: 44, flexDirection: "row", alignItems: "center", paddingHorizontal: 8, gap: 4 },
  back: { flexDirection: "row", alignItems: "center", gap: 2, height: 40, paddingRight: 8 },
  backText: { fontSize: 16, color: "var(--accent)" as string },
  body: { paddingHorizontal: 20, paddingBottom: 120 },
  bleed: { marginHorizontal: -20, marginBottom: 12 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: "700", letterSpacing: -0.3, color: "var(--ink)" as string, marginTop: 6, marginBottom: 8, ...(web ? ({ outlineStyle: "none" } as object) : null) },
  text: { fontSize: 16, lineHeight: 25, color: "var(--ink)" as string, ...(web ? ({ outlineStyle: "none", resize: "none" } as object) : null) },
  meta: { gap: 6, marginTop: 18 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  fromOpen: { fontSize: 13, color: "var(--accent)" as string },
  metaText: { fontSize: 13, color: "var(--ink-3)" as string },
  bar: { height: 84, flexDirection: "row", alignItems: "flex-start", gap: 4, paddingTop: 8, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  ed: { fontSize: 12, color: "var(--ink-3)" as string, alignSelf: "center", marginTop: -26 },
  sheetLayer: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, zIndex: 30 },
  scrim: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: "var(--n-scrim)" as string },
  sheet: { position: "absolute", left: 8, right: 8, bottom: 8, borderRadius: 22, backgroundColor: "var(--raised)" as string, padding: 8, ...(web ? ({ boxShadow: "var(--sh-pop)" } as object) : null) },
  sheetIcon: { width: 22, height: 46, marginRight: 12, alignItems: "center", justifyContent: "center" },
  dv: { borderTopWidth: 1, borderTopColor: "var(--line)" as string, marginTop: 4, paddingTop: 4 },
});
