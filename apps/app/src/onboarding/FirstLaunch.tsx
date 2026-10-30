// First launch on the desktop app, before any Space exists: three doors. Each is a clear choice (an icon, a name and one plain line about what it makes), then a quiet way in for a person who
// already has a Space. Nothing is asked here that needs storing. Colours come from the join palette, so the page reads the same in light and dark.
import { createElement, useEffect, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { JoinFrame, useJoin } from "../join/kit.tsx";
import { DOORS } from "./doors.ts";
import type { Door } from "./doors.ts";

/** The Vyre mark as the owner's icon draws it: a V of halftone dots in the ink colour, with the violet dot at its shoulder. Computed once; plain SVG on the web. */
function HalftoneV({ ink, accent }: { ink: string; accent: string }): ReactElement | null {
  const dots = useMemo(() => {
    const out: ReactElement[] = [];
    const seg = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
      const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    };
    for (let y = 4; y < 168; y += 7) for (let x = 4; x < 188; x += 7) {
      const d = Math.min(seg(x, y, 22, 22, 92, 146), seg(x, y, 92, 146, 160, 70)), w = 19, r = d < w ? 3.3 * Math.pow(1 - d / w, 0.75) : 0;
      if (r > 0.35) out.push(<circle key={`${x}-${y}`} cx={x} cy={y} r={r.toFixed(2) as unknown as number} fill={ink} />);
    }
    for (let y = 2; y < 46; y += 6) for (let x = 144; x < 190; x += 6) {
      const d = Math.hypot(x - 168, y - 24), r = d < 21 ? 2.5 * Math.pow(1 - d / 21, 0.5) : 0;
      if (r > 0.4) out.push(<circle key={`a${x}-${y}`} cx={x} cy={y} r={r.toFixed(2) as unknown as number} fill={accent} />);
    }
    return out;
  }, [ink, accent]);
  if (Platform.OS !== "web") return null;
  return createElement("svg", { viewBox: "0 0 192 172", width: 132, height: 118, role: "img", "aria-label": "Vyre", "data-testid": "first-launch-mark" }, ...dots.map((d) => d));
}

/** Each door's drawing: a person with a lock, an envelope with a check, three people. Line art in the ink colour with the accent where it says something. */
function Art({ door, ink, accent, wash }: { door: Door; ink: string; accent: string; wash: string }): ReactElement | null {
  if (Platform.OS !== "web") return null;
  const L = { fill: "none", stroke: ink, strokeWidth: 2.4, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  const A = { fill: "none", stroke: accent, strokeWidth: 2.4, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  const kids: ReactElement[] = [createElement("circle", { key: "bg", cx: 48, cy: 48, r: 46, fill: wash })];
  if (door === "me") kids.push(createElement("circle", { key: "h", cx: 40, cy: 36, r: 11, ...L }), createElement("path", { key: "b", d: "M18 74c2-14 12-21 22-21s20 7 22 21", ...L }), createElement("rect", { key: "l", x: 57, y: 56, width: 21, height: 17, rx: 4, fill: "var(--win)", ...A }), createElement("path", { key: "s", d: "M62 56v-5a5.500 5.500 0 0111 0v5", ...A }), createElement("circle", { key: "d", cx: 67.500, cy: 64.500, r: 1.600, fill: accent }));
  else if (door === "invited") kids.push(createElement("rect", { key: "e", x: 16, y: 30, width: 64, height: 42, rx: 6, fill: "var(--win)", ...L }), createElement("path", { key: "f", d: "M18 34l30 22 30-22", ...L }), createElement("circle", { key: "c", cx: 76, cy: 28, r: 11, fill: accent }), createElement("path", { key: "k", d: "M70.500 28l4 4 7-8", fill: "none", stroke: "#fff", strokeWidth: 2.600, strokeLinecap: "round", strokeLinejoin: "round" }));
  else kids.push(createElement("circle", { key: "h", cx: 48, cy: 36, r: 11, ...L }), createElement("path", { key: "b", d: "M26 74c2-14 11-20 22-20s20 6 22 20", ...L }), createElement("circle", { key: "l", cx: 20, cy: 46, r: 7, ...A }), createElement("circle", { key: "r", cx: 76, cy: 46, r: 7, ...A }), createElement("path", { key: "lb", d: "M8 70c1-6 5-9 9-10", ...A }), createElement("path", { key: "rb", d: "M88 70c-1-6-5-9-9-10", ...A }));
  return createElement("svg", { viewBox: "0 0 96 96", width: 92, height: 92, "aria-hidden": true }, ...kids);
}

/** One door: a tall card with a drawing, its name and its number key. */
function DoorCard({ door, title, help, n, busy, disabled, wide, onPress }: { door: Door; title: string; help: string; n: number; busy: boolean; disabled: boolean; wide: boolean; onPress(): void }): ReactElement {
  const { p } = useJoin();
  return (
    <Pressable
      testID={`door-${door}`} accessibilityRole="button" accessibilityLabel={`${title}. ${help}`} accessibilityState={{ busy, disabled }} disabled={disabled} onPress={onPress}
      style={({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) => ({
        width: wide ? 224 : "100%", height: wide ? 236 : undefined, minHeight: wide ? undefined : 96, flexDirection: wide ? "column" : "row", alignItems: "center", justifyContent: wide ? "center" : "flex-start", gap: wide ? 22 : 16, padding: wide ? 20 : 14, borderRadius: 22,
        backgroundColor: p.panel, borderWidth: 1, borderColor: busy || hovered === true ? p.blue : p.hair, opacity: disabled && !busy ? 0.55 : 1, transform: [{ translateY: hovered === true && !disabled ? -3 : pressed === true ? 0 : 0 }],
        boxShadow: hovered === true ? "0 18px 40px -18px rgba(40,40,80,.35)" : "0 1px 2px rgba(0,0,0,.05), 0 10px 28px -16px rgba(40,40,80,.22)",
      } as object)}
    >
      <View style={{ position: "absolute", top: 12, right: 12, minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 6, borderWidth: 1, borderColor: p.hair, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 11, color: p.tx2 }}>{n}</Text></View>
      <Art door={door} ink={p.tx} accent={p.blue} wash={p.grp} />
      <Text style={{ fontSize: 19, lineHeight: 24, fontWeight: "600", color: p.tx, letterSpacing: -0.2, flexShrink: 1 }}>{busy ? "Starting…" : title}</Text>
    </Pressable>
  );
}

/** The quiet way in for a person who already has a Space on another computer. */
function ExistingLink({ onPress }: { onPress(): void }): ReactElement {
  const { p } = useJoin();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, flexWrap: "wrap" }}>
      <Text style={{ fontSize: 14, color: p.tx2 }}>Used Vyre on another computer?</Text>
      <Pressable testID="door-existing" accessibilityRole="button" onPress={onPress} style={{ minHeight: 32, justifyContent: "center", paddingHorizontal: 2 }}><Text style={{ fontSize: 14, fontWeight: "500", color: p.blue }}>Sign in</Text></Pressable>
    </View>
  );
}

/** Why a door did not open, in a quiet red box under the doors. */
function ErrorNote({ children }: { children: ReactNode }): ReactElement {
  const { p } = useJoin();
  return (
    <View testID="door-error" accessibilityRole="alert" style={{ marginTop: 18, maxWidth: 520, alignSelf: "center", paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, backgroundColor: p.red + "1A", borderWidth: 1, borderColor: p.red + "40" }}>
      <Text style={{ fontSize: 14, lineHeight: 20, color: p.red, textAlign: "center" }}>{children}</Text>
    </View>
  );
}

function Doors({ onDoor, onExisting }: { onDoor(door: Door): Promise<void>; onExisting(): void }): ReactElement {
  const { p } = useJoin();
  const width = useWindowDimensions().width;
  const wide = width >= 760;
  const [busy, setBusy] = useState<Door | null>(null);
  const [error, setError] = useState("");
  const pick = async (door: Door): Promise<void> => {
    if (busy) return;
    setBusy(door); setError("");
    try { await onDoor(door); } catch (e) { setError(e instanceof Error && e.message ? e.message : "Couldn’t start. Try again."); } finally { setBusy(null); }
  };
  // 1, 2 and 3 open the doors
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return undefined;
    const key = (e: KeyboardEvent): void => { const t = e.target as HTMLElement | null; if (t && /INPUT|TEXTAREA/.test(t.tagName)) return; const d = DOORS[Number(e.key) - 1]; if (d) void pick(d.door); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  });
  const cards: ReactElement[] = [];
  DOORS.forEach((d, i) => cards.push(<DoorCard key={d.door} door={d.door} title={d.title} help={d.help} n={i + 1} busy={busy === d.door} disabled={busy !== null} wide={wide} onPress={() => void pick(d.door)} />));
  return (
    <ScrollView style={{ width: "100%" }} contentContainerStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center", paddingVertical: 32, paddingHorizontal: 20, gap: 28 }}>
      <HalftoneV ink={p.tx} accent={p.blue} />
      <Text accessibilityRole="header" style={{ fontSize: wide ? 40 : 30, lineHeight: wide ? 46 : 36, fontWeight: "700", letterSpacing: -1, color: p.tx, textAlign: "center" }}>Welcome to Vyre</Text>
      <View style={{ flexDirection: wide ? "row" : "column", gap: 18, width: wide ? undefined : "100%", maxWidth: 420 + (wide ? 400 : 0) }}>{cards}</View>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <ExistingLink onPress={onExisting} />
    </ScrollView>
  );
}

export function FirstLaunch({ onDoor, existing }: { onDoor(door: Door): Promise<void>; /** the sign-in screen for a person who already has a Space */ existing: ReactNode }): ReactElement {
  const [signIn, setSignIn] = useState(false);
  if (signIn) return <>{existing}</>;
  return (
    <JoinFrame halftoneIntensity="calm">
      <Doors onDoor={onDoor} onExisting={() => setSignIn(true)} />
    </JoinFrame>
  );
}
