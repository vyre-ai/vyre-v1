// First launch on the desktop app, before any Space exists: three doors. Nothing is asked here that needs storing.
// Each door is a card with an icon, what it is and what happens next. A door that starts something on this computer shows a waiting state with the reason it takes a moment;
// the quieter "I already have a Space" sits under them. Tab walks the cards in order, Enter or Space opens one, and a failed start says so under the cards and leaves every door open.
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Text, View } from "react-native";
import { Bar, Choice, ErrorLine, JoinFrame, Panel, Step, TextButton, Title, Working, baseText, useJoin } from "../join/kit.tsx";
import { DOORS } from "./doors.ts";
import type { Door } from "./doors.ts";

const ICON: Record<Door, "person" | "link" | "team"> = { me: "person", invited: "link", team: "team" };
/** The doors that start the Vyre server on this computer, so they wait a few seconds. */
const STARTS_HERE: ReadonlySet<Door> = new Set<Door>(["me", "team"]);

function Existing({ onPress }: { onPress(): void }): ReactElement {
  const { p } = useJoin();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, borderTopWidth: 1, borderTopColor: p.hair, paddingTop: 20, marginTop: 8 }}>
      <Text style={[baseText(p), { color: p.tx2, fontSize: 14, flexShrink: 1 }]}>Already use Vyre?</Text>
      <TextButton testID="door-existing" label="I already have a Space" onPress={onPress} />
    </View>
  );
}

export function FirstLaunch({ onDoor, existing }: { onDoor(door: Door): Promise<void>; /** the sign-in screen for a person who already has a Space */ existing: ReactNode }): ReactElement {
  const [busy, setBusy] = useState<Door | null>(null);
  const [error, setError] = useState("");
  const [signIn, setSignIn] = useState(false);
  if (signIn) return <>{existing}</>;
  const pick = async (door: Door): Promise<void> => {
    if (busy) return;
    setBusy(door); setError("");
    try { await onDoor(door); } catch (e) { setError(e instanceof Error && e.message ? e.message : "Couldn’t start. Try again."); } finally { setBusy(null); }
  };
  if (busy && STARTS_HERE.has(busy)) {
    return (
      <JoinFrame halftoneIntensity="full">
        <Panel bar={<Bar hideBack cont={null} />}>
          <Step id="first-launch-starting">
            <Working testID="door-starting" title="Starting Vyre on this computer" note="Vyre is setting up a private place for your work. This takes a few seconds the first time." line={busy === "team" ? "Your Personal Space comes first, then your Team Space." : "Almost there."} />
          </Step>
        </Panel>
      </JoinFrame>
    );
  }
  return (
    <JoinFrame halftoneIntensity="full">
      <Panel bar={<Bar hideBack cont={null} />}>
        <Step id="first-launch">
          <Title title="Welcome to Vyre" sub="Choose how to start. You can add a team or another Space later." />
          <View testID="doors" accessibilityRole={"list" as never} style={{ gap: 12, marginTop: 28 }}>
            {DOORS.map((d) => <Choice key={d.door} testID={`door-${d.door}`} icon={ICON[d.door]} title={d.title} help={d.help} busy={busy === d.door} disabled={!!busy && busy !== d.door} onPress={() => void pick(d.door)} />)}
          </View>
          {error ? <ErrorLine testID="door-error">{error}</ErrorLine> : null}
          <Existing onPress={() => setSignIn(true)} />
        </Step>
      </Panel>
    </JoinFrame>
  );
}
