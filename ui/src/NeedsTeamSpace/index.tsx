// ui/NeedsTeamSpace: the one sentence a Personal Space shows where a Team Space is needed (spec 3.10, 2.1).
// The words never vary; callers only say what is blocked. One quiet line with one action; on a phone the action sits under the line.
// Colours are skin tokens (CSS variables on web), so a skin switch repaints with no re-render.

import { useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { NEEDS_TEAM_SPACE_ACTION, NEEDS_TEAM_SPACE_LABEL } from "./props.ts";
import type { NeedsTeamSpaceProps } from "./props.ts";

export type { Density, NeedsTeamSpaceProps } from "./props.ts";
export { NEEDS_TEAM_SPACE_ACTION, NEEDS_TEAM_SPACE_LABEL, frozenNeedsTeamSpaceProps } from "./props.ts";

export interface NeedsTeamSpaceViewProps extends NeedsTeamSpaceProps {
  /** Opens "Create or join a Team Space". */
  onAction?: () => void;
  testID?: string;
}

/** The sentence as a screen reader reads it: "Needs a Team Space. Sites, forms and campaigns." */
export function needsTeamSentence(what: string): string {
  const w = what.trim().replace(/[.\s]+$/, "");
  return w.length > 0 ? `${NEEDS_TEAM_SPACE_LABEL}. ${w}.` : `${NEEDS_TEAM_SPACE_LABEL}.`;
}

const webProps = (props: Record<string, unknown>): Record<string, unknown> => (Platform.OS === "web" ? props : {});

export function NeedsTeamSpace({ what, density, onAction, testID }: NeedsTeamSpaceViewProps): ReactElement {
  const [down, setDown] = useState(false);
  const compact = density === "compact";
  const detail = what.trim();
  return (
    <View
      accessibilityRole="alert"
      accessibilityLabel={needsTeamSentence(what)}
      testID={testID ?? "needs-team-space"}
      style={[styles.box, compact && styles.boxCompact]}
    >
      <Text style={[styles.text, compact && styles.textCompact]}>
        <Text style={styles.label}>{NEEDS_TEAM_SPACE_LABEL}</Text>
        {detail.length > 0 ? <Text>{` · ${detail}`}</Text> : null}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={NEEDS_TEAM_SPACE_ACTION}
        onPress={onAction}
        onPressIn={() => setDown(true)}
        onPressOut={() => setDown(false)}
        testID="needs-team-space-action"
        {...webProps({ title: NEEDS_TEAM_SPACE_ACTION })}
        style={({ hovered }: { hovered?: boolean }) => [styles.button, compact && styles.buttonCompact, hovered === true && styles.buttonHover, down && styles.buttonDown]}
      >
        <Text style={styles.buttonText}>{NEEDS_TEAM_SPACE_ACTION}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: "100%", maxWidth: 560, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, backgroundColor: "var(--sunk)" as string },
  boxCompact: { flexDirection: "column", alignItems: "flex-start", gap: 10 },
  text: { flex: 1, color: "var(--ink-2)" as string, fontSize: 13, lineHeight: 19 },
  textCompact: { flex: 0, width: "100%" },
  label: { color: "var(--ink)" as string, fontWeight: "600" },
  button: { height: 28, paddingHorizontal: 12, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: "var(--accent)" as string },
  buttonCompact: { height: 34 },
  buttonHover: { opacity: 0.92 },
  buttonDown: { opacity: 0.85 },
  buttonText: { color: "var(--accent-ink)" as string, fontSize: 12.5, fontWeight: "600" },
});
