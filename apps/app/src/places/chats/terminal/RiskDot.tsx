// The dot beside a command (rc.8): green reads only, amber changes something, red is destructive or elevated and always asks. The words are for a screen reader and for hover.
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";

export type Risk = "read" | "change" | "danger";
export const RISK_WORDS: Readonly<Record<Risk, string>> = { read: "Only reads", change: "Changes something", danger: "Destructive or elevated" };
const COLOR: Readonly<Record<Risk, string>> = { read: "var(--ok)", change: "var(--warn)", danger: "var(--danger)" };

export function RiskDot({ risk, size = 8 }: { risk: Risk; size?: number }): ReactElement {
  return <View testID={`risk-${risk}`} accessibilityRole="image" accessibilityLabel={RISK_WORDS[risk]} {...(typeof document === "undefined" ? {} : { dataSet: { tooltip: RISK_WORDS[risk] } })} style={[st.dot, { width: size, height: size, borderRadius: size / 2, backgroundColor: COLOR[risk] }]} />;
}

const st = StyleSheet.create({ dot: { flexShrink: 0 } });
