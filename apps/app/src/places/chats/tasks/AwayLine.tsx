// While you were away, at the top of Tasks: the digest the assistant wrote after a gap (home.digest), three lines and at most seven items, until it is marked seen. Home is gone; this is
// where a person who comes back reads what moved. Nothing shows when there is no unseen digest.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";

type Digest = NonNullable<CapMap["home.digest"]["out"]["digest"]>;
type Call = (cap: string, input: unknown) => Promise<unknown>;

export function AwayLine({ call, assistant, openTask }: { call: Call; assistant: { id: string; name: string }; openTask(id: string): void }): ReactElement | null {
  const [digest, setDigest] = useState<Digest | null>(null);
  useEffect(() => {
    let live = true;
    void call("home.digest", {}).then((o) => { const d = (o as CapMap["home.digest"]["out"]).digest; if (live) setDigest(d && d.seenAt === undefined && (d.items.length > 0 || d.headline.length > 0) ? d : null); }, () => undefined);
    return () => { live = false; };
  }, [call]);
  if (!digest) return null;
  const seen = (): void => { const id = digest.id; setDigest(null); void call("home.mark_digest_seen", { digestId: id }).catch(() => undefined); };
  const items: ReactElement[] = [];
  for (const [i, it] of digest.items.slice(0, 7).entries()) {
    const task = it.subject?.type === "task" ? it.subject.id : undefined;
    items.push(<Row key={`${i}-${it.title}`} title={it.title} note={it.line} {...(task ? { onPress: () => openTask(task) } : {})} />);
  }
  return <View testID="tasks-away" style={st.wrap}><View style={st.box}>
    <View style={st.head}>
      <Avatar name={assistant.name} seedId={assistant.id} kind="assistant" size={22} />
      <Text style={st.title}>While you were away</Text>
      <View style={{ flex: 1 }} />
      <Pressable accessibilityRole="button" accessibilityLabel="Mark seen" testID="tasks-away-seen" onPress={seen} style={({ hovered }: { hovered?: boolean }) => [st.btn, hovered === true && st.itemOver]}><Text style={st.btnText}>Mark seen</Text></Pressable>
    </View>
    {digest.headline.length > 0 ? <Text style={st.line}>{digest.headline.join("\n")}</Text> : null}
    {items}
  </View></View>;
}

const st = StyleSheet.create({
  wrap: { width: "100%", maxWidth: 700, alignSelf: "center", paddingHorizontal: 16, paddingBottom: 6 },
  box: { gap: 4, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, backgroundColor: "var(--sunk)" as string },
  head: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 2 },
  title: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  line: { fontSize: 13.5, lineHeight: 19, color: "var(--ink-2)" as string },
  itemOver: { backgroundColor: "var(--hover)" as string },
  btn: { height: 28, justifyContent: "center", paddingHorizontal: 10, borderRadius: 9 },
  btnText: { fontSize: 13, color: "var(--ink-2)" as string },
});
