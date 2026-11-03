// One note in the grid: its picture (a pasted image or a clipped page's screenshot), title, text (nine lines, six on a phone), a clipped page's quote and address, a link card, what it
// was turned into, then its labels and who sees it. The pin and the toolbar (colour, labels, share, ask, more) fade in with the pointer or the focus. A press opens the note; a right-click
// or Shift F10 opens the note menu (ui/Menu); on a phone a long press opens the action sheet. The card is one stop of the grid's roving focus: the page moves it with the arrows.
import { createElement, memo } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { menuTrigger } from "../../../../../../ui/src/Menu/index.tsx";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { Ico } from "./icons.tsx";
import { noteFill } from "./look.ts";
import { noteName, shareWords } from "./model.ts";
import type { Note, Who } from "./model.ts";
import { Faces, IconBtn, LinkCard, Picture, Quote, Source, dom, web } from "./parts.tsx";

export interface CardActions {
  open(id: string): void;
  pin(id: string): void;
  menu(id: string, x: number, y: number, from: "button" | "context"): void;
  colour(id: string, x: number, y: number): void;
  labels(id: string, x: number, y: number): void;
  share(id: string): void;
  ask(id: string): void;
  focus(id: string): void;
  /** A long press on a phone. */
  sheet(id: string): void;
}

export const NoteCard = memo(function NoteCard({ n, image, who, selected, tabbable, phone = false, covered = false, a }: {
  n: Note; image: string | null; who: Who; selected: boolean; tabbable: boolean; phone?: boolean; /** Its note is open over the grid: the card stays out of sight, so it never shows half hidden beside the note. */ covered?: boolean; a: CardActions;
}): ReactElement {
  const words = shareWords(n, who);
  const tint = n.color !== "";
  const ring = noteFill(n.color);
  const people = n.share.people.map((p) => ({ id: p.personId, name: who.nameOf(p.personId) }));
  const shared = !n.mine
    ? <View style={s.shr}><Avatar name={who.nameOf(n.owner)} seedId={n.owner} kind="person" size={16} /></View>
    : words.icon === "globe" ? <View style={s.shr}><Ico name="globe" size={13} color="var(--ink-3)" /><Text style={s.meta}>Space</Text></View>
    : people.length ? <View style={s.shr}><Faces people={people} ring={ring} /></View> : null;
  const trigger = menuTrigger((x, y) => (phone ? a.sheet(n.noteId) : a.menu(n.noteId, x, y, "context")));
  const card = (
      <Pressable
        accessibilityRole="button" accessibilityLabel={noteName(n)} testID={`note-${n.noteId}`} focusable={!phone && tabbable}
        onPress={() => a.open(n.noteId)} onFocus={() => a.focus(n.noteId)}
        {...(phone ? { onLongPress: () => a.sheet(n.noteId), delayLongPress: 500 } : {})}
        style={[s.card, phone ? s.cardPhone : null, { backgroundColor: ring }]}
        {...dom({ dataSet: { ncard: tint ? "tint" : "plain", nsel: selected ? "true" : "false", noteid: n.noteId }, ...(phone || tabbable ? {} : { tabIndex: -1 }) })}
      >
        {n.hasImage ? <Picture uri={image} alt={n.clip ? "Screenshot of the clipped page" : "Pasted image"} testID={`note-image-${n.noteId}`} /> : null}
        <View style={[s.body, phone ? s.bodyPhone : null]}>
          {n.title ? <Text style={[s.title, n.hasImage || phone ? null : s.titlePinRoom]}>{n.title}</Text> : null}
          {n.body ? <Text numberOfLines={phone ? 6 : 9} style={s.text}>{n.body}</Text> : null}
          {n.clip?.selection ? <Quote text={n.clip.selection} /> : null}
          {n.clip ? <Source icon="clip" url={n.clip.url} /> : null}
          {n.link ? <LinkCard link={n.link} noteId={n.noteId} compact /> : null}
          {/* ui-rows-lint: not a list (what the note was turned into, one line each inside the card) */}
          {n.linked.map((l) => (
            <View key={`${l.kind}:${l.id}`} style={s.linked}>
              <Ico name={l.kind === "task" ? "task" : "record"} size={13} color="var(--ink-3)" />
              <Text numberOfLines={1} style={s.linkedText}>{l.title}</Text>
            </View>
          ))}
          <View style={[s.metaRow, phone ? { marginTop: 7 } : null]}>
            {n.labels.length ? <View style={s.lb}><Ico name="tag" size={12} color="var(--ink-4)" /><Text numberOfLines={1} style={s.meta}>{n.labels.join(", ")}</Text></View> : null}
            <View style={s.grow} />
            {shared}
          </View>
        </View>
        {phone ? null : (
          <View style={s.tools} {...dom({ dataSet: { nfade: "off" } })}>
            <IconBtn icon="palette" label="Colour" size={30} iconSize={15} tabbable={false} onPress={(x, y) => a.colour(n.noteId, x, y)} testID={`note-colour-${n.noteId}`} />
            <IconBtn icon="tag" label="Labels (L)" size={30} iconSize={15} tabbable={false} onPress={(x, y) => a.labels(n.noteId, x, y)} testID={`note-labels-${n.noteId}`} />
            {n.mine ? <IconBtn icon="share" label="Share (S)" size={30} iconSize={15} tabbable={false} onPress={() => a.share(n.noteId)} testID={`note-share-${n.noteId}`} /> : null}
            <IconBtn icon="ask" label="Ask about this note (A)" size={30} iconSize={15} tabbable={false} onPress={() => a.ask(n.noteId)} testID={`note-ask-${n.noteId}`} />
            <View style={s.grow} />
            <IconBtn icon="more" label="More (Shift F10)" size={30} iconSize={15} tabbable={false} onPress={(x, y) => a.menu(n.noteId, x, y, "button")} testID={`note-more-${n.noteId}`} />
          </View>
        )}
        {phone ? null : (
          <View style={s.pin} {...dom({ dataSet: { nfade: n.pinned ? "on" : "off" } })}>
            <IconBtn
              icon={n.pinned ? "pinf" : "pin"} label={`${n.pinned ? "Unpin" : "Pin"} (P)`} iconSize={15} on={false} tabbable={false} color={n.pinned ? "var(--ink)" : "var(--ink-3)"}
              onPress={() => a.pin(n.noteId)} testID={`note-pin-${n.noteId}`} over={n.hasImage || n.clip !== undefined}
            />
          </View>
        )}
      </Pressable>
  );
  // a card never splits across two columns of the grid
  return web
    ? createElement("div", { style: { breakInside: "avoid", width: "100%", marginBottom: phone ? 10 : 14, ...(covered ? { visibility: "hidden" } : {}) }, "data-testid": `note-wrap-${n.noteId}`, ...trigger }, card)
    : <View style={[s.wrap, phone ? s.wrapPhone : null]} {...trigger}>{card}</View>;
});

const s = StyleSheet.create({
  wrap: { width: "100%", marginBottom: 14 },
  wrapPhone: { marginBottom: 10 },
  card: { width: "100%", borderRadius: 14, overflow: "hidden", position: "relative", ...(web ? ({ cursor: "default" } as object) : null) },
  cardPhone: { borderRadius: 12 },
  body: { paddingTop: 12, paddingHorizontal: 14, paddingBottom: 10 },
  bodyPhone: { paddingTop: 10, paddingHorizontal: 11, paddingBottom: 9 },
  title: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: "var(--ink)" as string, marginBottom: 4 },
  titlePinRoom: { marginRight: 22 },
  text: { fontSize: 13, lineHeight: 19, color: "var(--ink-2)" as string },
  linked: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  linkedText: { fontSize: 12, color: "var(--ink-2)" as string, flexShrink: 1 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10, minHeight: 20 },
  lb: { flexDirection: "row", alignItems: "center", gap: 4, minWidth: 0, flexShrink: 1 },
  meta: { fontSize: 11.5, color: "var(--ink-3)" as string },
  shr: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 },
  grow: { flex: 1, minWidth: 0 },
  tools: { flexDirection: "row", alignItems: "center", paddingHorizontal: 6, paddingBottom: 6, marginTop: -4 },
  pin: { position: "absolute", top: 8, right: 8 },
});
