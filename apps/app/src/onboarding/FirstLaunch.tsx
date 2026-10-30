// First launch, before any Space exists: the doors. The design does the talking: the halftone V, the app's name, and big picture doors with two or three words each (the hint shows on hover or focus).
// Mac and PC offer three doors; a browser offers two (no "Just me": a Personal Space lives on a computer); a phone offers to join, or to email itself the app. Keys 1 to 3 and the arrows move between doors.
// A door that starts the Vyre server on this computer shows a waiting state; a failed start says so under the doors and leaves every door open.
import { useEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Text, View } from "react-native";
import { Door as DoorCard, ErrorLine, JoinFrame, Panel, Bar, Stage, Step, TextButton, Title, Working, baseText, useJoin } from "../join/kit.tsx";
import { Art } from "../join/art.tsx";
import type { ArtKind } from "../join/art.tsx";
import { HalftoneV } from "../join/Hero.tsx";
import { doorsFor } from "./doors.ts";
import type { Device, Door } from "./doors.ts";

const ART: Record<Door, ArtKind> = { me: "me", invited: "invited", team: "team", server: "server", app: "app" };
/** The doors that start the Vyre server on this computer, so they wait a few seconds. */
const STARTS_HERE: ReadonlySet<Door> = new Set<Door>(["me", "team"]);

function Foot({ device, onSignIn, onGetApp }: { device: Device; onSignIn(): void; onGetApp?(): void }): ReactElement {
  const { p } = useJoin();
  const quiet = [baseText(p), { color: p.tx3, fontSize: 13 }];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, marginTop: 28, flexWrap: "wrap" }}>
      {device === "web" && onGetApp ? <><Text style={quiet}>Prefer the app?</Text><TextButton small testID="door-get-app" label="Get Vyre" onPress={onGetApp} /></> : <><Text style={quiet}>{device === "phone" ? "Already a member?" : "Used Vyre on another computer?"}</Text><TextButton small testID="door-existing" label="Sign in" onPress={onSignIn} /></>}
    </View>
  );
}

export function FirstLaunch({ onDoor, existing, device = "mac", onGetApp }: { onDoor(door: Door): Promise<void>; /** the sign-in screen for a person who already has a Space */ existing: ReactNode; device?: Device; onGetApp?(): void }): ReactElement {
  const [busy, setBusy] = useState<Door | null>(null);
  const [error, setError] = useState("");
  const [signIn, setSignIn] = useState(false);
  const doors = doorsFor(device);
  const sel = useRef(-1);
  const pick = async (door: Door): Promise<void> => {
    if (busy) return;
    setBusy(door); setError("");
    try { await onDoor(door); } catch (e) { setError(e instanceof Error && e.message ? e.message : "Couldn’t start. Try again."); } finally { setBusy(null); }
  };
  useEffect(() => {
    const doc = (globalThis as { document?: Document }).document;
    if (!doc || signIn) return;
    const onKey = (e: KeyboardEvent): void => {
      if (busy || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as { tagName?: string } | null; if (t?.tagName === "INPUT" || t?.tagName === "TEXTAREA") return;
      const n = Number(e.key);
      if (n >= 1 && n <= doors.length) { e.preventDefault(); void pick(doors[n - 1]!.door); return; }
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const els = [...doc.querySelectorAll<HTMLElement>("[data-testid^='door-']")].filter((x) => doors.some((d) => x.getAttribute("data-testid") === `door-${d.door}`));
        sel.current = (sel.current + (e.key === "ArrowRight" ? 1 : -1) + els.length) % els.length;
        els[sel.current]?.focus();
      }
    };
    doc.addEventListener("keydown", onKey);
    return () => doc.removeEventListener("keydown", onKey);
  }, [busy, signIn, device]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (signIn) return <>{existing}</>;
  if (busy && STARTS_HERE.has(busy)) {
    return (
      <JoinFrame halftoneIntensity="full">
        <Panel bar={<Bar hideBack cont={null} />}>
          <Step id="first-launch-starting"><Working testID="door-starting" title="Starting Vyre" line={busy === "team" ? "Your Space first, then your team." : "Starting your Space…"} /></Step>
        </Panel>
      </JoinFrame>
    );
  }
  const phone = device === "phone";
  return (
    <JoinFrame halftoneIntensity="full">
      <Stage wide>
        <Step id="first-launch">
          <View style={{ alignItems: "center" }}>
            {phone ? null : <HalftoneV size={device === "web" ? 150 : 210} />}
            <Text accessibilityRole="header" style={{ fontSize: phone ? 30 : 40, lineHeight: phone ? 36 : 46, fontWeight: "700", letterSpacing: -1, textAlign: "center" }}>{device === "mac" || device === "win" ? "Welcome to Vyre" : "Vyre"}</Text>
            <View testID="doors" accessibilityRole={"list" as never} style={{ flexDirection: phone ? "column" : "row", gap: phone ? 10 : 18, marginTop: phone ? 20 : 34, justifyContent: "center", alignSelf: phone ? "stretch" : "center" }}>
              {doors.map((d, i) => (
                <DoorCard key={d.door} testID={`door-${d.door}`} n={String(i + 1)} title={d.title} hint={d.help} art={<Art kind={ART[d.door]} width={phone ? 56 : 132} height={phone ? 48 : 112} />} busy={busy === d.door} disabled={!!busy && busy !== d.door} onPress={() => void pick(d.door)} />
              ))}
            </View>
            {error ? <ErrorLine testID="door-error">{error}</ErrorLine> : null}
            <Foot device={device} onSignIn={() => setSignIn(true)} {...(onGetApp ? { onGetApp } : {})} />
          </View>
        </Step>
      </Stage>
    </JoinFrame>
  );
}
