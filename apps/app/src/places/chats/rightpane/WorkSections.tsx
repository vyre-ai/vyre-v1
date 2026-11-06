// Right pane > Computer in the workspace model: a Terminal section (the agent's workspace: its state, the tmux sessions, Attach for people who may) and a Browser section (the agent's profile in
// the Space browser: its live view, Take over, and the logins it keeps). Nothing to set up and no "give it a computer" step. The logic and the two interfaces the workspace and Space browser
// lanes fill are in work-model.ts; a half that is not bound says so in one line.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import type { VirtualWindow } from "../../../../../../ui/src/VirtualList/index.tsx";
import { reasonOf } from "./actions.ts";
import type { PaneDeps } from "./actions.ts";
import { usePaneData, useOnline } from "./data.tsx";
import { dayMonth } from "./model.ts";
import { Icon, LeadIcon, PaneList, TextButton } from "./parts.tsx";
import type { Entry } from "./parts.tsx";
import { attachedNote, browserAction, browserWords, orderSessions, sessionsLine, sharedWait, terminalAction, workspaceWords } from "./work-model.ts";
import type { BrowserData, BrowserView, Tone, WorkspaceData, WorkspaceView } from "./work-model.ts";

/** Is the new layout wanted: a lane has bound its half. A pane with neither draws the single-computer tab. */
export const usesWorkModel = (d: { workspace?: WorkspaceData | undefined; browser?: BrowserData | undefined }): boolean => d.workspace !== undefined || d.browser !== undefined;

type Watched<V> = { status: "none" } | { status: "loading" } | { status: "ready"; view: V };
function useWatched<V>(src: { watch(agentId: string, on: (v: V) => void): () => void } | undefined, agentId: string): Watched<V> {
  const [w, setW] = useState<Watched<V>>(src ? { status: "loading" } : { status: "none" });
  useEffect(() => {
    if (!src) { setW({ status: "none" }); return; }
    setW({ status: "loading" });
    return src.watch(agentId, (view) => setW({ status: "ready", view }));
  }, [src, agentId]);
  return w;
}

const toneColor = (t: Tone): string => (t === "ok" ? "var(--ok)" : t === "warn" ? "var(--warn)" : t === "bad" ? "var(--danger)" : t === "mine" ? "var(--accent)" : "var(--ink-4)");

/** The state as one quiet chip: a dot in the tone's colour and the words. */
export function Chip({ text, tone, testID }: { text: string; tone: Tone; testID?: string }): ReactElement {
  return (
    <View testID={testID} accessibilityLabel={text} style={st.chip}>
      <View style={[st.dot, { backgroundColor: toneColor(tone) as string }]} />
      <Text numberOfLines={1} style={st.chipText}>{text}</Text>
    </View>
  );
}

/** The Terminal section's card: where the workspace runs and its state, and Attach for a person who may. */
export function TerminalCard({ view, name, busy = false, onAttach, quietWait = false }: { view: WorkspaceView; name: string; busy?: boolean; onAttach(): void; /** the waiting line is said once above, not here */ quietWait?: boolean }): ReactElement {
  const w = workspaceWords(view);
  const action = terminalAction(view);
  return (
    <View testID="terminal-card" style={st.card}>
      <View style={st.cardHead}>
        <Chip testID="terminal-state" text={w.chip} tone={w.tone} />
        <View style={st.grow} />
        {action === "attach" ? <TextButton label="Attach" primary disabled={busy} onPress={onAttach} testID="terminal-attach" /> : null}
      </View>
      {w.note && !(quietWait && view.state === "waiting") ? <Text testID="terminal-note" style={[st.note, view.state === "waiting" && st.noteWarn, view.state === "error" && st.noteBad]}>{w.note}</Text> : null}
      {!view.canAttach && view.cannotAttach ? <Text testID="terminal-cannot" style={st.note}>{view.cannotAttach}</Text> : null}
      <Text style={st.sub}>{`${name}'s shell, git and the usual tools${view.host ? ` · on ${view.host}` : ""}`}</Text>
    </View>
  );
}

/** A faux browser window, the stand-in for the live view until the Space browser draws the real one. */
function Frame({ dim, caption, children }: { dim: boolean; caption?: string | undefined; children?: ReactElement | null }): ReactElement {
  return (
    <View testID="browser-frame" style={st.frame}>
      <View style={[st.window, dim && { opacity: 0.45 }]}>
        <View style={st.bar}><View style={st.wdot} /><View style={st.wdot} /><View style={st.wdot} /><View style={st.url} /></View>
        <View style={st.body}><View style={[st.line, { width: "42%" }]} /><View style={st.field} /><View style={st.field} /><View style={[st.line, { width: "56%" }]} /></View>
      </View>
      {caption ? <View style={st.cap}><Text numberOfLines={1} style={st.capText}>{caption}</Text></View> : null}
      {children}
    </View>
  );
}

/** The Browser section's card: the live view (or its picture), the state, and Take over or Give back. */
export function BrowserCard({ view, name, live, busy = false, onTake, onGive, onOpen, quietWait = false }: { view: BrowserView; name: string; live?: ReactElement | undefined; busy?: boolean; onTake(): void; onGive(): void; onOpen(): void; quietWait?: boolean }): ReactElement {
  const w = browserWords(view);
  const action = browserAction(view);
  const dim = view.state === "closed" || view.state === "starting" || view.state === "waiting" || view.state === "error";
  return (
    <View testID="browser-card" style={st.card}>
      <View style={st.cardHead}>
        <Chip testID="browser-state" text={w.chip} tone={w.tone} />
        <View style={st.grow} />
        {action === "give" ? <TextButton label="Give back" primary disabled={busy} onPress={onGive} testID="browser-give" /> : null}
        {action === "take" ? <TextButton label="Take over" filled disabled={busy} onPress={onTake} testID="browser-take" /> : null}
      </View>
      {view.canTakeOver
        ? (live && (view.state === "open" || view.state === "takeover")
          ? <View testID="browser-live" style={st.liveBox}>{live}</View>
          : (
            <Frame dim={dim} caption={view.state === "open" ? view.caption : undefined}>
              {view.state === "closed" ? <View style={st.center}><Pressable accessibilityRole="button" accessibilityLabel={`Open ${name}'s browser`} testID="browser-open" onPress={onOpen} style={st.pill}><Icon name="globe" size={13} color="var(--ink-2)" /><Text style={st.pillText}>Open</Text></Pressable></View> : null}
            </Frame>
          ))
        : null}
      {w.note && view.state !== "open" && !(quietWait && view.state === "waiting") ? <Text testID="browser-note" style={[st.note, view.state === "waiting" && st.noteWarn, view.state === "error" && st.noteBad]}>{w.note}</Text> : null}
      {!view.canTakeOver && view.state !== "takeover" && view.cannotTakeOver ? <Text testID="browser-cannot" style={st.note}>{view.cannotTakeOver}</Text> : null}
      <Text style={st.sub}>{`${name} browses in its own profile on the Space${view.host ? ` · ${view.host}` : ""}. Your Chrome is not touched.`}</Text>
    </View>
  );
}

/** One line where a half is not bound yet. */
export function NotYet({ what, testID }: { what: string; testID: string }): ReactElement {
  return <Text testID={testID} style={[st.note, { paddingHorizontal: 24 }]}>{`${what} is not available on this server yet.`}</Text>;
}

/** The pane: Terminal, then Browser. */
export function WorkSections({ deps, window }: { deps: PaneDeps; window?: VirtualWindow }): ReactElement {
  const data = usePaneData();
  const online = useOnline();
  const agentId = data.agent.agentId;
  const name = data.agent.name;
  const clock = data.clock();
  const ws = useWatched<WorkspaceView>(data.workspace, agentId);
  const br = useWatched<BrowserView>(data.browser, agentId);
  const [busy, setBusy] = useState<"attach" | "take" | "give" | "open" | null>(null);
  const run = (what: NonNullable<typeof busy>, f: () => Promise<void>): void => {
    setBusy(what);
    void f().catch((e: unknown) => deps.note(reasonOf(e) || "That did not work. Try again.")).finally(() => setBusy(null));
  };

  const entries: Entry[] = [];
  const wait = sharedWait(ws.status === "ready" ? ws.view : undefined, br.status === "ready" ? br.view : undefined);
  if (wait !== null) entries.push({ key: "wait", type: "block", node: <View style={st.waitBox}><Text testID="work-wait" style={st.waitText}>{wait}</Text></View> });
  entries.push({ key: "l-terminal", type: "label", text: "Terminal", ...(ws.status === "ready" && ws.view.canAttach && (ws.view.state === "running" || ws.view.state === "asleep") ? { right: sessionsLine(ws.view.sessions.length) } : {}) });
  if (ws.status === "none") entries.push({ key: "terminal-none", type: "block", node: <NotYet what={`${name}'s terminal`} testID="terminal-none" /> });
  else if (ws.status === "loading") entries.push({ key: "terminal-loading", type: "block", node: <View testID="terminal-loading" accessibilityLabel="Loading" style={st.sk} /> });
  else {
    const v = ws.view;
    entries.push({ key: "terminal-card", type: "block", node: <TerminalCard view={v} name={name} quietWait={wait !== null} busy={busy === "attach" || !online} onAttach={() => run("attach", () => data.workspace!.attach(agentId))} /> });
    // what is open in a terminal is for the people who may attach to it
    for (const s of v.canAttach ? orderSessions(v.sessions) : []) {
      entries.push({ key: `session-${s.name}`, type: "row", title: s.name, note: attachedNote(s, name), leading: <LeadIcon name="terminal" />, testID: `session-${s.name}` });
    }
    if (v.canAttach && v.sessions.length === 0 && (v.state === "running" || v.state === "asleep")) entries.push({ key: "no-sessions", type: "empty", text: "No sessions yet." });
    for (const p of v.projects ?? []) entries.push({ key: `project-${p}`, type: "row", title: p, note: "Shared project folder", leading: <LeadIcon name="folder" />, testID: `project-${p}` });
  }

  entries.push({ key: "l-browser", type: "label", text: "Browser" });
  if (br.status === "none") entries.push({ key: "browser-none", type: "block", node: <NotYet what={`${name}'s browser`} testID="browser-none" /> });
  else if (br.status === "loading") entries.push({ key: "browser-loading", type: "block", node: <View testID="browser-loading" accessibilityLabel="Loading" style={[st.sk, { height: 200 }]} /> });
  else {
    const v = br.view;
    entries.push({
      key: "browser-card", type: "block",
      node: <BrowserCard view={v} name={name} quietWait={wait !== null} busy={!online || busy !== null} live={data.browser?.renderLive?.(agentId, { state: v.state, control: v.state === "takeover" && v.mine === true })}
        onOpen={() => run("open", () => data.browser!.open(agentId))} onTake={() => run("take", () => data.browser!.takeOver(agentId))} onGive={() => run("give", () => data.browser!.giveBack(agentId))} />,
    });
    // the logins its profile keeps are for the people who may see and take over the browser
    if (v.canTakeOver) entries.push({ key: "l-sites", type: "label", text: "Signed in on its browser" });
    if (v.canTakeOver && v.sites.length === 0) entries.push({ key: "no-sites", type: "empty", text: "Not signed in anywhere yet." });
    for (const x of v.canTakeOver ? v.sites : []) {
      const out = (): void => run("open", () => data.browser!.signOut(agentId, x.site));
      const menu: MenuEntry[] = [{ label: "Sign Out", danger: true, onSelect: out }];
      entries.push({ key: `site-${x.site}`, type: "row", title: x.site, note: `${x.signedInAs ? `${x.signedInAs} · ` : ""}since ${dayMonth(x.since, clock)}`, leading: <LeadIcon name="lock" />, testID: `site-${x.site}`, menu });
    }
  }
  return <View style={st.fill}><PaneList entries={entries} {...(window ? { window } : {})} testID="work-list" /></View>;
}

const st = StyleSheet.create({
  fill: { flex: 1, minHeight: 0 },
  grow: { flex: 1 },
  waitBox: { marginHorizontal: 24, marginTop: 10, marginBottom: 2, gap: 8 },
  waitText: { fontSize: 13, lineHeight: 18, color: "var(--ink)" as string },
  card: { marginHorizontal: 24, marginVertical: 6, gap: 8 },
  cardHead: { minHeight: 30, flexDirection: "row", alignItems: "center", gap: 8 },
  chip: { flexShrink: 1, height: 26, flexDirection: "row", alignItems: "center", gap: 7, paddingLeft: 9, paddingRight: 11, borderRadius: 12, backgroundColor: "var(--sunk)" as string },
  chipText: { flexShrink: 1, fontSize: 12.5, fontWeight: "500", color: "var(--ink-2)" as string },
  dot: { width: 7, height: 7, borderRadius: 4 },
  note: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-3)" as string },
  noteWarn: { color: "var(--ink)" as string },
  noteBad: { color: "var(--danger)" as string },
  sub: { fontSize: 11.5, lineHeight: 16, color: "var(--ink-3)" as string },
  sk: { height: 90, marginHorizontal: 24, borderRadius: 10, backgroundColor: "var(--sunk)" as string },
  liveBox: { height: 180, borderRadius: 14, overflow: "hidden", backgroundColor: "#17161f" as string },
  frame: { height: 180, borderRadius: 14, backgroundColor: "#17161f" as string, backgroundImage: "radial-gradient(120% 120% at 20% 10%, #3a3468, #17161f 70%)", overflow: "hidden" } as object,
  window: { position: "absolute", left: "8%", right: "8%", top: 34, bottom: 12, borderRadius: 8, backgroundColor: "#f8f8fb" as string, overflow: "hidden" },
  bar: { height: 18, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, backgroundColor: "#e9e8ef" as string },
  wdot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "#b9b8c6" as string },
  url: { flex: 1, height: 8, marginLeft: 8, borderRadius: 4, backgroundColor: "#f8f8fb" as string },
  body: { padding: 10, gap: 7 },
  line: { height: 7, borderRadius: 4, backgroundColor: "#dcdbe6" as string },
  field: { height: 16, borderRadius: 5, borderWidth: 1, borderColor: "#cfcedb" as string },
  center: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  pill: { height: 28, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: 14, backgroundColor: "var(--raised)" as string },
  pillText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink)" as string },
  cap: { position: "absolute", left: 10, right: 10, top: 8, alignItems: "flex-start" },
  capText: { maxWidth: "100%", fontSize: 11.5, color: "#fff" as string, backgroundColor: "rgba(12,12,16,0.82)" as string, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, overflow: "hidden" },
});
