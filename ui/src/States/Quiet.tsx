// Loading, the calm way: nothing for the first 300 ms, then one quiet sign, the Vyre mark with its coral spark breathing. Never a spinner, never a shimmer. It takes the room it is given, so nothing jumps when content arrives.
// It never waits for ever: a load that has not arrived after STALL_MS says so in one line with Retry (which asks the session to read again what is on screen), so a call that never answers is
// not an endless mark. A read that fails says why at once: that is LoadFailed (./Loads.tsx), which a place draws instead of this.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { QUIET_MS } from "../theme/motion.ts";
import { WorkingMark } from "../WorkingMark/index.tsx";
import { retryLoads } from "./retry.ts";

/** How long a load may take before the mark says it is taking too long. */
export const STALL_MS = 20_000;

export function Quiet({ size = 24, delay = QUIET_MS, stall = STALL_MS, onRetry = retryLoads, testID = "quiet" }: { size?: number; delay?: number; stall?: number; onRetry?: () => void; testID?: string }): ReactElement {
  const [show, setShow] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [round, setRound] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  useEffect(() => {
    const s = setTimeout(() => setStalled(true), stall);
    return () => clearTimeout(s);
  }, [stall, round]);
  const retry = (): void => { setStalled(false); setRound((n) => n + 1); onRetry(); };
  return (
    <View testID={testID} accessibilityLabel="Loading" style={st.fill} {...{ dataSet: { loading: "1" } }}>
      {show ? <View {...{ dataSet: { quiet: "1" } }}><WorkingMark state="thinking" size={size} /></View> : null}
      {stalled ? (
        <View testID={`${testID}-stalled`} style={st.stalled}>
          <Text style={st.line}>This is taking longer than it should.</Text>
          <Pressable accessibilityRole="button" testID={`${testID}-retry`} onPress={retry} style={(state) => [st.btn, (state as { hovered?: boolean }).hovered === true ? st.btnOver : null]}><Text style={st.btnText}>Retry</Text></Pressable>
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  fill: { flex: 1, minHeight: 0, alignItems: "center", justifyContent: "center" },
  stalled: { marginTop: 12, alignItems: "center", gap: 8 },
  line: { fontSize: 13, color: "var(--ink-2)" as string },
  btn: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: "var(--line)" as string },
  btnOver: { backgroundColor: "var(--hover)" as string },
  btnText: { fontSize: 13, color: "var(--ink)" as string },
});
