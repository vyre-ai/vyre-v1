// Take a note: the bar above the grid. Closed it says "Take a note" with an image button; a press (or C) opens it in place with the caret in the note. Open it holds a title, the text, a
// pasted or picked image, a pasted link (Reading <url>, then its card), the labels, and a bar: colour, labels, image, pin, who sees it, Close. Esc, Close or a press outside saves it;
// an empty one is dropped (the page decides, through the reducer in take.ts).
import { useEffect, useRef, useState } from "react";
import type { ComponentRef, ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { menuTrigger } from "../../../../../../ui/src/Menu/index.tsx";
import { Tooltip } from "../../../../../../ui/src/Tooltip/index.tsx";
import { Ico } from "./icons.tsx";
import { noteFill } from "./look.ts";
import { shortUrl } from "./model.ts";
import { Btn, IconBtn, LinkCard, Picture, dom, pressPoint, web } from "./parts.tsx";
import type { Take, TakeAct } from "./take.ts";

export interface TakeProps {
  take: Take;
  dispatch(a: TakeAct): void;
  /** Esc, Close or Cmd-Enter: save what is there (an empty note is dropped). */
  close(): void;
  pickImage(): void;
  colour(x: number, y: number): void;
  labels(x: number, y: number): void;
  who(x: number, y: number): void;
  /** The take's own menu (a right-click on the closed bar): Take a note, Add an image. */
  menu(x: number, y: number): void;
  spaceName: string;
  /** A file is held over the page: the bar wears the accent edge. */
  dropping: boolean;
  /** Bumped to put the caret in the note (C, a press on the bar, a paste). */
  focusBody: number;
}

export function TakeNote({ take, dispatch, close, pickImage, colour, labels, who, menu, spaceName, dropping, focusBody }: TakeProps): ReactElement {
  const body = useRef<ComponentRef<typeof TextInput> | null>(null);
  const title = useRef<ComponentRef<typeof TextInput> | null>(null);
  const [bodyH, setBodyH] = useState(44);
  useEffect(() => { if (take.open && focusBody > 0) body.current?.focus?.(); }, [focusBody, take.open]);
  const keys = (e: unknown, field: "title" | "body"): void => {
    const ev = (e as { nativeEvent?: { key?: string; metaKey?: boolean; ctrlKey?: boolean }; preventDefault?: () => void });
    const k = ev.nativeEvent?.key;
    if (k === "Escape" || (k === "Enter" && (ev.nativeEvent?.metaKey || ev.nativeEvent?.ctrlKey))) { ev.preventDefault?.(); close(); return; }
    if (k === "Enter" && field === "title") { ev.preventDefault?.(); body.current?.focus?.(); }
  };
  if (!take.open) {
    return (
      <View style={s.closedWrap} {...menuTrigger(menu)}>
        <Pressable
          accessibilityRole="button" accessibilityLabel="Take a note" testID="take-closed" onPress={() => dispatch({ t: "open" })}
          style={[s.take, s.closed]} {...dom({ dataSet: { ntake: "closed", ndrop: dropping ? "true" : "false" } })}
        >
          <Text style={s.ph}>Take a note</Text>
          <IconBtn icon="image" label="Add an image" iconSize={17} tabbable={false} onPress={() => pickImage()} testID="take-image-closed" />
        </Pressable>
      </View>
    );
  }
  const share = take.share === "private" ? { icon: "lock" as const, text: "Private" } : take.share === "space" ? { icon: "globe" as const, text: "Space" } : { icon: "people" as const, text: "A person" };
  return (
    <View testID="take-open" style={[s.take, { backgroundColor: noteFill(take.color) }]} {...dom({ dataSet: { ntake: "open", ndrop: dropping ? "true" : "false" } })}>
      {take.image ? (
        <View style={s.im}>
          <Picture uri={take.image.uri} alt="Pasted image" height={200} testID="take-picture" />
          <IconBtn icon="x" label="Remove the image" iconSize={14} onPress={() => dispatch({ t: "rm-image" })} style={s.over} over testID="take-rm-image" />
        </View>
      ) : null}
      <TextInput
        ref={title} value={take.title} onChangeText={(v) => dispatch({ t: "title", v })} onKeyPress={(e) => keys(e, "title")} placeholder="Title" placeholderTextColor="var(--ink-3)"
        accessibilityLabel="Title" testID="take-title" style={s.tkT}
      />
      <TextInput
        ref={body} value={take.body} onChangeText={(v) => dispatch({ t: "body", v })} onKeyPress={(e) => keys(e, "body")} multiline placeholder="Take a note, or paste text, an image or a link"
        placeholderTextColor="var(--ink-3)" accessibilityLabel="Note" testID="take-body" autoFocus={!take.title && !take.body}
        onContentSizeChange={(e) => setBodyH(Math.max(44, Math.ceil(e.nativeEvent.contentSize.height)))} style={[s.tkB, { height: bodyH }]}
      />
      {take.reading ? (
        <View style={s.reading} testID="take-reading">
          <Ico name="link" size={14} color="var(--ink-3)" />
          <Text numberOfLines={1} style={s.readingText}>{`Reading ${shortUrl(take.reading)}`}</Text>
        </View>
      ) : null}
      {take.link ? (
        <View style={s.linkWrap}>
          <LinkCard link={take.link} row={!!take.link.image} testID="take-link" />
          <IconBtn icon="x" label="Remove the preview" iconSize={13} onPress={() => dispatch({ t: "rm-link" })} style={[s.over, { right: 22, top: 16 }]} over testID="take-rm-link" />
        </View>
      ) : null}
      {take.labels.length ? (
        <View style={s.labels}><Ico name="tag" size={12} color="var(--ink-3)" /><Text style={s.labelsText}>{take.labels.join(", ")}</Text></View>
      ) : null}
      <View style={s.tbar}>
        <IconBtn icon="palette" label="Colour" onPress={colour} testID="take-colour" />
        <IconBtn icon="tag" label="Labels" onPress={labels} testID="take-labels" />
        <IconBtn icon="image" label="Add an image" onPress={() => pickImage()} testID="take-image" />
        <IconBtn icon={take.pinned ? "pinf" : "pin"} label={take.pinned ? "Unpin" : "Pin"} on={take.pinned} onPress={() => dispatch({ t: "pin" })} testID="take-pin" />
        <Tooltip text={take.share === "space" ? `Everyone in ${spaceName}` : "Who can see it"}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Who can see it: ${share.text}`} testID="take-who" onPress={(e) => { const p = pressPoint(e); who(p.x, p.y); }} style={s.who} {...dom({ dataSet: { nbtn: "ghost" } })}>
            <Ico name={share.icon} size={13} color="var(--ink-3)" />
            <Text style={s.whoText}>{share.text}</Text>
          </Pressable>
        </Tooltip>
        <View style={{ flex: 1 }} />
        <Btn label="Close" kind="ghost" sm onPress={() => close()} title="Save and close (Esc)" testID="take-close" />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  closedWrap: { width: "100%", maxWidth: 600, alignSelf: "center", marginTop: 18, marginBottom: 28 },
  take: {
    width: "100%", maxWidth: 600, alignSelf: "center", borderRadius: 14, backgroundColor: "var(--raised)" as string, marginTop: 18, marginBottom: 28,
    ...(web ? ({ boxShadow: "var(--sh-2)" } as object) : null),
  },
  closed: { flexDirection: "row", alignItems: "center", gap: 4, height: 48, paddingLeft: 16, paddingRight: 8, marginTop: 0, marginBottom: 0, ...(web ? ({ cursor: "text" } as object) : null) },
  ph: { flex: 1, fontSize: 15, color: "var(--ink-3)" as string },
  im: { position: "relative", borderTopLeftRadius: 14, borderTopRightRadius: 14, overflow: "hidden" },
  over: { position: "absolute", right: 8, top: 8 },
  tkT: { width: "100%", fontSize: 16, lineHeight: 22, fontWeight: "600", color: "var(--ink)" as string, paddingTop: 14, paddingHorizontal: 16, paddingBottom: 2, ...(web ? ({ outlineStyle: "none" } as object) : null) },
  tkB: { width: "100%", fontSize: 14, lineHeight: 21, color: "var(--ink)" as string, paddingTop: 6, paddingHorizontal: 16, paddingBottom: 10, ...(web ? ({ outlineStyle: "none", resize: "none" } as object) : null) },
  reading: { flexDirection: "row", alignItems: "center", gap: 9, marginTop: 4, marginHorizontal: 16, marginBottom: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: "var(--sunk)" as string },
  readingText: { fontSize: 12.5, color: "var(--ink-3)" as string, flexShrink: 1 },
  linkWrap: { paddingHorizontal: 16, paddingBottom: 8, position: "relative" },
  labels: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 16, paddingBottom: 4 },
  labelsText: { fontSize: 12, color: "var(--ink-3)" as string },
  tbar: { flexDirection: "row", alignItems: "center", gap: 2, paddingTop: 4, paddingHorizontal: 8, paddingBottom: 8 },
  who: { flexDirection: "row", alignItems: "center", gap: 5, height: 28, paddingHorizontal: 8, borderRadius: 8 },
  whoText: { fontSize: 12, color: "var(--ink-3)" as string },
});
