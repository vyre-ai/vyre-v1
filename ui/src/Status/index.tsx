// ui/Status: something that runs, said the same way everywhere. A dot in the tone colour and a few words, an action at the right (and a second one beside it), one quiet note under it, then a slot (a live
// view) and rows. The head is not a button; the actions are. A menu opens on right-click of the head. Colours come from tokens only; there is no fill and no pill.
//   inline  only the dot and the words, for a Row's trailing slot
//   bar     one full-width line of fixed height: the dot, the note (or the words), and at most one action; it changes text in place and moves nothing below it
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { menuTrigger, useMenu } from "../Menu/index.tsx";
import { Tooltip } from "../Tooltip/index.tsx";
import type { MenuEntry } from "../Menu/index.tsx";

export type Tone = "ok" | "quiet" | "warn" | "bad" | "mine";
export interface StatusAction {
  label: string;
  onPress(): void;
  disabled?: boolean;
  /** Said on hover and focus while the action is off. */
  why?: string;
}
export interface StatusProps {
  tone: Tone;
  label: string;
  note?: string;
  action?: StatusAction;
  /** A second action drawn beside the first, both visible and quiet: Send again and It went through. */
  alt?: StatusAction;
  menu?: readonly MenuEntry[];
  slot?: ReactNode;
  children?: ReactNode;
  inline?: boolean;
  bar?: boolean;
  testID?: string;
}

export const TONE_COLOR: Readonly<Record<Tone, string>> = {
  ok: "var(--ok)",
  quiet: "var(--ink-4)",
  warn: "var(--warn)",
  bad: "var(--danger)",
  mine: "var(--accent)",
};

const web = Platform.OS === "web";

function Dot({ tone }: { tone: Tone }): ReactElement {
  return <View style={[st.dot, { backgroundColor: TONE_COLOR[tone] }]} />;
}

function ActionButton({ a, id }: { a: StatusAction; id: string }): ReactElement {
  const off = a.disabled === true;
  // a disabled action must still be reachable, so it can say why: it is not `disabled` (that takes it out of the pointer and tab order) but aria-disabled, and presses do nothing
  return (
    <Tooltip text={off && a.why ? a.why : ""}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={a.label}
        accessibilityState={{ disabled: off }}
        aria-disabled={off}
        testID={id}
        onPress={off ? undefined : a.onPress}
        style={({ hovered }: { hovered?: boolean }) => [
          st.action,
          hovered === true && !off && st.actionOver,
          off && st.dim,
        ]}
      >
        <Text style={st.actionText}>{a.label}</Text>
      </Pressable>
    </Tooltip>
  );
}

export function Status({
  tone,
  label,
  note,
  action,
  alt,
  menu,
  slot,
  children,
  inline = false,
  bar = false,
  testID,
}: StatusProps): ReactElement {
  const { element, show } = useMenu();
  if (inline)
    return (
      <View testID={testID} style={st.inline}>
        <Dot tone={tone} />
        <Text numberOfLines={1} style={st.words}>
          {label}
        </Text>
      </View>
    );
  if (bar)
    return (
      <View testID={testID} style={st.bar} {...(web ? ({ role: "status" } as object) : {})}>
        <Dot tone={tone} />
        <Text numberOfLines={1} style={[st.words, st.barText]}>
          {note ?? label}
        </Text>
        {action ? <ActionButton a={action} id={`${testID ?? "status"}-action`} /> : null}
      </View>
    );
  return (
    <View testID={testID}>
      <View
        testID={`${testID ?? "status"}-head`}
        style={st.head}
        {...(menu ? menuTrigger((x, y) => show(menu, x, y, "context")) : {})}
      >
        <Dot tone={tone} />
        <Text numberOfLines={1} style={[st.words, st.grow]}>
          {label}
        </Text>
        {action ? <ActionButton a={action} id={`${testID ?? "status"}-action`} /> : null}
        {alt ? <ActionButton a={alt} id={`${testID ?? "status"}-alt`} /> : null}
      </View>
      {note ? <Text style={st.note}>{note}</Text> : null}
      {slot ? <View style={st.slot}>{slot}</View> : null}
      {children}
      {element}
    </View>
  );
}

const st = StyleSheet.create({
  dot: { width: 8, height: 8, borderRadius: 4 },
  head: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 28 },
  inline: { flexDirection: "row", alignItems: "center", gap: 6 },
  bar: { flexDirection: "row", alignItems: "center", gap: 8, height: 32, paddingHorizontal: 12 },
  barText: { flex: 1, minWidth: 0 },
  grow: { flex: 1, minWidth: 0 },
  words: { fontSize: 13, color: "var(--ink)" as string },
  note: { fontSize: 12, lineHeight: 16, color: "var(--ink-3)" as string, marginLeft: 16, marginBottom: 6 },
  slot: { marginVertical: 8 },
  action: { height: 24, paddingHorizontal: 8, borderRadius: 6, justifyContent: "center" },
  actionOver: { backgroundColor: "var(--hover)" as string },
  actionText: { fontSize: 12.5, fontWeight: "500", color: "var(--accent)" as string },
  dim: { opacity: 0.5 },
});
