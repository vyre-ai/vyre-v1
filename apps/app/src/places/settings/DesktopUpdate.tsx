// "Update Vyre" on This computer (V1-SPEC 3.13): the desktop app checks its own channel, says what it found, and updates only when the person says so. The check and the install are the shell's
// (src-tauri/src/updater.rs): the page passes nothing and the shell verifies the signature before it installs.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { View } from "react-native";
import { useSettingsData } from "./data.tsx";
import { Section, SettingsRow, SmallButton, Value } from "./ui.tsx";

type Found = { current: string; channel: string; version: string | null; notes: string | null };

/** The words for what a check found: the status at the right of the row. */
export function updateLine(found: Found | null): string {
  if (!found) return "";
  if (!found.version) return "Up to date";
  return `Update available ${found.version}`;
}

const SIGNATURE = "Vyre checks the release signature before it installs. Nothing installs until you say so.";
const hover = (text: string): object => ({ title: text });

export function DesktopUpdateBody({ found, busy, failure, installing, onCheck, onInstall }: { found: Found | null; busy: boolean; failure: string; installing: boolean; onCheck(): void; onInstall(): void }): ReactElement {
  const sub = installing ? "Updating. Vyre will restart in a moment." : failure || (found?.version && found.notes ? found.notes : undefined);
  const status = updateLine(found);
  return (
    <View {...hover(SIGNATURE)}>
      <SettingsRow
        id="update.vyre" first label={found ? `Vyre ${found.current}` : "Vyre"} {...(sub ? { sub } : {})} subAlert={!installing && failure !== ""}
        control={
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            {status ? <Value text={status} testID="update-line" /> : null}
            {found?.version ? <SmallButton label={installing ? "Updating…" : "Install"} testID="update-install" primary disabled={busy} onPress={onInstall} /> : <SmallButton label={busy ? "Checking…" : "Check"} testID="update-check" disabled={busy} onPress={onCheck} />}
          </View>
        }
      />
    </View>
  );
}

export function DesktopUpdate(): ReactElement | null {
  const data = useSettingsData();
  const [found, setFound] = useState<Found | null>(null);
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [failure, setFailure] = useState("");
  const updater = data.desktopUpdater;
  const words = (e: unknown, fallback: string): string => (e instanceof Error && e.message ? e.message : typeof e === "string" && e ? e : fallback);
  const check = async (): Promise<void> => {
    if (!updater) return;
    setBusy(true); setFailure("");
    try { setFound(await updater.check()); } catch (e) { setFailure(words(e, "Couldn't check for updates. Try again.")); } finally { setBusy(false); }
  };
  const install = async (): Promise<void> => {
    if (!updater) return;
    setBusy(true); setInstalling(true); setFailure("");
    try { await updater.install(); } catch (e) { setInstalling(false); setFailure(words(e, "The update did not install. Try again.")); } finally { setBusy(false); }
  };
  useEffect(() => { if (updater) void check(); }, []);
  if (!updater) return null;
  return <Section title="Update Vyre"><DesktopUpdateBody found={found} busy={busy} failure={failure} installing={installing} onCheck={() => void check()} onInstall={() => void install()} /></Section>;
}
