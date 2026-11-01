// First launch, before any Space exists: the doors, in the one sheet. Mac and PC offer three doors; a browser offers two (no "Just me": a Personal Space lives on a computer); a phone offers to join, or to
// email itself the app. Keys 1 to 3 and the arrows move between doors. A door that starts the Vyre server on this computer shows the working state, says so if it takes long, and a failed start says so under
// the doors and leaves every door open.
import { useEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { View } from "react-native";
import { Door as DoorRow, ErrorLine, JoinFrame, Links, Panel, Step, TextButton, Title, Working } from "../join/kit.tsx";
import type { GlyphKind } from "../join/kit.tsx";
import { doorsFor } from "./doors.ts";
import type { Device, Door } from "./doors.ts";

const ICON: Record<Door, GlyphKind> = { me: "person", invited: "mail", team: "team", server: "server", app: "download" };
/** The doors that start the Vyre server on this computer, so they wait a few seconds. */
const STARTS_HERE: ReadonlySet<Door> = new Set<Door>(["me", "team"]);
/** After this long the working line says it can take a while. */
export const SLOW_START_MS = 8_000;
export const START_FAILED = "Vyre could not start your Space on this computer. Try again.";

export function FirstLaunch({ onDoor, existing, device = "mac", onGetApp }: { onDoor(door: Door): Promise<void>; /** the sign-in screen for a person who already has a Space, or a way to it */ existing: ReactNode | ((back: () => void) => ReactNode); device?: Device; onGetApp?(): void }): ReactElement {
  const [busy, setBusy] = useState<Door | null>(null);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState("");
  const [signIn, setSignIn] = useState(false);
  const doors = doorsFor(device);
  const sel = useRef(-1);
  const pick = async (door: Door): Promise<void> => {
    if (busy) return;
    setBusy(door); setError(""); setSlow(false);
    const timer = setTimeout(() => setSlow(true), SLOW_START_MS);
    try { await onDoor(door); } catch { setError(START_FAILED); } finally { clearTimeout(timer); setBusy(null); }
  };
  useEffect(() => {
    const doc = (globalThis as { document?: Document }).document;
    if (!doc || signIn) return;
    const onKey = (e: KeyboardEvent): void => {
      if (busy || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as { tagName?: string } | null; if (t?.tagName === "INPUT" || t?.tagName === "TEXTAREA") return;
      const n = Number(e.key);
      if (n >= 1 && n <= doors.length) { e.preventDefault(); void pick(doors[n - 1]!.door); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const els = [...doc.querySelectorAll<HTMLElement>("[data-testid^='door-']")].filter((x) => doors.some((d) => x.getAttribute("data-testid") === `door-${d.door}`));
        sel.current = (sel.current + (e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1) + els.length) % els.length;
        els[sel.current]?.focus();
      }
    };
    doc.addEventListener("keydown", onKey);
    return () => doc.removeEventListener("keydown", onKey);
  }, [busy, signIn, device]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (signIn) return <>{typeof existing === "function" ? existing(() => setSignIn(false)) : existing}</>;
  if (busy && STARTS_HERE.has(busy)) {
    return (
      <JoinFrame>
        <Panel wait>
          <Step id="first-launch-starting"><Working testID="door-starting" title="Starting Vyre" line={slow ? "This can take a minute on a new computer" : busy === "team" ? "Your Space first, then your team" : "Starting your Space"} /></Step>
        </Panel>
      </JoinFrame>
    );
  }
  // one row per way to start: built in a loop, not a list of rows
  const rows: ReactElement[] = [];
  for (let i = 0; i < doors.length; i++) {
    const d = doors[i]!;
    rows.push(<DoorRow key={d.door} testID={`door-${d.door}`} n={String(i + 1)} title={d.title} hint={d.help} icon={ICON[d.door]} busy={busy === d.door} disabled={!!busy && busy !== d.door} onPress={() => void pick(d.door)} />);
  }
  const foot = <Links top={2}><TextButton testID="door-existing" label="Sign in" onPress={() => setSignIn(true)} />{device === "web" && onGetApp ? <TextButton testID="door-get-app" label="Get Vyre" onPress={onGetApp} /> : null}</Links>;
  return (
    <JoinFrame>
      <Panel below={foot}>
        <Step id="first-launch">
          <Title title={device === "mac" || device === "win" ? "Welcome to Vyre" : "Vyre"} />
          <View testID="doors" accessibilityLabel="Ways to start" style={{ gap: 6, marginTop: 22 }}>{rows}</View>
          <ErrorLine testID="door-error">{error}</ErrorLine>
        </Step>
      </Panel>
    </JoinFrame>
  );
}
