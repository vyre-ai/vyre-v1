// Loading, the calm way: nothing for the first 300 ms, then one quiet sign, the Vyre mark with its coral spark breathing. Never a spinner, never a shimmer. It takes the room it is given, so nothing jumps when content arrives.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { QUIET_MS } from "../theme/motion.ts";
import { WorkingMark } from "../WorkingMark/index.tsx";

export function Quiet({ size = 24, delay = QUIET_MS, testID = "quiet" }: { size?: number; delay?: number; testID?: string }): ReactElement {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  return <View testID={testID} accessibilityLabel="Loading" style={st.fill} {...{ dataSet: { loading: "1" } }}>{show ? <View {...{ dataSet: { quiet: "1" } }}><WorkingMark state="thinking" size={size} /></View> : null}</View>;
}

const st = StyleSheet.create({ fill: { flex: 1, minHeight: 0, alignItems: "center", justifyContent: "center" } });
