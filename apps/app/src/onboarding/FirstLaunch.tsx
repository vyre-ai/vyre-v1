// First launch on the desktop app, before any Space exists: three doors. Each is a clear choice (an icon, a name and one plain line about what it makes), then a quiet way in for a person who
// already has a Space. Nothing is asked here that needs storing. Colours come from the join palette, so the page reads the same in light and dark.
import { createElement, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { Bar, JoinFrame, Panel, Step, Title, useJoin } from "../join/kit.tsx";
import { DOORS } from "./doors.ts";
import type { Door } from "./doors.ts";

const ICON: Record<Door, readonly string[]> = {
  me: ["M12 12a3.6 3.6 0 100-7.2A3.6 3.6 0 0012 12z", "M4.8 19.4c.7-3.2 3.5-4.9 7.2-4.9s6.5 1.7 7.2 4.9"],
  invited: ["M4 7.5A1.5 1.5 0 015.5 6h13A1.5 1.5 0 0120 7.5v9a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 16.5z", "M4.5 7.5l7.5 5.5 7.5-5.5"],
  team: ["M8.5 11a3 3 0 100-6 3 3 0 000 6z", "M2.8 19c.5-2.9 2.7-4.4 5.7-4.4s5.2 1.5 5.7 4.4", "M15.5 11.2a2.6 2.6 0 100-5.2", "M16.4 14.7c2.3.2 4 1.6 4.4 4.3"],
};

function Glyph({ paths, color, size = 22 }: { paths: readonly string[]; color: string; size?: number }): ReactElement | null {
  if (Platform.OS !== "web") return null;
  const kids: ReactElement[] = [];
  for (const d of paths) kids.push(createElement("path", { key: d, d, fill: "none" }));
  return createElement("svg", { viewBox: "0 0 24 24", width: size, height: size, "aria-hidden": true, style: { display: "block", stroke: color, strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" } }, ...kids);
}

function Chevron({ color }: { color: string }): ReactElement | null {
  return <Glyph paths={["M9.5 6l6 6-6 6"]} color={color} size={18} />;
}

/** One door: a card the whole width, so each reads as a choice rather than a row of a list. */
function DoorCard({ door, title, help, busy, disabled, onPress }: { door: Door; title: string; help: string; busy: boolean; disabled: boolean; onPress(): void }): ReactElement {
  const { p } = useJoin();
  return (
    <Pressable
      testID={`door-${door}`} accessibilityRole="button" accessibilityLabel={`${title}. ${help}`} accessibilityState={{ busy, disabled }} disabled={disabled} onPress={onPress}
      style={({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) => ({
        flexDirection: "row", alignItems: "center", gap: 16, padding: 16, borderRadius: 14, backgroundColor: hovered === true || pressed === true ? p.sw : p.grp,
        borderWidth: 1, borderColor: busy ? p.blue : "transparent", opacity: disabled && !busy ? 0.55 : 1,
      })}
    >
      <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: p.panel, borderWidth: 1, borderColor: p.hair, alignItems: "center", justifyContent: "center" }}>
        <Glyph paths={ICON[door]} color={p.blue} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ fontSize: 16.5, lineHeight: 22, fontWeight: "600", color: p.tx }}>{busy ? "Starting…" : title}</Text>
        <Text style={{ fontSize: 13.5, lineHeight: 19, color: p.tx2 }}>{help}</Text>
      </View>
      <Chevron color={p.tx2} />
    </Pressable>
  );
}

/** The quiet way in for a person who already has a Space. */
function ExistingLink({ onPress }: { onPress(): void }): ReactElement {
  const { p } = useJoin();
  return (
    <Pressable testID="door-existing" accessibilityRole="button" onPress={onPress} style={({ hovered }: { hovered?: boolean }) => ({ alignSelf: "center", minHeight: 44, paddingHorizontal: 16, justifyContent: "center", borderRadius: 10, backgroundColor: hovered === true ? p.grp : "transparent" })}>
      <Text style={{ fontSize: 14.5, lineHeight: 20, color: p.blue }}>I already have a Space</Text>
    </Pressable>
  );
}

/** Why a door did not open, in a quiet red box under the doors, aligned with them. */
function ErrorNote({ children }: { children: ReactNode }): ReactElement {
  const { p } = useJoin();
  return (
    <View testID="door-error" accessibilityRole="alert" style={{ marginTop: 12, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, backgroundColor: p.red + "1A", borderWidth: 1, borderColor: p.red + "40" }}>
      <Text style={{ fontSize: 14, lineHeight: 20, color: p.red }}>{children}</Text>
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
  const cards: ReactElement[] = [];
  for (const d of DOORS) cards.push(<DoorCard key={d.door} door={d.door} title={d.title} help={d.help} busy={busy === d.door} disabled={busy !== null} onPress={() => void pick(d.door)} />);
  return (
    <JoinFrame halftoneIntensity="calm">
      <Panel bar={<Bar hideBack cont={null} />}>
        <Step id="first-launch">
          <Title title="Welcome to Vyre" sub="How do you want to start? You can add more Spaces later." />
          <View style={{ marginTop: 28, gap: 12 }}>{cards}</View>
          {error ? <ErrorNote>{error}</ErrorNote> : null}
          <View style={{ marginTop: 20 }}><ExistingLink onPress={() => setSignIn(true)} /></View>
        </Step>
      </Panel>
    </JoinFrame>
  );
}
