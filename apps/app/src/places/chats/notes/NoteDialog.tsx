// The note opened over the grid: the layer dims the page (a press on the dimmed area closes it), the card shows the picture, the title and the text to edit in place (saved as you type),
// a clipped page's quote and address, the link card, what the note was turned into, where it was saved from, its labels and who sees it, then one row: Ask about this note, Turn into task, Turn into
// record, colour, image, share, more. The pin and an X sit at the top right. Esc or Cmd-Enter closes it (the page owns those keys). A note shared with you to view is read here, not edited.
import { useEffect, useRef, useState } from "react";
import type { ComponentRef, ReactElement, ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Tooltip } from "../../../../../../ui/src/Tooltip/index.tsx";
import { menuTrigger } from "../../../../../../ui/src/Menu/index.tsx";
import { Ico } from "./icons.tsx";
import { noteFill } from "./look.ts";
import { agentWords, fromLine, openable, shareWords } from "./model.ts";
import type { Note, Who } from "./model.ts";
import { Btn, IconBtn, LinkCard, Picture, Quote, Source, dom, pressPoint, web } from "./parts.tsx";

/** The dimmed layer over the page that every sheet and the opened note sit on. A press on the dimmed area closes the top one. */
export function Layer({ onClose, children, testID, label }: { onClose(): void; children: ReactNode; testID: string; label: string }): ReactElement {
  return (
    <View style={s.layer} testID={testID} {...dom({ dataSet: { nlayer: "true" } })}>
      <ScrollView style={s.scroll} contentContainerStyle={s.scrollIn} keyboardShouldPersistTaps="handled">
        <Pressable accessibilityLabel={`Close ${label}`} accessible={false} onPress={onClose} style={StyleSheet.absoluteFill} testID={`${testID}-scrim`} {...dom({ tabIndex: -1 })} />
        {children}
      </ScrollView>
    </View>
  );
}

export interface DialogActions {
  title(v: string): void;
  body(v: string): void;
  pin(): void;
  colour(x: number, y: number): void;
  labels(x: number, y: number): void;
  image(): void;
  share(): void;
  menu(x: number, y: number): void;
  ask(): void;
  task(): void;
  record(): void;
  close(): void;
  openLinked(kind: "task" | "record", id: string): void;
  openUrl(url: string): void;
  /** Open the chat message the note was saved from. */
  openFrom(threadId: string, messageId: string): void;
}

export function NoteDialog({ n, image, who, edited, from, a }: { n: Note; image: string | null; who: Who; edited: string; from?: ReturnType<typeof fromLine>; a: DialogActions }): ReactElement {
  const [title, setTitle] = useState(n.title);
  const [body, setBody] = useState(n.body);
  const [bodyH, setBodyH] = useState(60);
  const bodyRef = useRef<ComponentRef<typeof TextInput> | null>(null);
  // the caret goes to the end of the text when the note opens
  useEffect(() => { const t = setTimeout(() => bodyRef.current?.focus?.(), 30); return () => clearTimeout(t); }, [n.noteId]);
  const words = shareWords(n, who);
  const ro = !n.canEdit;
  const menu = menuTrigger(a.menu);
  return (
    <Layer onClose={a.close} testID="note-layer" label="the note">
      <View style={s.stack}>
        {n.clip ? (
          <View style={s.cap} testID="note-clip-caption">
            <Ico name="clip" size={13} color="rgba(255,255,255,0.82)" />
            <Text style={s.capText}>{`Clipped with Vyre for Chrome · ${edited.replace(/^(Clipped|Edited) /, "")}`}</Text>
          </View>
        ) : null}
        <View role="dialog" aria-modal accessibilityLabel={n.title || "Note"} testID="note-dialog" style={[s.card, { backgroundColor: noteFill(n.color) }]}>
          {n.hasImage ? <View {...menu}><Picture uri={image} alt={n.clip ? "Screenshot of the clipped page" : "Pasted image"} maxHeight={300} testID="note-dialog-image" /></View> : null}
          <TextInput
            value={title} editable={!ro} onChangeText={(v) => { setTitle(v); a.title(v); }} placeholder="Title" placeholderTextColor="var(--ink-3)" accessibilityLabel="Title" testID="note-title"
            style={s.mt} onKeyPress={(e) => { if ((e.nativeEvent as { key?: string }).key === "Enter") { (e as unknown as { preventDefault?: () => void }).preventDefault?.(); bodyRef.current?.focus?.(); } }}
          />
          {/* the pin and the X sit together at the top right; Esc and a press outside close the note too, and it is saved as you type */}
          <View style={s.pin}>
            <IconBtn icon={n.pinned ? "pinf" : "pin"} label={n.pinned ? "Unpin" : "Pin"} onPress={() => a.pin()} color={n.pinned ? "var(--ink)" : "var(--ink-3)"} over testID="note-dialog-pin" />
            <IconBtn icon="x" label="Close (Esc)" onPress={() => a.close()} over testID="note-dialog-close" />
          </View>
          <TextInput
            ref={bodyRef} value={body} editable={!ro} multiline onChangeText={(v) => { setBody(v); a.body(v); }} accessibilityLabel="Note" testID="note-body" placeholder="Note" placeholderTextColor="var(--ink-3)"
            onContentSizeChange={(e) => setBodyH(Math.max(60, Math.ceil(e.nativeEvent.contentSize.height)))} style={[s.mb, { height: bodyH }]}
          />
          {/* a right-click on the text keeps the browser's menu; anywhere else it opens the note menu */}
          <View {...menu}>
          {n.clip ? (
            <View style={s.pad}>
              {n.clip.selection ? <Quote text={n.clip.selection} /> : null}
              <Source icon="clip" url={n.clip.url}>
                {openable(n.clip.url) ? <Pressable accessibilityRole="link" onPress={() => a.openUrl(openable(n.clip!.url)!)} testID="note-open-page" style={{ marginLeft: 6 }}><Text style={s.ref}>Open page</Text></Pressable> : null}
              </Source>
            </View>
          ) : null}
          {n.link ? <View style={[s.pad, { paddingTop: 4 }]}><LinkCard link={n.link} noteId={n.noteId} row={false} testID="note-dialog-link" /></View> : null}
          {/* ui-rows-lint: not a list (the task or record made from this note, one line each with Open) */}
          {n.linked.map((l) => (
            <View key={`${l.kind}:${l.id}`} style={s.pad}>
              <View style={s.linked}>
                <Ico name={l.kind === "task" ? "task" : "record"} size={13} color="var(--ink-3)" />
                <Text numberOfLines={1} style={s.linkedText}>{l.title}</Text>
                <Pressable accessibilityRole="link" onPress={() => a.openLinked(l.kind, l.id)} testID={`note-linked-open-${l.id}`}><Text style={s.ref}>Open</Text></Pressable>
              </View>
            </View>
          ))}
          {from ? (
            <View style={s.pad}>
              <View style={s.from} testID="note-from">
                <Ico name="chat" size={13} color="var(--ink-3)" />
                <Text numberOfLines={1} style={s.linkedText}>{from.text}</Text>
                {from.open ? <Pressable accessibilityRole="link" onPress={() => a.openFrom(from.open!.threadId, from.open!.messageId)} testID="note-from-open"><Text style={s.ref}>Open message</Text></Pressable> : null}
              </View>
            </View>
          ) : null}
          <View style={s.meta}>
            <Pressable accessibilityRole="button" accessibilityLabel="Labels" onPress={(e) => { const p = pressPoint(e); a.labels(p.x, p.y); }} style={s.lbx} testID="note-dialog-labels" {...dom({ dataSet: { nbtn: "ghost" } })}>
              <Ico name="tag" size={13} color="var(--ink-3)" /><Text style={s.metaText}>{n.labels.length ? n.labels.join(", ") : "Add a label"}</Text>
            </Pressable>
            <Tooltip text={agentWords(n, who)}>
              <Pressable accessibilityRole="button" accessibilityLabel={words.long} onPress={() => (n.mine ? a.share() : undefined)} style={s.lbx} testID="note-dialog-who" {...dom({ dataSet: { nbtn: "ghost" } })}>
                <Ico name={words.icon} size={13} color="var(--ink-3)" /><Text style={s.metaText}>{words.long}</Text>
              </Pressable>
            </Tooltip>
            <View style={{ flex: 1 }} />
            <Text style={s.metaText} testID="note-edited">{edited}</Text>
          </View>
          {/* one row: what to do with the note, then colour, image, share and more (labels are the chip above) */}
          <View style={s.acts}>
            <Btn label="Ask about this note" icon="ask" sm onPress={() => a.ask()} title="Ask about this note (A)" testID="note-dialog-ask" />
            <Btn label="Turn into task" icon="task" sm onPress={() => a.task()} title="Turn into a task (T)" testID="note-dialog-task" />
            <Btn label="Turn into record" icon="record" sm onPress={() => a.record()} title="Turn into a record (R)" testID="note-dialog-record" />
            <View style={{ flex: 1 }} />
            {ro ? null : <IconBtn icon="palette" label="Colour" onPress={a.colour} testID="note-dialog-colour" />}
            {ro ? null : <IconBtn icon="image" label="Add an image" onPress={() => a.image()} testID="note-dialog-image-btn" />}
            {n.mine ? <IconBtn icon="share" label="Share" onPress={() => a.share()} testID="note-dialog-share" /> : null}
            <IconBtn icon="more" label="More" onPress={a.menu} testID="note-dialog-more" />
          </View>
          </View>
        </View>
      </View>
    </Layer>
  );
}

const s = StyleSheet.create({
  layer: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, zIndex: 20, backgroundColor: "var(--n-scrim)" as string },
  scroll: { flex: 1 },
  scrollIn: { flexGrow: 1, alignItems: "center", justifyContent: "center", paddingVertical: 24, paddingHorizontal: 24 },
  stack: { width: "100%", maxWidth: 620, alignItems: "center" },
  cap: { width: "100%", flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  capText: { fontSize: 12, color: "rgba(255,255,255,0.82)" },
  card: { width: "100%", borderRadius: 16, overflow: "hidden", position: "relative", ...(web ? ({ boxShadow: "var(--sh-pop)" } as object) : null) },
  mt: { width: "100%", fontSize: 20, lineHeight: 27, fontWeight: "600", letterSpacing: -0.2, color: "var(--ink)" as string, paddingTop: 18, paddingRight: 84, paddingLeft: 20, paddingBottom: 4, ...(web ? ({ outlineStyle: "none" } as object) : null) },
  pin: { position: "absolute", top: 12, right: 12, flexDirection: "row", gap: 2, zIndex: 2 },
  mb: { width: "100%", fontSize: 15, lineHeight: 24, color: "var(--ink)" as string, paddingTop: 6, paddingHorizontal: 20, paddingBottom: 8, ...(web ? ({ outlineStyle: "none", resize: "none" } as object) : null) },
  pad: { paddingHorizontal: 20 },
  ref: { fontSize: 11.5, color: "var(--accent)" as string },
  from: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 8 },
  linked: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  linkedText: { flex: 1, fontSize: 12, color: "var(--ink-2)" as string },
  meta: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap", paddingTop: 10, paddingHorizontal: 20, paddingBottom: 4 },
  lbx: { flexDirection: "row", alignItems: "center", gap: 5, height: 24, paddingHorizontal: 6, marginLeft: -6, borderRadius: 6 },
  metaText: { fontSize: 12, color: "var(--ink-3)" as string },
  acts: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", paddingTop: 12, paddingHorizontal: 16, paddingBottom: 12, borderTopWidth: 1, borderTopColor: "var(--line)" as string, marginTop: 10 },
});
