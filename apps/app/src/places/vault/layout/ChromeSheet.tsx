// Install Vyre for Chrome from the desktop app (spec 3.12, 3.13). There is no Web Store listing yet, so the app copies the extension into a folder of its own and registers the native host; Chrome then needs
// three clicks the app cannot make for the person, and this sheet says them plainly with the folder to pick.
import { useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Btn } from "./parts.tsx";
import { Sheet } from "./Sheet.tsx";
import type { VaultBrowsers } from "./data.tsx";

type Done = { extensionDir: string; version: string; browsers: string[] };

/** The three steps once the extension is in place; `folder` is the path to pick in Load unpacked. */
export function chromeSteps(folder: string): string[] {
  return [
    "Open Chrome's extensions page (the button below), and turn on Developer mode at the top right.",
    `Choose Load unpacked, then pick this folder: ${folder}`,
    "Open the puzzle-piece menu in Chrome and pin Vyre for Chrome, so its button is always there.",
  ];
}

/** What the sheet shows for one state; the stateful sheet below feeds it. */
export function ChromeSheetBody({ done, busy, failure, onOpen, onReveal }: { done: Done | null; busy: boolean; failure: string; onOpen(): void; onReveal(): void }): ReactElement {
  return (
    <>
      <Text style={s.intro}>Fill logins and codes from your Vault, and save new logins, right in Chrome. It talks only to this app on this computer.</Text>
      {done ? (
        <View testID="vault-chrome-steps">
          <Text style={s.ok}>{`Installed${done.version ? ` ${done.version}` : ""} for ${done.browsers.join(", ")}. Chrome needs three clicks from you:`}</Text>
          {chromeSteps(done.extensionDir).map((step, i) => <Text key={i} style={s.step}>{`${i + 1}. ${step}`}</Text>)}
          <View style={s.actions}>
            <Btn label="Open Chrome extensions" disabled={busy} onPress={onOpen} testID="vault-chrome-open" />
            <Btn label="Show the folder" disabled={busy} onPress={onReveal} testID="vault-chrome-reveal" />
          </View>
        </View>
      ) : <Text style={s.intro}>Vyre puts the extension in a folder of its own and tells Chrome where to find this app. You then add it once in Chrome.</Text>}
      {failure ? <Text style={s.error} accessibilityRole="alert">{failure}</Text> : null}
    </>
  );
}

export function ChromeSheet({ browsers, onClose }: { browsers: VaultBrowsers; onClose(): void }): ReactElement {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [failure, setFailure] = useState("");
  const run = async (what: () => Promise<unknown>, fallback: string): Promise<void> => {
    setBusy(true); setFailure("");
    try { await what(); } catch (error) { setFailure(error instanceof Error && error.message ? error.message : typeof error === "string" && error ? error : fallback); }
    finally { setBusy(false); }
  };
  const install = (): Promise<void> => run(async () => { setDone(await browsers.install()); }, "Couldn't install Vyre for Chrome. Try again.");
  return (
    <Sheet title="Vyre for Chrome" onClose={onClose} testID="vault-chrome-sheet" footer={<><View style={{ flex: 1 }} /><Btn label="Done" onPress={onClose} testID="vault-chrome-done" />{done ? null : <Btn label={busy ? "Installing…" : "Install Vyre for Chrome"} primary disabled={busy} onPress={() => void install()} testID="vault-chrome-install" />}</>}>
      <ChromeSheetBody done={done} busy={busy} failure={failure}
        onOpen={() => void run(() => browsers.openExtensionsPage(), "Couldn't open Chrome. Open it and go to chrome://extensions.")}
        onReveal={() => void run(() => browsers.revealFolder(), "Couldn't open the folder.")} />
    </Sheet>
  );
}

const s = StyleSheet.create({
  intro: { fontSize: 14, lineHeight: 20, marginBottom: 12 },
  ok: { fontSize: 14, lineHeight: 20, fontWeight: "600", marginBottom: 8 },
  step: { fontSize: 14, lineHeight: 21, marginBottom: 6 },
  actions: { flexDirection: "row", gap: 8, marginTop: 10 },
  error: { fontSize: 13, color: "#b3261e", marginTop: 10 },
});
