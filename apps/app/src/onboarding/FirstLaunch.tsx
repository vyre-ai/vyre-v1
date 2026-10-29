// First launch on the desktop app, before any Space exists: three doors. Nothing is asked here that needs storing.
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Bar, ErrorLine, Group, JoinFrame, Panel, Row, Step, Title } from "../join/kit.tsx";
import { DOORS } from "./doors.ts";
import type { Door } from "./doors.ts";

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
  return (
    <JoinFrame halftoneIntensity="full">
      <Panel bar={<Bar hideBack cont={null} />}>
        <Step id="first-launch">
          <Title title="Welcome to Vyre" sub="How do you want to start?" />
          <Group>{DOORS.map((d) => <Row key={d.door} kind="action" testID={`door-${d.door}`} label={busy === d.door ? "Starting…" : d.title} note={d.help} onPress={() => void pick(d.door)} />)}</Group>
          {error ? <ErrorLine testID="door-error">{error}</ErrorLine> : null}
          <Group top={24}><Row kind="action" testID="door-existing" label="I already have a Space" onPress={() => setSignIn(true)} /></Group>
        </Step>
      </Panel>
    </JoinFrame>
  );
}
