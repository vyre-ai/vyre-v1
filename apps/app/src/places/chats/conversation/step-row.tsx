// One step of a finished reply's work line (owner, 16 Nov): a quiet row that opens to what it did. The row says the step in words; opening it reads the host's own note of that call once
// (chat.reply_details: what it touched, how it ended, how long it took) and says it in one sentence. Nothing in it is an id: a file's or a chat's id never shows.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { stepDid } from "./model.ts";
import type { StepLine } from "./model.ts";
import { readReplyDetails } from "../details/read.ts";
import type { Call } from "../details/read.ts";

export function StepRow({
  line,
  threadId,
  messageId,
  call,
}: {
  line: StepLine;
  threadId: string;
  messageId: string;
  /** Left out: the sentence is made from what the reply itself saved. */
  call?: Call;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState<string>(() => stepDid(line));
  const press = (): void => {
    const next = !open;
    setOpen(next);
    if (!next || call === undefined || line.tool === undefined) return;
    void readReplyDetails(call, threadId, messageId).then(
      (r) => {
        const tool = r.details.turn?.tools[line.tool!];
        if (tool) setSaid(stepDid(line, tool));
      },
      () => undefined,
    );
  };
  return (
    <View testID={`step-${line.id}`}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={line.title}
        onPress={press}
        style={st.step}
      >
        <View
          style={[st.dot, line.state === "live" && st.live, (line.state === "error" || line.ok === false) && st.bad]}
        />
        <Text style={st.title}>{line.title}</Text>
        {line.sub && !open ? (
          <Text numberOfLines={1} style={st.sub}>
            {line.sub}
          </Text>
        ) : null}
      </Pressable>
      {open ? (
        <Text testID={`step-did-${line.id}`} style={st.did}>
          {said}
        </Text>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  step: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 24 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "var(--ink-4)" as string },
  live: { backgroundColor: "var(--ok)" as string },
  bad: { backgroundColor: "var(--danger)" as string },
  title: { flexShrink: 1, fontSize: 13, color: "var(--ink-2)" as string },
  sub: { flexShrink: 1, fontSize: 12, color: "var(--ink-4)" as string },
  did: { marginLeft: 14, marginBottom: 4, fontSize: 12.5, lineHeight: 18, color: "var(--ink-3)" as string },
});
