// Settings, About Vyre (V1-SPEC 3.13; owner, 3 Nov: "it updates itself"). The version, the channel, when it last checked, Check now, and "Update Vyre automatically", on by default: when it is on,
// a new version installs on start behind the Updating screen (startup/update). When it is off, a newer version waits here as a quiet "Update available" row, with a dot on Settings, and installs
// when the person says so. The check and the install are the shell's (src-tauri/src/updater.rs): the page passes nothing, and the shell verifies the release signature before it installs.
// What's new opens the release's own notes again. In a browser or on a phone the page is the new version as soon as it loads, so only the version and What's new are here.
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { View } from "react-native";
import { useSettingsData } from "./data.tsx";
import type { DesktopUpdater } from "./data.tsx";
import { Section, SettingsRow, SmallButton, Switch, Value } from "./ui.tsx";
import { FROM_KEY, autoUpdateOn, channelLabel, checkedLabel, noteLines, noteUpdateFrom, progressLine, setAutoUpdate } from "../../startup/update/model.ts";
import type { Progress, Store, UpdateCheck, WhatsNew } from "../../startup/update/model.ts";
import { loadWhatsNew, localStore, setUpdateState, subscribeUpdates, updateState, updateWaiting } from "../../startup/update/store.ts";
import type { UpdateState } from "../../startup/update/store.ts";
import { WhatsNewSheet } from "../../startup/update/WhatsNewSheet.tsx";

/** The words at the right of the version row. */
export function updateLine(check: UpdateCheck | null): string {
  if (!check || check.phase === "checking") return "";
  if (check.phase === "failed") return "";
  if (check.phase === "available" && check.version) return `Update available ${check.version}`;
  return "Up to date";
}

export interface AboutBodyProps {
  /** null in a browser: no shell, no updates of its own. */
  desktop: boolean;
  state: UpdateState;
  /** The version the page knows when there is no shell (the build's whats-new.json). */
  webVersion: string | null;
  auto: boolean;
  busy: boolean;
  failure: string;
  progress: Progress | null;
  notes: WhatsNew | null;
  now: number;
  onCheck(): void;
  onInstall(): void;
  onAuto(on: boolean): void;
  onWhatsNew(): void;
}

export function AboutBody(p: AboutBodyProps): ReactElement {
  const check = p.state.check;
  const installing = p.state.installing;
  const version = check?.current ?? p.webVersion;
  const status = p.desktop ? updateLine(check) : "";
  const sub = p.desktop
    ? [check ? `${channelLabel(check.channel)} channel` : null, checkedLabel(check?.checkedAt ?? null, p.now)].filter(Boolean).join(". ")
    : "Vyre here is always the newest version: it updates each time it opens.";
  const waiting = p.desktop && updateWaiting(p.state);
  const lines = noteLines(check?.notes);
  const rows: ReactElement[] = [];
  rows.push(
    <SettingsRow
      key="version" id="about.version" first label={version ? `Vyre ${version}` : "Vyre"} sub={p.failure && !waiting ? p.failure : sub} subAlert={p.failure !== "" && !waiting}
      control={p.desktop ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          {status ? <Value text={status} testID="update-line" /> : null}
          <SmallButton label={p.busy && !installing ? "Checking…" : "Check now"} testID="update-check" disabled={p.busy} onPress={p.onCheck} />
        </View>
      ) : undefined}
    />,
  );
  if (waiting || installing) {
    rows.push(
      <SettingsRow
        key="available" id="about.available" label={installing ? `Updating to ${check?.version ?? ""}` : "Update available"}
        sub={installing ? progressLine(p.progress) : p.failure ? p.failure : lines.length > 0 ? lines.join(" ") : `Vyre ${check?.version ?? ""} is ready to install. Vyre restarts to finish.`}
        subAlert={!installing && p.failure !== ""}
        control={<SmallButton label={installing ? "Updating…" : "Update now"} testID="update-install" primary disabled={p.busy} onPress={p.onInstall} />}
      />,
    );
  }
  if (p.desktop) {
    rows.push(
      <SettingsRow
        key="auto" id="update.auto" label="Update Vyre automatically" sub="When Vyre opens, it installs a new version first and shows you what got better."
        control={<Switch on={p.auto} onChange={p.onAuto} label="Update Vyre automatically" testID="update-auto" />}
      />,
    );
  }
  const hasNotes = (p.notes?.lines.length ?? 0) > 0;
  rows.push(
    <SettingsRow
      key="whatsnew" id="about.whats_new" label="What's new" sub={hasNotes ? `What got better in ${p.notes!.version}` : "Nothing new to show for this version yet."}
      {...(hasNotes ? { onPress: p.onWhatsNew, control: <SmallButton label="Show" testID="whats-new-open" onPress={p.onWhatsNew} /> } : {})}
    />,
  );
  return <View testID="about-vyre">{rows}</View>;
}

const words = (e: unknown, fallback: string): string => (e instanceof Error && e.message ? e.message : typeof e === "string" && e ? e : fallback);

export function AboutVyre({ updater, store: given }: { updater?: DesktopUpdater | undefined; store?: Store | null } = {}): ReactElement {
  const data = useSettingsData();
  const [store] = useState(() => (given === undefined ? localStore() : given));
  const u = updater ?? data.desktopUpdater;
  const state = useSyncExternalStore(subscribeUpdates, updateState, updateState);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [auto, setAuto] = useState(() => autoUpdateOn(store));
  const [notes, setNotes] = useState<WhatsNew | null>(null);
  const [sheet, setSheet] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { let on = true; void loadWhatsNew().then((n) => { if (on) setNotes(n); }); return () => { on = false; }; }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const check = async (): Promise<void> => {
    if (!u) return;
    setBusy(true); setFailure("");
    try { setUpdateState({ check: await u.check() }); setNow(Date.now()); } catch (e) { setFailure(words(e, "Couldn't check for updates. Try again.")); } finally { setBusy(false); }
  };
  const install = async (): Promise<void> => {
    if (!u || !state.check) return;
    setBusy(true); setFailure(""); setProgress(null);
    noteUpdateFrom(store, state.check.current);
    setUpdateState({ installing: true });
    try { await u.install(setProgress); setFailure("The update did not finish. Try again."); }
    catch (e) { setFailure(words(e, "The update did not install. Try again.")); }
    finally { try { store?.removeItem(FROM_KEY); } catch { /* nothing kept */ } setUpdateState({ installing: false }); setBusy(false); }
  };
  // the first open of the page checks when the start did not get an answer
  useEffect(() => { if (u && (state.check === null || state.check.phase === "checking")) void check(); }, []);
  return (
    <Section title="About Vyre" testID="about">
      <AboutBody
        desktop={!!u} state={state} webVersion={notes?.version ?? null} auto={auto} busy={busy} failure={failure} progress={progress} notes={notes} now={now}
        onCheck={() => void check()} onInstall={() => void install()} onAuto={(on) => { setAutoUpdate(store, on); setAuto(on); }} onWhatsNew={() => setSheet(true)}
      />
      {sheet && notes ? <WhatsNewSheet notes={notes} onClose={() => setSheet(false)} /> : null}
    </Section>
  );
}
