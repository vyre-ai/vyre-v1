// The card of an Automation that waits for a person's approval (rc.32 lane r32-auto, item 6), on the first page and in the run: what is asked, and Allow and Deny with a line for what happens on each. A Deny asks for its reason
// first and sends nothing until it is written. One answer is one call (approvals/model.ts answerFor); a refusal reads as one sentence under the card.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { AppLogo } from "../../../../../../ui/src/AppLogo/index.tsx";
import { useAutomationsData } from "../canvas/data.tsx";
import { glyphOf, tintOf } from "../picker/glyphs.ts";
import { look } from "../screens/look.ts";
import { answerFor } from "./model.ts";
import type { ApprovalCard as Card } from "./model.ts";

export function ApprovalCard({
  card,
  automation,
  onAnswered,
}: {
  card: Card;
  /** The Automation's name, shown above the question on the first page. */
  automation?: string;
  onAnswered(): void;
}): ReactElement {
  const data = useAutomationsData();
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const answer = (which: "allow" | "deny"): void => {
    let call;
    try {
      call = answerFor(card.taskId, which, reason);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That did not work.");
      return;
    }
    setBusy(true);
    setNote(null);
    void data.call(call.cap, call.input).then(
      () => {
        setBusy(false);
        onAnswered();
      },
      (e: unknown) => {
        setBusy(false);
        setNote(e instanceof Error ? e.message : "That did not work.");
      },
    );
  };
  const id = card.taskId;
  return (
    <View style={s.card} testID={`ap-card-${id}`}>
      <AppLogo
        app="vyre:ask"
        name={automation ?? card.title}
        size={32}
        glyph={glyphOf({ app: "vyre:ask", name: "" })}
        tint={tintOf({ app: "vyre:ask", name: "" })}
      />
      <View style={s.grow}>
        <Text style={look.title}>{automation ?? card.title}</Text>
        {automation ? <Text style={[look.body, { color: "var(--ink-2)" }]}>{card.title}</Text> : null}
        {card.summary ? <Text style={look.quiet}>{card.summary}</Text> : null}
        <Text style={look.quiet} testID={`ap-allow-says-${id}`}>{`Allow: ${card.allow}`}</Text>
        <Text style={look.quiet} testID={`ap-deny-says-${id}`}>{`Deny: ${card.deny}`}</Text>
        {denying ? (
          <TextInput
            autoFocus
            value={reason}
            onChangeText={setReason}
            placeholder="Why not?"
            placeholderTextColor="var(--ink-3)"
            accessibilityLabel="Why not?"
            testID={`ap-reason-${id}`}
            style={s.reason}
          />
        ) : null}
        {note ? (
          <Text style={look.warn} testID={`ap-note-${id}`}>
            {note}
          </Text>
        ) : null}
      </View>
      <View style={s.buttons}>
        {denying ? (
          <>
            <Pressable
              testID={`ap-cancel-${id}`}
              accessibilityRole="button"
              onPress={() => {
                setDenying(false);
                setNote(null);
              }}
              style={look.btn}
            >
              <Text style={look.btnText}>Cancel</Text>
            </Pressable>
            <Pressable
              testID={`ap-deny-go-${id}`}
              accessibilityRole="button"
              disabled={busy}
              onPress={() => answer("deny")}
              style={[look.btn, look.outlined]}
            >
              <Text style={look.btnText}>Deny</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              testID={`ap-deny-${id}`}
              accessibilityRole="button"
              onPress={() => setDenying(true)}
              style={[look.btn, look.outlined]}
            >
              <Text style={look.btnText}>Deny</Text>
            </Pressable>
            <Pressable
              testID={`ap-allow-${id}`}
              accessibilityRole="button"
              disabled={busy}
              onPress={() => answer("allow")}
              style={[look.btn, look.primary]}
            >
              <Text style={look.primaryText}>Allow</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    padding: 16,
    borderRadius: 12,
    backgroundColor: "var(--sunk)" as string,
    flexWrap: "wrap",
  },
  grow: { flex: 1, minWidth: 220, gap: 3 },
  buttons: { flexDirection: "row", gap: 8, alignItems: "center" },
  reason: {
    height: 34,
    paddingHorizontal: 10,
    marginTop: 6,
    fontSize: 13.5,
    color: "var(--ink)" as string,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "var(--line)" as string,
  },
});
