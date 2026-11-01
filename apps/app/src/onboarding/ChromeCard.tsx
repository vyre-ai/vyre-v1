// The Chrome step. On the desktop app one button, "Install": the app unpacks the extension into its own folder, opens Chrome on chrome://extensions and shows the folder, then three visual steps
// (turn on Developer mode, Load unpacked, pick the folder). Chrome only installs silently from the Web Store or by company policy, so this guided flow is the honest best. On the web the button
// downloads vyre-chrome.zip from the release, then the same three steps. "Connected" shows by itself when the extension pairs (computers.chrome.status).
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import type { CapCall } from "../shell/session/caps.ts";
import { desktopBrowsers } from "../shell/providers/vault.tsx";
import { Glyph } from "./StepGlyph.tsx";
import { CARD } from "./card-style.ts";

export const EXTENSION_ZIP_URL = "https://github.com/vyre-ai/vyre-v1/releases/latest/download/vyre-chrome.zip";
const CHROME = ["M8 2.500a5.500 5.500 0 100 11 5.500 5.500 0 000-11z", "M8 6a2 2 0 100 4 2 2 0 000-4z", "M8 6h5.200M5.600 9.500L3 5M10.400 9.500L7.800 14"];
const FOLDER = ["M2.500 4.500a1 1 0 011-1h3l1.500 1.500h4.500a1 1 0 011 1v6.500a1 1 0 01-1 1h-9a1 1 0 01-1-1z"];

type Mode = "idle" | "guide" | "ok";
const STEPS = [{ n: 1, label: "Turn on Developer mode" }, { n: 2, label: "Load unpacked" }, { n: 3, label: "Pick the folder" }] as const;

/** What each step looks like in Chrome, drawn small. */
function Shot({ n }: { n: 1 | 2 | 3 }): ReactElement {
  if (n === 1) return <View style={s.shot}><Text style={s.shotText}>Developer mode</Text><View style={s.sw}><View style={s.swDot} /></View></View>;
  if (n === 2) return <View style={s.shot}><View style={s.shotBtn}><Text style={s.shotBtnText}>Load unpacked</Text></View></View>;
  return <View style={[s.shot, s.shotCol]}><Glyph paths={FOLDER} size={28} color="#5AA0FF" width={1.3} /><Text style={s.shotText}>vyre-chrome</Text></View>;
}

export function ChromeCard({ call, device, onConnected, gate, extensionUrl = EXTENSION_ZIP_URL }: { call: CapCall; device: "mac" | "win" | "web" | "phone"; onConnected(): void; gate?(save: (() => Promise<boolean>) | null): void; extensionUrl?: string }): ReactElement {
  const app = device === "mac" || device === "win" ? desktopBrowsers() : undefined;
  const [mode, setMode] = useState<Mode>("idle");
  const [ticked, setTicked] = useState<readonly number[]>([]);
  const [dir, setDir] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // once the extension is added (the guide is open) Continue is live and marks the step done, even before Chrome pairs
  useEffect(() => {
    if (!gate) return undefined;
    gate(mode === "guide" ? async () => true : null);
    return () => gate(null);
  });
  // pairing shows by itself: poll the bridge while the guide is open
  useEffect(() => {
    if (mode !== "guide") return undefined;
    let off = false;
    const look = (): void => { void (call("computers.chrome.status", {}) as Promise<{ connected: boolean }>).then((r) => { if (!off && r.connected) { setMode("ok"); onConnected(); } }).catch(() => undefined); };
    look();
    const t = setInterval(look, 2000);
    return () => { off = true; clearInterval(t); };
  }, [mode, call, onConnected]);
  const start = async (): Promise<void> => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      if (app) { const r = await app.install(); setDir(r.extensionDir); await app.openExtensionsPage(); await app.revealFolder().catch(() => undefined); }
      else void Linking.openURL(extensionUrl);
      setMode("guide");
    } catch (e) { setError(e instanceof Error && e.message ? e.message : "Couldn’t add it. Try again."); } finally { setBusy(false); }
  };
  const copy = (text: string): void => { const c = (globalThis as { navigator?: { clipboard?: { writeText(t: string): unknown } } }).navigator?.clipboard; if (c) void c.writeText(text); };
  if (mode === "ok") return <View testID="chrome-ok" style={s.ok}><View style={s.okDot}><Glyph paths={["M3.500 8.500l3 3 6-7"]} size={20} width={2.2} /></View><Text style={s.okText}>Connected</Text></View>;
  if (mode === "idle") {
    return (
      <View testID="chrome-card" style={s.col}>
        <View style={s.big}><View style={s.chromeTile}><Glyph paths={CHROME} size={20} /></View>
          <Pressable testID="chrome-add" accessibilityRole="button" disabled={busy} onPress={() => void start()} style={[s.primary, busy && s.off]}><Text style={s.primaryText}>{app ? "Install" : "Download for Chrome"}</Text></Pressable>
        </View>
        {error ? <Text testID="chrome-error" style={s.err}>{error}</Text> : null}
      </View>
    );
  }
  const steps: ReactElement[] = [];
  for (const st of STEPS) {
    const on = ticked.includes(st.n);
    steps.push(
      <Pressable key={st.n} testID={`chrome-step-${st.n}`} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => setTicked(on ? ticked.filter((x) => x !== st.n) : [...ticked, st.n])} style={[s.step, on && s.stepOn]}>
        <View style={[s.num, on && s.numOn]}>{on ? <Glyph paths={["M3.500 8.500l3 3 6-7"]} size={11} width={2.600} /> : <Text style={s.numText}>{st.n}</Text>}</View>
        <Shot n={st.n} />
        <Text style={[s.stepLabel, on && s.stepLabelOn]}>{st.label}</Text>
      </Pressable>,
    );
  }
  return (
    <View testID="chrome-guide" style={s.col}>
      <View style={s.steps}>{steps}</View>
      <View style={s.path}>
        <Glyph paths={FOLDER} size={14} color="var(--ink-3)" />
        <Text style={s.pathText} numberOfLines={1}>{app ? (dir || "vyre-chrome") : "vyre-chrome.zip"}</Text>
        {app ? <Pressable accessibilityRole="button" accessibilityLabel="Copy the folder path" onPress={() => copy(dir)} style={s.copy}><Text style={s.copyText}>Copy</Text></Pressable> : <Text style={s.okSmall}>Downloaded</Text>}
      </View>
      <View style={s.row}>
        <Pressable testID="chrome-open-extensions" accessibilityRole="button" onPress={() => { if (app) void app.openExtensionsPage(); else copy("chrome://extensions"); }} style={s.ghost}><Text style={s.ghostText}>{app ? "Open chrome://extensions" : "Copy chrome://extensions"}</Text></Pressable>
        <View style={s.wait}><View style={s.pulse} /><Text style={s.waitText}>Waiting for Chrome</Text></View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  col: { gap: 14 },
  big: { flexDirection: "row", alignItems: "center", gap: 12 },
  chromeTile: { width: 40, height: 40, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundImage: "linear-gradient(135deg,#ea4335,#fbbc05 55%,#34a853)" } as object,
  bigText: { fontSize: 15, fontWeight: "600", color: "var(--ink)" as string },
  primary: CARD.primary,
  primaryText: CARD.primaryText,
  off: { opacity: 0.45 },
  err: CARD.err,
  steps: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  step: { flexGrow: 1, flexBasis: 150, gap: 10, padding: 10, borderRadius: 12, backgroundColor: "var(--win)" as string, borderWidth: 1, borderColor: "var(--line-2)" as string },
  stepOn: { borderColor: "var(--ok)" as string },
  num: { position: "absolute", top: 8, left: 8, zIndex: 1, width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "var(--sunk)" as string, borderWidth: 1, borderColor: "var(--line-2)" as string },
  numOn: { backgroundColor: "var(--ok)" as string, borderWidth: 0 },
  numText: { fontSize: 11, fontWeight: "600", color: "var(--ink-2)" as string },
  stepLabel: { fontSize: 12.5, lineHeight: 16, fontWeight: "500", color: "var(--ink)" as string },
  stepLabelOn: { color: "var(--ink-3)" as string },
  shot: { height: 84, borderRadius: 8, backgroundColor: "var(--sunk)" as string, borderWidth: 1, borderColor: "var(--line)" as string, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 8 },
  shotCol: { flexDirection: "column", gap: 4 },
  shotText: { fontSize: 11.5, color: "var(--ink-2)" as string },
  sw: { width: 28, height: 16, borderRadius: 8, backgroundColor: "var(--accent)" as string, justifyContent: "center", alignItems: "flex-end", paddingHorizontal: 2 },
  swDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: "#fff" },
  shotBtn: { height: 26, paddingHorizontal: 10, borderRadius: 6, justifyContent: "center", backgroundColor: "var(--win)" as string, borderWidth: 1, borderColor: "var(--line-2)" as string },
  shotBtnText: { fontSize: 11.5, fontWeight: "500", color: "var(--ink)" as string },
  path: { flexDirection: "row", alignItems: "center", gap: 8, height: 36, paddingLeft: 12, paddingRight: 6, borderRadius: 8, backgroundColor: "var(--sunk)" as string, borderWidth: 1, borderColor: "var(--line)" as string },
  pathText: { flex: 1, minWidth: 0, fontSize: 12.5, color: "var(--ink-2)" as string },
  copy: { height: 26, paddingHorizontal: 10, borderRadius: 6, justifyContent: "center" },
  copyText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-2)" as string },
  okSmall: { fontSize: 12.5, color: "var(--ok)" as string, paddingRight: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" },
  ghost: CARD.ghost,
  ghostText: CARD.ghostText,
  wait: { flexDirection: "row", alignItems: "center", gap: 8 },
  pulse: { width: 8, height: 8, borderRadius: 4, backgroundColor: "var(--ok)" as string },
  waitText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  ok: { flexDirection: "row", alignItems: "center", gap: 12 },
  okDot: { width: 40, height: 40, borderRadius: 20, backgroundColor: "var(--ok)" as string, alignItems: "center", justifyContent: "center" },
  okText: { fontSize: 15, fontWeight: "600", color: "var(--ink)" as string },
});
