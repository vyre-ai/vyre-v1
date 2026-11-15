// The look the Automations screens share (matched against the prototype pictures, 13 Nov 2026): one card, one quiet button, one filled button, one outlined button. Skin tokens only.
import { StyleSheet } from "react-native";

export const look = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    borderRadius: 12,
    backgroundColor: "var(--sunk)" as string,
  },
  title: { fontSize: 14.5, fontWeight: "600", color: "var(--ink)" as string },
  body: { fontSize: 14, lineHeight: 20, color: "var(--ink)" as string },
  quiet: { fontSize: 13, lineHeight: 18, color: "var(--ink-3)" as string },
  warn: { fontSize: 13.5, color: "var(--warn)" as string },
  heading: { fontSize: 13, fontWeight: "600", color: "var(--ink-3)" as string },
  btn: { height: 32, paddingHorizontal: 14, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  btnText: { fontSize: 13.5, fontWeight: "600", color: "var(--ink)" as string },
  outlined: { borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "transparent" },
  primary: { backgroundColor: "var(--accent)" as string },
  primaryText: { fontSize: 13.5, fontWeight: "600", color: "var(--accent-ink)" as string },
});
