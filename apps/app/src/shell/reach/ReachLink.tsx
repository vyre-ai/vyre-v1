// A label that goes where reach says it goes. Open: a link that opens the deepest place. Peek: a link that shows a read-only card under the label (with Tell an admin when the thing needs one).
// None: plain text, no link styling, no hover. The hover text and the press read the same answer (hint, act), so they cannot disagree.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Tooltip } from "../../../../../ui/src/Tooltip/index.tsx";
import { act, hint, isLink, tellAdmins } from "./reach.ts";
import type { Peek, Reach, Target, Viewer } from "./reach.ts";

export interface ReachDeps {
  viewer: Viewer;
  open(target: Target): void;
  call(cap: string, input: unknown): Promise<unknown>;
}

export function ReachLink({ r, label, deps, testID, textStyle }: { r: Reach; label: string; deps: Pick<ReachDeps, "open" | "call" | "viewer">; testID: string; textStyle?: object }): ReactElement {
  const [peek, setPeek] = useState<Peek | null>(null);
  const [line, setLine] = useState("");
  if (!isLink(r)) return <Text testID={testID} style={textStyle}>{label}</Text>;
  const title = hint(r) ?? undefined;
  const tell = async (reason: string): Promise<void> => {
    try { setLine(await tellAdmins(deps.call, deps.viewer, reason)); } catch { setLine("Could not send that. Try again."); }
  };
  return (
    <View>
      <Tooltip text={title ?? ""}>
        <Pressable
          testID={testID}
          accessibilityRole="link"
          accessibilityLabel={label}
          onPress={() => { act(r, { open: deps.open, peek: (p) => setPeek((cur) => (cur === null ? p : null)) }); }}
        >
          <Text style={[st.link, textStyle]}>{label}</Text>
        </Pressable>
      </Tooltip>
      {peek !== null ? (
        <View testID={`${testID}-peek`} style={st.card} accessibilityRole="summary">
          <Text style={st.title}>{peek.title}</Text>
          {/* ui-rows-lint: not a list (the lines of a peek, as text) */}
          {peek.lines.map((l) => <Text key={l} style={st.line}>{l}</Text>)}
          {peek.tell !== undefined && line === "" ? (
            <Pressable testID={`${testID}-tell`} accessibilityRole="button" onPress={() => void tell(peek.tell!.reason)}><Text style={st.link}>{peek.tell.label}</Text></Pressable>
          ) : null}
          {line !== "" ? <Text testID={`${testID}-sent`} style={st.line}>{line}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  link: { color: "var(--accent)" as string, fontSize: 12, textDecorationLine: "underline" },
  card: { marginTop: 6, padding: 10, gap: 4, borderRadius: 10, borderWidth: 1, borderColor: "var(--line-2)" as string, backgroundColor: "var(--raised)" as string, minWidth: 200 },
  title: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  line: { fontSize: 12, color: "var(--ink-2)" as string },
});
