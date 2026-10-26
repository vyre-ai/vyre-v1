// The Gate on a protected branch (spec 2.16): a push to a protected branch waits for approval before it happens, and Approve and commit stays off until the Gate says yes.
// One ui/Row line: the shield, the sentence, Approve and Cancel on the right. After the answer the line says what was decided.
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { gateWords } from "./model.ts";
import type { GateView } from "./model.ts";
import { Glyph } from "./icons.tsx";
import { Btn } from "./parts.tsx";

export interface GateRowProps {
  gate: GateView;
  onApprove(): void;
  onCancel(): void;
  /** After a cancel the line offers to ask again. */
  onAsk?(): void;
}

export function GateRow({ gate, onApprove, onCancel, onAsk }: GateRowProps): ReactElement {
  const waiting = gate.state === "waiting";
  const color = gate.state === "cleared" ? "var(--ok)" : gate.state === "cancelled" ? "var(--ink-3)" : "var(--warn)";
  return (
    <View style={st.wrap} testID="gate-row" role="status" aria-label={gateWords(gate)}>
      <Row
        id="gate"
        title={gateWords(gate)}
        leading={<Glyph name={gate.state === "cleared" ? "check" : "shield"} size={14} color={color} width={1.6} />}
        trailing={waiting ? (
          <View style={st.acts}>
            <Btn label="Approve" small onPress={onApprove} testID="gate-approve" />
            <Btn label="Cancel" small onPress={onCancel} testID="gate-cancel" />
          </View>
        ) : gate.state === "cancelled" && onAsk ? <Btn label="Ask again" small onPress={onAsk} testID="gate-ask" /> : undefined}
      />
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { width: "100%" },
  acts: { flexDirection: "row", alignItems: "center", gap: 2 },
});
