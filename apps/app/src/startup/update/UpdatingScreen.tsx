// "Updating Vyre": the one full-window screen while the app updates itself on start, before the lock screen. The Vyre mark, the version it is going to, one thin bar with the real bytes and
// percent, and calm words. If the install fails it says so in one line and offers "Open Vyre anyway"; the next start tries again.
import type { ReactElement } from "react";
import { Platform, Text, View } from "react-native";
import { Button, ErrorLine, JoinFrame, Mark, useJoin } from "../../join/kit.tsx";
import { FONT } from "../../join/palette.ts";
import { fraction, progressLine } from "./model.ts";
import type { Progress } from "./model.ts";

const web = Platform.OS === "web";

export interface UpdatingProps {
  version: string;
  progress: Progress | null;
  /** The one line when the install failed; empty while it goes well. */
  failure: string;
  onOpenAnyway(): void;
}

export function UpdatingScreen(props: UpdatingProps): ReactElement {
  return <JoinFrame><UpdatingBody {...props} /></JoinFrame>;
}

function Bar({ value }: { value: number | null }): ReactElement {
  const { p } = useJoin();
  const pct = value === null ? null : Math.round(value * 1000) / 10;
  return (
    <View
      testID="update-bar" accessibilityRole="progressbar" aria-valuemin={0} aria-valuemax={100} {...(pct !== null ? { "aria-valuenow": Math.floor(pct) } : {})}
      style={{ height: 3, borderRadius: 3, backgroundColor: p.field, overflow: "hidden", marginTop: 26 }}
    >
      {pct === null
        ? <View {...(web ? { dataSet: { entryRun: "" } } : {})} style={{ position: "absolute", top: 0, bottom: 0, width: "34%", borderRadius: 3, backgroundColor: p.accent }} />
        : <View testID="update-bar-fill" style={{ height: 3, width: `${pct}%` as unknown as number, borderRadius: 3, backgroundColor: p.accent, ...(web ? ({ transitionProperty: "width", transitionDuration: "240ms", transitionTimingFunction: "ease-out" } as object) : {}) }} />}
    </View>
  );
}

function UpdatingBody({ version, progress, failure, onOpenAnyway }: UpdatingProps): ReactElement {
  const { p, phone } = useJoin();
  const text = { fontFamily: FONT, color: p.ink };
  return (
    <View testID="updating-screen" style={{ width: "100%", maxWidth: 400, paddingHorizontal: phone ? 28 : 0, alignItems: "stretch" }}>
      <View style={{ alignItems: "center", marginBottom: 22 }}><Mark size={52} {...(failure ? {} : { bloom: true })} /></View>
      <Text accessibilityRole="header" style={[text, { textAlign: "center", fontSize: 22, lineHeight: 28, fontWeight: "600", letterSpacing: -0.4 }]}>Updating Vyre</Text>
      <Text testID="updating-to" style={[text, { textAlign: "center", marginTop: 6, fontSize: 14, lineHeight: 20, color: p.ink3 }]}>{`Updating to ${version}`}</Text>
      <Bar value={failure ? 0 : fraction(progress)} />
      {failure ? (
        <View style={{ marginTop: 14 }}>
          <ErrorLine testID="updating-failed">{failure}</ErrorLine>
          <View style={{ marginTop: 18 }}><Button label="Open Vyre anyway" testID="updating-open" onPress={onOpenAnyway} /></View>
        </View>
      ) : (
        <>
          <Text testID="updating-line" accessibilityLiveRegion="polite" style={[text, { marginTop: 10, fontSize: 12.5, lineHeight: 18, color: p.ink3, textAlign: "center", ...(web ? ({ fontVariantNumeric: "tabular-nums" } as object) : {}) }]}>{progressLine(progress)}</Text>
          <Text testID="updating-calm" style={[text, { marginTop: 28, fontSize: 13, lineHeight: 19, color: p.ink3, textAlign: "center" }]}>Your chats and files stay just as they are. Vyre opens by itself when it is done.</Text>
        </>
      )}
    </View>
  );
}
