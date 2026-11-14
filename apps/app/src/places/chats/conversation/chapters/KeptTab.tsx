// The Kept tab (G62, prototype p-live-pane-more): what a session decided and what a person kept from a side question, in one calm list. A decision or a note is a row; pressing it goes to the message in
// the chat. The chat's own "Decided" line opens this tab through `openKept` (the pane the chat sits beside owns the tab strip, this is its content).
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../../ui/src/Row/index.tsx";
import type { SessionSummary } from "../../session/model.ts";

export interface KeptProps {
  summary: Pick<SessionSummary, "decisions" | "notes">;
  /** Scroll the chat to a message and mark it. */
  onJump(messageId: string): void;
  /** "Maya, 3:53 PM" for a decision's trailing words; the caller knows names and the clock. */
  trail?(by: string, at: number): string;
}

const Quiet = ({ children }: { children: string }): ReactElement => <Text style={st.quiet}>{children}</Text>;

export function KeptTab({ summary, onJump, trail }: KeptProps): ReactElement {
  const { decisions, notes } = summary;
  if (decisions.length === 0 && notes.length === 0)
    return (
      <View testID="kept-empty" style={st.empty}>
        <Text style={st.emptyText}>Decisions and notes you keep will be here.</Text>
      </View>
    );
  return (
    <View testID="kept-tab" style={st.box}>
      {decisions.length > 0 ? (
        <View testID="kept-decisions">
          <Text accessibilityRole="header" style={st.caption}>
            Decisions
          </Text>
          {decisions.map((d) => (
            <Row
              key={d.messageId}
              id={`kept-decision-${d.messageId}`}
              title={d.sub}
              {...(trail ? { trailing: <Quiet>{trail(d.by, d.at)}</Quiet> } : {})}
              onPress={() => onJump(d.messageId)}
            />
          ))}
        </View>
      ) : null}
      {notes.length > 0 ? (
        <View testID="kept-notes">
          <Text accessibilityRole="header" style={st.caption}>
            Notes
          </Text>
          {notes.map((n) => (
            <Row
              key={n.messageId}
              id={`kept-note-${n.messageId}`}
              title={n.title}
              note={n.body}
              onPress={() => onJump(n.messageId)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  box: { gap: 16, paddingVertical: 8 },
  caption: { fontSize: 12, color: "var(--ink-4)" as string, paddingHorizontal: 12, marginBottom: 4 },
  quiet: { fontSize: 12, color: "var(--ink-4)" as string },
  empty: { paddingVertical: 24, paddingHorizontal: 12 },
  emptyText: { fontSize: 13, color: "var(--ink-3)" as string },
});
