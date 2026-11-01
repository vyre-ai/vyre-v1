// A kept /btw answer in the chat: quiet, not a bordered box. One header line (lock, the question, the time placed as on a normal message), the answer as a normal reply's markdown under a thin rule,
// and a fold when it is long. It is the card chat.aside_keep posts (a link card led "Aside"); the words in it are the model's, drawn as the same markdown a reply gets.
import { useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { MarkdownBlocks } from "../../../../../../ui/src/stream/index.ts";
import { Glyph } from "./parts.tsx";
import { bodyBlocks } from "./model.ts";

const FOLD_CHARS = 700;
const FOLD_LINES = 9;
const FOLD_HEIGHT = 168;
const web = Platform.OS === "web";

/** An answer that is long enough to fold: many characters or many lines. */
export const needsFold = (body: string): boolean => body.length > FOLD_CHARS || body.split("\n").length > FOLD_LINES;

export function KeptAside({ id, question, body, time }: { id: string; question: string; body: string; time: string }): ReactElement {
  const long = needsFold(body);
  const [open, setOpen] = useState(false);
  const folded = long && !open;
  return (
    <View testID={`kept-aside-${id}`} accessibilityRole="summary" accessibilityLabel={`Kept side answer, ${time}`} style={st.root}>
      <View style={st.head}>
        <Glyph name="lock" size={12} color="var(--ink-4)" />
        <Text numberOfLines={1} style={st.question}>{question}</Text>
        <Text style={st.time}>{time}</Text>
      </View>
      <View style={st.rule}>
        <View testID={`kept-aside-body-${id}`} style={[folded ? { maxHeight: FOLD_HEIGHT, overflow: "hidden" } : null, folded && web ? ({ maskImage: "linear-gradient(to bottom,#000 calc(100% - 28px),transparent)", WebkitMaskImage: "linear-gradient(to bottom,#000 calc(100% - 28px),transparent)" } as object) : null]}>
          <MarkdownBlocks blocks={bodyBlocks(id, body)} />
        </View>
        {long ? (
          <Pressable testID={`kept-aside-fold-${id}`} accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen((o) => !o)} style={st.fold}>
            <Text style={st.foldText}>{open ? "Show less" : "Show more"}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { marginTop: 8, marginBottom: 2, gap: 4, maxWidth: 720 },
  head: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 20 },
  question: { flexShrink: 1, minWidth: 0, fontSize: 12.5, color: "var(--ink-3)" as string },
  time: { fontSize: 11.5, color: "var(--ink-3)" as string },
  rule: { borderLeftWidth: 2, borderLeftColor: "var(--line-2)" as string, paddingLeft: 12, marginLeft: 5 },
  fold: { alignSelf: "flex-start", paddingVertical: 4 },
  foldText: { fontSize: 12.5, color: "var(--ink-3)" as string },
});
