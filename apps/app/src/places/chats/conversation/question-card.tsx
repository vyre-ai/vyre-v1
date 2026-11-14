// An agent's open question in the transcript, as a card from the one card library (owner, 6 Nov 2026): a decision card on the card fill with the 12 px radius. The question is its title, a second line is the why, every
// answer is a row with what it means (or "Recommended") on the right, and the last row is "Your own answer", itself the input (prototype: scene live). The same question also docks above the composer in a long session
// (QuestionIsland); answering either one answers both.
import { useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Card, CardHead } from "../../../../../../ui/src/Card/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { TextButton } from "./parts.tsx";
import type { QuestionOption } from "./model.ts";

export function QuestionCard({
  id,
  prompt,
  options,
  onAnswer,
}: {
  id: string;
  prompt: string;
  options: readonly QuestionOption[];
  onAnswer: (optionId: string) => void;
}): ReactElement {
  const [text, setText] = useState("");
  const [title, ...why] = prompt.split("\n");
  const own = text.trim();
  return (
    <Card kind="decision" size="compact" testID={`question-card-${id}`} label={prompt}>
      <CardHead title={title ?? prompt} />
      {why.join(" ").trim() !== "" ? (
        <Text testID={`question-why-${id}`} style={st.why}>
          {why.join(" ").trim()}
        </Text>
      ) : null}
      <View accessibilityRole="radiogroup" style={st.rows}>
        {/* ui-rows-lint: not a list (the answers of one question, each one press) */}
        {options.map((o) => (
          <Row
            key={o.id}
            id={`option-${id}-${o.id}`}
            title={o.label}
            trailing={
              o.recommended || o.detail ? (
                <Text numberOfLines={1} style={o.recommended ? st.pick : st.hint}>
                  {o.recommended ? "Recommended" : o.detail}
                </Text>
              ) : null
            }
            onPress={() => onAnswer(o.id)}
          />
        ))}
        <View style={st.own}>
          <TextInput
            accessibilityLabel="Your own answer"
            placeholder="Your own answer"
            placeholderTextColor="var(--ink-4)"
            value={text}
            onChangeText={setText}
            onSubmitEditing={() => {
              if (own !== "") onAnswer(own);
            }}
            testID={`question-own-${id}`}
            style={st.input}
          />
          {own !== "" ? (
            <TextButton label="Send" primary testID={`question-own-send-${id}`} onPress={() => onAnswer(own)} />
          ) : null}
        </View>
      </View>
    </Card>
  );
}

const st = StyleSheet.create({
  why: { fontSize: 13, lineHeight: 19, color: "var(--ink-2)" as string, paddingBottom: 6 },
  rows: { marginHorizontal: -8, gap: 2 },
  hint: { fontSize: 12.5, color: "var(--ink-3)" as string, maxWidth: 180 },
  pick: { fontSize: 12.5, color: "var(--accent)" as string, fontWeight: "500" },
  own: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, paddingTop: 4 },
  input: {
    flex: 1,
    minWidth: 0,
    height: 28,
    borderRadius: 8,
    paddingHorizontal: 10,
    fontSize: 13,
    color: "var(--ink)" as string,
    backgroundColor: "var(--sunk)" as string,
  },
});
