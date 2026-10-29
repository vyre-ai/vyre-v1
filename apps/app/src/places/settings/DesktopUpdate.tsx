// "Update Vyre" on This computer (V1-SPEC 3.13): the desktop app checks its own channel, says what it found, and updates only when the person says so. The check and the install are the shell's
// (src-tauri/src/updater.rs): the page passes nothing and the shell verifies the signature before it installs.
import { useState } from "react";
import type { ReactElement } from "react";
import { Text } from "react-native";
import { useSettingsData } from "./data.tsx";
import { Section, SmallButton } from "./ui.tsx";

type Found = { current: string; channel: string; version: string | null; notes: string | null };

/** The words for what a check found. */
export function updateLine(found: Found | null): string {
  if (!found) return "";
  if (!found.version) return `Vyre ${found.current} is up to date (${found.channel} channel).`;
  return `Vyre ${found.version} is ready. You have ${found.current}.`;
}

export function DesktopUpdateBody({ found, busy, failure, installing, onCheck, onInstall }: { found: Found | null; busy: boolean; failure: string; installing: boolean; onCheck(): void; onInstall(): void }): ReactElement {
  return (
    <>
      <Text>Vyre updates itself from its release channel after checking the release signature. Nothing installs until you say so.</Text>
      {found ? <Text testID="update-line">{updateLine(found)}</Text> : null}
      {found?.version && found.notes ? <Text>{found.notes}</Text> : null}
      {installing ? <Text testID="update-installing">Updating. Vyre will restart in a moment.</Text> : null}
      {failure ? <Text accessibilityRole="alert">{failure}</Text> : null}
      {found?.version
        ? <SmallButton label={installing ? "Updating…" : "Update and restart"} testID="update-install" disabled={busy} onPress={onInstall} />
        : <SmallButton label={busy ? "Checking…" : "Check for updates"} testID="update-check" disabled={busy} onPress={onCheck} />}
    </>
  );
}

export function DesktopUpdate(): ReactElement | null {
  const data = useSettingsData();
  const [found, setFound] = useState<Found | null>(null);
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [failure, setFailure] = useState("");
  const updater = data.desktopUpdater;
  if (!updater) return null;
  const words = (e: unknown, fallback: string): string => (e instanceof Error && e.message ? e.message : typeof e === "string" && e ? e : fallback);
  const check = async (): Promise<void> => {
    setBusy(true); setFailure("");
    try { setFound(await updater.check()); } catch (e) { setFailure(words(e, "Couldn't check for updates. Try again.")); } finally { setBusy(false); }
  };
  const install = async (): Promise<void> => {
    setBusy(true); setInstalling(true); setFailure("");
    try { await updater.install(); } catch (e) { setInstalling(false); setFailure(words(e, "The update did not install. Try again.")); } finally { setBusy(false); }
  };
  return <Section title="Update Vyre"><DesktopUpdateBody found={found} busy={busy} failure={failure} installing={installing} onCheck={() => void check()} onInstall={() => void install()} /></Section>;
}
