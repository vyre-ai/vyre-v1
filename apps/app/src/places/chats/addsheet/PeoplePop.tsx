// The people-count menu of a chat: who is here, with "Add people and agents" first. A person row shows only the person. An agent row has Poke (one turn now) and a gear that opens the
// response settings (How, When, Style). Pressing an agent's name opens its page. It is drawn over the page like a menu and leaves on a press outside or Escape.
import { useEffect } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { ViewStyle } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { Overlay } from "../../../../../../ui/src/Overlay/index.tsx";
import { AccessFace, AccessIcon, AccessIconButton, AccessPokeButton } from "../../../../../../ui/src/AccessSheet/index.tsx";

export interface PeopleRow {
  id: string;
  name: string;
  kind: "person" | "agent" | "outside";
  /** The line under the name: "Answers everything", "Listening", "Person". */
  sub: string;
}

export interface PeoplePopProps {
  title: string;
  rows: readonly PeopleRow[];
  anchor: { x: number; y: number };
  onAdd(): void;
  onPoke(agentId: string): void;
  onGear(agentId: string, x: number, y: number): void;
  onOpenAgent(agentId: string): void;
  onClose(): void;
}

const web = Platform.OS === "web";

/** Elements built in a loop: a menu of rows with their own controls (the list lint asks for ui/Row only where a list item is a plain row). */
function each<T>(list: readonly T[], make: (item: T) => ReactElement): ReactElement[] {
  const out: ReactElement[] = [];
  for (const item of list) out.push(make(item));
  return out;
}

export function PeoplePop({ title, rows, anchor, onAdd, onPoke, onGear, onOpenAgent, onClose }: PeoplePopProps): ReactElement {
  const win = useWindowDimensions();
  useEffect(() => {
    if (!web) return undefined;
    const doc = (globalThis as { document?: { addEventListener(n: string, f: (e: { key: string }) => void): void; removeEventListener(n: string, f: (e: { key: string }) => void): void } }).document;
    if (!doc) return undefined;
    const key = (e: { key: string }): void => { if (e.key === "Escape") onClose(); };
    doc.addEventListener("keydown", key);
    return () => doc.removeEventListener("keydown", key);
  }, [onClose]);
  const width = Math.min(360, (win.width || 1024) - 16);
  const left = Math.max(8, Math.min(anchor.x - width + 24, (win.width || 1024) - width - 8));
  const top = Math.max(8, anchor.y + 8);
  const place = { position: web ? "fixed" : "absolute", left, top, width } as unknown as ViewStyle;
  return (
    <Overlay>
      <View style={st.layer}>
        <Pressable accessibilityLabel="Close" accessible={false} onPress={onClose} testID="people-scrim" style={StyleSheet.absoluteFill} />
        <View role="dialog" aria-modal={false} accessibilityLabel={title} testID="people-pop" style={[st.pop, { boxShadow: "var(--sh-pop)" } as unknown as ViewStyle, place]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Add people and agents" testID="people-add" onPress={onAdd} style={({ hovered }: { hovered?: boolean }) => [st.row, st.add, hovered === true && st.hover]}>
            <View style={st.plus}><AccessIcon name="plus" size={13} color="var(--ink-2)" /></View>
            <Text style={st.name}>Add people and agents</Text>
          </Pressable>
          <Text style={st.head} accessibilityRole="header">{title}</Text>
          {each(rows, (r) => (
            <View key={`${r.kind}:${r.id}`} style={st.row} testID={`people-row-${r.id}`}>
              {r.kind === "person" ? (
                <View style={st.main}>
                  <Avatar name={r.name} seedId={r.id} size={26} />
                  <View style={st.text}><Text style={st.name} numberOfLines={1}>{r.name}</Text><Text style={st.sub} numberOfLines={1}>{r.sub}</Text></View>
                </View>
              ) : (
                <>
                  <Pressable accessibilityRole="link" accessibilityLabel={`Open ${r.name}`} testID={`people-open-${r.id}`} onPress={() => onOpenAgent(r.id)} style={st.main}>
                    <AccessFace kind={r.kind} id={r.id} name={r.name} size={26} />
                    <View style={st.text}><Text style={st.name} numberOfLines={1}>{r.name}</Text><Text style={st.sub} numberOfLines={1}>{r.sub}</Text></View>
                  </Pressable>
                  <AccessPokeButton name={r.name} testID={`people-poke-${r.id}`} onPress={() => onPoke(r.id)} />
                  <AccessIconButton icon="gear" label={`How and when ${r.name} responds`} testID={`people-gear-${r.id}`} onPress={(x, y) => onGear(r.id, x, y)} />
                </>
              )}
            </View>
          ))}
        </View>
      </View>
    </Overlay>
  );
}

const st = StyleSheet.create({
  layer: { position: (web ? "fixed" : "absolute") as unknown as "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99997 },
  pop: { padding: 6, borderRadius: 14, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line-2)" as string, gap: 1 },
  head: { paddingHorizontal: 10, paddingTop: 10, paddingBottom: 4, fontSize: 11.5, color: "var(--ink-4)" as string },
  row: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 42, paddingVertical: 5, paddingHorizontal: 8, borderRadius: 10 },
  add: { minHeight: 40 },
  hover: { backgroundColor: "var(--hover)" as string },
  plus: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "var(--line-2)" as string },
  main: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 10 },
  text: { flex: 1, minWidth: 0 },
  name: { fontSize: 13.5, lineHeight: 19, color: "var(--ink)" as string },
  sub: { fontSize: 12, lineHeight: 16, color: "var(--ink-3)" as string },
});
