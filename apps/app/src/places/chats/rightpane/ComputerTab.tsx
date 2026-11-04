// Right pane > Computer (spec 2.7, 3.2): the agent's screen, what it is doing, the steps of its session, and the sites it is signed in to. Asleep shows the last frame dimmed
// with Wake; working shows a small live view with the caption; after you take over it says "You're in control" with Give back. Click the screen and the computer opens at 90
// percent of the window (P-L9b_08). A Personal Space has no agent computers: one sentence says so.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import type { VirtualWindow } from "../../../../../../ui/src/VirtualList/index.tsx";
import { LiveScreen } from "../computer/LiveScreen.tsx";
import { copyText, giveBack, provision, signOut, sleep, takeOver, wake } from "./actions.ts";
import type { PaneDeps } from "./actions.ts";
import { useOnline, usePaneData, useScreenQuery } from "./data.tsx";
import { GATE, allows, useOptionalShellRuntime } from "../../../shell/providers/runtime.tsx";
import { agoLabel, computerView, dayMonth, stepRows, stepWho, stepsLine } from "./model.ts";
import type { Computer, Session, Step } from "./model.ts";
import { Icon, LeadIcon, PaneList, TextButton, Tool } from "./parts.tsx";
import type { Entry } from "./parts.tsx";

type ComputerOut = CapMap["computers.get"]["out"];
type SessionsOut = CapMap["computers.sessions.list"]["out"];
type TimelineOut = CapMap["computers.timeline"]["out"];

export const COMPUTER_SCREEN = "chats.agent-computer";
export const POPUP_SCREEN = "chats.computer-popup";
export const SCREEN_H = 180;

/** The faux window the screen draws: a bar with three dots and a caption line, then lines of content. The real frame replaces it when the stream arrives. */
function Screen({ view, caption, onPress, name, online, live }: { view: ReturnType<typeof computerView>; caption: string; onPress: () => void; name: string; online: boolean; live?: { computerId: string; state: string; control: boolean } }): ReactElement {
  const dim = view.screen === "asleep";
  const data = usePaneData();
  const body = (
    <>
      <View style={[st.window, dim && { opacity: 0.45 }]}>
        <View style={st.bar}><View style={st.dot} /><View style={st.dot} /><View style={st.dot} /><View style={st.url} /></View>
        <View style={st.body}>
          <View style={[st.line, { width: "42%" }]} />
          <View style={[st.field, view.screen === "live" && { borderColor: "var(--accent)" as string }]} />
          <View style={st.field} />
          <View style={[st.line, { width: "56%" }]} />
        </View>
      </View>
      {dim ? <View style={st.center}><View style={st.wake}><Icon name="moon" size={13} color="var(--ink-2)" /><Text style={st.wakeText}>Wake</Text></View></View> : null}
      {!dim ? <View style={st.cap}><Text numberOfLines={1} style={st.capText}>{view.screen === "mine" ? "You're typing" : caption}</Text></View> : null}
    </>
  );
  const label = view.screen === "asleep" ? `Wake ${name}'s computer` : `Open ${name}'s computer`;
  const style = [st.screen, view.screen === "mine" && st.screenMine, !online && { opacity: 0.6 }];
  // Working or taken over: the real screen, live in the pane. While you are in control your clicks, wheel and keys go to it, here, without opening anything.
  if (live && (live.state === "working" || live.state === "takeover")) {
    return (
      <LiveScreen computerId={live.computerId} state={live.state} call={data.call} spaceUrl={data.spaceUrl} now={() => data.clock().now} control={live.control} keys onIdlePress={onPress}
        testID="computer-screen" streamTestID="computer-stream" label={label} style={style}>{body}</LiveScreen>
    );
  }
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} testID="computer-screen" style={style}>{body}</Pressable>;
}

export function ComputerTab({ deps, window }: { deps: PaneDeps; window?: VirtualWindow }): ReactElement {
  const data = usePaneData();
  const rt = useOptionalShellRuntime();
  // computers.provision takes Manage on the Space, which only owners and admins hold (the same people as access.manage); Take over needs computers.take_over (l-perms: hide what you cannot do)
  const canProvision = allows(rt, GATE.provisionComputer);
  const name = data.agent.name;
  const computerId = data.agent.computerId ?? "";
  if (computerId === "") return <ComputerNone deps={deps} agentId={data.agent.agentId} name={name} canProvision={canProvision} />;
  return <ComputerBody deps={deps} computerId={computerId} canTake={allows(rt, GATE.takeOver)} {...(window ? { window } : {})} />;
}

export interface HostRowOut { hostId: string; kind?: string; name: string; online?: boolean; canRun: boolean; reason?: string; detail?: string; room?: { fits: number; freeMb: number; totalMb: number } }
export type HostsAnswer = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; available: boolean; hosts: readonly HostRowOut[] };

/** What the "no computer yet" pane offers, from what the Space says about where a computer can run. The button is there only when a host can run one; otherwise the real reason is. */
export function setupView(h: HostsAnswer): { kind: "checking" } | { kind: "can" } | { kind: "cannot"; reasons: string[] } {
  if (h.state === "loading") return { kind: "checking" };
  if (h.state === "error") return { kind: "cannot", reasons: [`Vyre could not ask where an agent computer can run: ${h.message}`] };
  if (h.available) return { kind: "can" };
  const reasons = h.hosts.map((x) => x.reason).filter((r): r is string => typeof r === "string" && r !== "");
  return { kind: "cannot", reasons: reasons.length > 0 ? [...new Set(reasons)] : ["No machine in this Space can run an agent computer yet. Add a server with Docker."] };
}

/** The machine that has the most room among those that can run one; the first when they tie. */
export function bestHost(hosts: readonly HostRowOut[]): HostRowOut | undefined {
  let best: HostRowOut | undefined;
  for (const h of hosts) if (h.canRun && (!best || (h.room?.fits ?? 0) > (best.room?.fits ?? 0))) best = h;
  return best;
}

/** "Room for 3 more", "Room for 1 more", "Full": what a machine has left, in words. */
export function roomWords(h: HostRowOut): string {
  if (!h.canRun) return h.reason ?? "Cannot run one";
  if (!h.room) return "Ready";
  return h.room.fits === 0 ? "Full: no room for another" : `Room for ${h.room.fits} more`;
}

/** The small desktop the computer will look like: the wallpaper, a browser window and the dock of Chrome, Terminal and Files. */
export function DeskPicture({ height = 124 }: { height?: number }): ReactElement {
  return (
    <View aria-hidden testID="computer-picture" style={[st.pic, { height }]}>
      <View style={st.picWin}><View style={st.picBar} /><View style={[st.line, { width: "70%", margin: 8 }]} /><View style={[st.line, { width: "50%", marginHorizontal: 8 }]} /></View>
      <View style={st.dock}>{(["globe", "terminal", "folder"] as const).map((n) => <View key={n} style={st.dockItem}><Icon name={n} size={9} color="#fff" /></View>)}</View>
    </View>
  );
}

/** The pane of an agent that has no computer: what it gets, where it will run (the best machine chosen), and one button. When no machine can run one, the real reason and the next step, never a button. */
export function NoneBody({ hosts, canProvision, onProvision, name = "this agent", picked = null, onPick }: { hosts: HostsAnswer; canProvision: boolean; onProvision(hostId: string | null): void; name?: string; picked?: string | null; onPick?(hostId: string): void }): ReactElement {
  const v = setupView(hosts);
  const list = hosts.state === "ready" ? hosts.hosts : [];
  const chosen = list.find((h) => h.hostId === picked && h.canRun) ?? bestHost(list);
  return (
    <View testID="computer-none" style={st.padded}>
      <DeskPicture />
      <Text accessibilityRole="header" style={st.headline}>{`Give ${name} its own computer`}</Text>
      <View testID="computer-gets" style={st.gets}>
        {([["globe", "Its own Chrome, with Vyre for Chrome in it"], ["terminal", "A terminal to run commands in"], ["folder", "A files folder it shares with Vyre Files"]] as const).map(([i, w]) => (
          <View key={w} style={st.get}><Icon name={i} size={14} color="var(--accent)" /><Text style={st.getText}>{w}</Text></View>
        ))}
      </View>
      {v.kind === "checking" ? <Text style={st.none} testID="computer-checking">Checking where its computer can run</Text> : null}
      {v.kind === "cannot" ? (
        <View testID="computer-cannot" style={st.cannot}>
          <View style={st.cannotHead}><Icon name="warn" size={14} color="var(--warn)" /><Text style={st.cannotTitle}>It cannot run here yet</Text></View>
          {v.reasons.map((r) => <Text key={r} style={st.none}>{r}</Text>)}
        </View>
      ) : null}
      {v.kind === "can" ? (
        <>
          <Text style={st.label}>Where it runs</Text>
          <View testID="computer-hosts" style={{ gap: 6 }}>
            {list.map((h) => {
              const on = chosen?.hostId === h.hostId;
              return (
                <Pressable key={h.hostId} testID={`host-${h.hostId}`} accessibilityRole="radio" accessibilityState={{ checked: on, disabled: !h.canRun }} disabled={!h.canRun} onPress={() => onPick?.(h.hostId)} style={[st.host, on && st.hostOn, !h.canRun && { opacity: 0.55 }]}>
                  <View style={[st.radio, on && st.radioOn]} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={st.hostTitle}><Text numberOfLines={1} style={st.hostName}>{h.name}</Text>{h.hostId === bestHost(list)?.hostId && h.canRun ? <Text style={st.best}>Best</Text> : null}</View>
                    {h.detail ? <Text numberOfLines={1} style={st.hostDetail}>{h.detail}</Text> : null}
                    {h.room && h.canRun ? <View style={st.room}><View style={[st.roomFill, { width: `${Math.max(4, Math.min(100, Math.round((h.room.freeMb / Math.max(1, h.room.totalMb)) * 100)))}%` }]} /></View> : null}
                    <Text style={st.hostDetail}>{roomWords(h)}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          {canProvision
            ? <Pressable accessibilityRole="button" testID="computer-provision" onPress={() => onProvision(chosen && chosen.kind === "server" ? chosen.hostId : null)} style={st.go}><Text style={st.goText}>Set up its computer</Text></Pressable>
            : <Text style={st.none} testID="computer-provision-admin">An owner or admin sets up an agent's computer.</Text>}
        </>
      ) : null}
    </View>
  );
}

/** The steps a computer goes through to be ready, from what it reports: the machine, the start, Chrome, and Vyre for Chrome signing in. */
export const SETUP_STEPS = ["Getting the machine ready", "Starting the computer", "Installing Chrome", "Signing in to Vyre"] as const;
export function setupStep(c: Pick<Computer, "state" | "tabs" | "lastFrameAt" | "caption">): number {
  if (c.state === "provisioning") return 0;
  if (c.state === "waking") return 1;
  // awake, but nothing has been seen of it yet: no caption, no frame, and the browser is still coming up
  if (c.state === "working" && c.caption === undefined && c.lastFrameAt === undefined) return c.tabs > 0 ? 3 : 2;
  return c.state === "working" ? SETUP_STEPS.length : 1;
}
export const isSettingUp = (c: Pick<Computer, "state" | "tabs" | "lastFrameAt" | "caption">): boolean => c.state === "provisioning" || c.state === "waking" || (c.state === "working" && setupStep(c) < SETUP_STEPS.length);

/** Real progress, never a bare spinner. */
export function SettingUp({ name, step, where }: { name: string; step: number; where?: string }): ReactElement {
  return (
    <View testID="computer-setting-up" style={st.padded}>
      <Text accessibilityRole="header" style={st.headline}>{`Setting up ${name}'s computer`}</Text>
      <Text style={st.none}>{`${where ? `On ${where}. ` : ""}This takes a minute or two.`}</Text>
      <View style={{ marginTop: 8 }}>
        {SETUP_STEPS.map((w, i) => (
          <View key={w} testID={`setup-step-${i}`} accessibilityLabel={`${w}: ${i < step ? "done" : i === step ? "now" : "waiting"}`} style={st.step}>
            <View style={[st.stepDot, i < step && st.stepDone, i === step && st.stepNow]}>{i < step ? <Icon name="check" size={11} color="#fff" width={2} /> : null}</View>
            <Text style={[st.stepText, i === step && { color: "var(--ink)", fontWeight: "500" }]}>{w}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** The real reason and the next step, and a way to keep the details. */
export function FailedBody({ name, reason, details, onCopy, onAgain }: { name: string; reason: string; details: string; onCopy(text: string): void; onAgain(): void }): ReactElement {
  return (
    <View testID="computer-failed" style={st.padded}>
      <Text accessibilityRole="header" style={st.headline}>{`${name}'s computer`}</Text>
      <View style={st.fail}>
        <View style={st.cannotHead}><Icon name="warn" size={14} color="var(--danger)" /><Text style={st.failTitle}>The computer could not be set up</Text></View>
        <Text testID="computer-fail-reason" style={st.failText}>{reason}</Text>
      </View>
      <View style={st.row2}>
        <TextButton label="Copy details" onPress={() => onCopy(details)} testID="computer-copy-details" />
        <TextButton label="Set up again" primary onPress={onAgain} testID="computer-again" />
      </View>
    </View>
  );
}

/** The name of the machine a computer runs on: the server it was placed on, or the Space's own. */
export function hostName(h: HostsAnswer, nodeId: string | null): string {
  if (h.state !== "ready") return "";
  return (nodeId ? h.hosts.find((x) => x.hostId === nodeId) : h.hosts.find((x) => x.kind === "space" || x.kind === "this"))?.name ?? "";
}

/** The hosts the Space offers, read once for the pane. */
function useHosts(): HostsAnswer {
  const data = usePaneData();
  const [hosts, setHosts] = useState<HostsAnswer>({ state: "loading" });
  useEffect(() => {
    let live = true;
    void data.call("computers.hosts", {}).then((o) => {
      if (!live) return;
      const out = o as { available?: boolean; hosts?: HostRowOut[] };
      setHosts({ state: "ready", available: out.available === true, hosts: Array.isArray(out.hosts) ? out.hosts : [] });
    }).catch((e: unknown) => { if (live) setHosts({ state: "error", message: e instanceof Error ? e.message : "no answer" }); });
    return () => { live = false; };
  }, [data]);
  return hosts;
}

function ComputerNone({ deps, agentId, name, canProvision }: { deps: PaneDeps; agentId: string; name: string; canProvision: boolean }): ReactElement {
  const hosts = useHosts();
  const [picked, setPicked] = useState<string | null>(null);
  return <NoneBody hosts={hosts} canProvision={canProvision} name={name} picked={picked} onPick={setPicked} onProvision={(nodeId) => void provision(deps, agentId, name, nodeId ?? undefined)} />;
}

function ComputerBody({ deps, computerId, window, canTake }: { deps: PaneDeps; computerId: string; window?: VirtualWindow; canTake: boolean }): ReactElement {
  const data = usePaneData();
  const online = useOnline();
  const [sel, setSel] = useState<number | null>(null);
  const hosts = useHosts();
  const q = useScreenQuery<ComputerOut>(COMPUTER_SCREEN, "computer", { computerId });
  const sq = useScreenQuery<SessionsOut>(COMPUTER_SCREEN, "sessions", { computerId });
  const tq = useScreenQuery<TimelineOut>(POPUP_SCREEN, "timeline", { computerId });
  const name = data.agent.name;
  const clock = data.clock();

  if (q.status === "loading") {
    return <View testID="computer-loading" accessibilityLabel="Loading" style={st.padded}><View style={st.skHead} /><View style={st.skScreen} /></View>;
  }

  const c: Computer = q.data.computer;
  const where = c.nodeId ? hostName(hosts, c.nodeId) : hostName(hosts, null);
  if (c.state === "error") {
    const reason = c.error ?? "It could not start. Look at the server's logs for the reason.";
    return <FailedBody name={name} reason={reason} details={`${name}'s computer ${c.computerId}\nstate: error\nreason: ${reason}${where ? `\nruns on: ${where}` : ""}`} onCopy={(text) => void copyText(deps, text)} onAgain={() => void wake(deps, c.computerId, name)} />;
  }
  if (isSettingUp(c)) return <SettingUp name={name} step={setupStep(c)} {...(where ? { where } : {})} />;
  const view = computerView(c);
  const steps: Step[] = tq.status === "ready" ? stepRows(tq.data.steps) : [];
  const sessions: Session[] = sq.status === "ready" ? sq.data.sessions : [];
  const shown = sel !== null ? steps[sel] : undefined;
  const caption = shown ? shown.caption : c.caption ?? view.label;

  // the state is one quiet chip; Open is the picture, Sleep is in the header's "..." and the computer sleeps by itself when idle
  const chipText = view.screen === "asleep" ? "Asleep · wakes when needed" : view.screen === "mine" ? "You're in control" : `Awake · ${c.caption ?? "idle"}`;
  const head = (
    <View testID="computer-head" style={st.head}>
      {shown ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Back to live" onPress={() => setSel(null)} testID="computer-live" style={st.back}>
          <Icon name="back" size={13} /><Text style={st.backText}>Live</Text>
        </Pressable>
      ) : null}
      <View testID="computer-chip" style={st.chip}>
        <View testID="computer-state" accessibilityLabel={view.label} style={[st.statusDot, view.screen === "live" && st.dotLive, view.screen === "mine" && st.dotMine]} />
        <Text numberOfLines={1} style={st.statusText}>{shown ? `Step ${(sel ?? 0) + 1} of ${steps.length}` : chipText}</Text>
      </View>
      <View style={st.grow} />
      {view.action === "give" ? <TextButton label="Give back" primary onPress={() => void giveBack(deps, c.computerId, name, { threadId: data.threadId, agentId: data.agent.agentId })} testID="computer-give" /> : null}
      {canTake && (view.action === "take" || shown) ? <Tool icon="hand" label="Take over" onPress={() => void takeOver(deps, c.computerId, name)} testID="computer-take" /> : null}
    </View>
  );

  const entries: Entry[] = [
    { key: "head", type: "block", node: head },
    {
      key: "screen", type: "block",
      node: <View style={st.padded}><Screen view={view} caption={caption} name={name} online={online} live={{ computerId: c.computerId, state: c.state, control: view.screen === "mine" }} onPress={() => (view.screen === "asleep" ? void wake(deps, c.computerId, name) : view.screen === "mine" ? undefined : data.nav.openComputer(c.computerId))} /></View>,
    },
    { key: "l-session", type: "label", text: view.screen === "asleep" ? "Last session" : "Session", right: stepsLine(steps.length) },
  ];
  if (steps.length === 0) entries.push({ key: "no-steps", type: "empty", text: "Nothing yet. Steps appear as it works." });
  steps.forEach((x, i) => {
    const last = i === steps.length - 1;
    const running = view.screen === "live" && last && x.by === "agent";
    const menu: MenuEntry[] = [
      { label: "Show This Step", onSelect: () => setSel(last ? null : i) },
      { label: "Copy Caption", onSelect: () => void copyText(deps, x.caption) },
      { separator: true },
      { label: "Make a Skill from Here", onSelect: () => data.nav.skillFromStep(c.computerId, x.stepId) },
    ];
    // A finished session reads as the prototype's: the tool and how far into the session the step was (Chrome · 0:02); a live one says how long ago.
    const when = running ? "now" : view.screen === "asleep" ? offsetLabel(x.at - (steps[0]?.at ?? x.at)) : agoLabel(x.at, clock);
    entries.push({
      key: `step-${x.stepId}`, type: "row", title: x.caption, note: `${stepWho(x)} · ${when}`, selected: sel === i,
      leading: <Thumb dark={x.tool === "Terminal"} person={x.by === "person"} />, onPress: () => setSel(last ? null : i), menu, testID: `step-${x.stepId}`,
    });
  });
  entries.push({ key: "l-sites", type: "label", text: "Signed in on its computer" });
  if (sessions.length === 0) entries.push({ key: "no-sites", type: "empty", text: "Not signed in anywhere yet." });
  for (const x of sessions) {
    entries.push({
      key: `site-${x.site}`, type: "row", title: x.site, note: `${x.signedInAs ? `${x.signedInAs} · ` : ""}since ${dayMonth(x.since, clock)}`, leading: <LeadIcon name="lock" />, testID: `site-${x.site}`,
      trailing: (over) => (over ? <Tool icon="x" label={`Sign out of ${x.site}`} onPress={() => void signOut(deps, c.computerId, x.site)} testID={`signout-${x.site}`} /> : null),
      menu: [{ label: "Sign Out", danger: true, onSelect: () => void signOut(deps, c.computerId, x.site) }],
    });
  }
  { const at = where || (c.host === "vm" ? "its own machine" : "the Space server"); entries.push({ key: "runs-on", type: "block", node: <RunsOn text={`On ${at} · ${view.screen === "asleep" ? "asleep" : `${c.tabs} of ${c.tabLimit} tabs`}`} {...(data.nav.openMachines ? { onPress: () => data.nav.openMachines?.(c.nodeId) } : {})} /> }); }
  return <View style={st.fill}><PaneList entries={entries} {...(window ? { window } : {})} testID="computer-list" /></View>;
}

/** The one footer line: where the computer runs and how many tabs it has open; it opens Console, Machines where the shell can. */
export function RunsOn({ text, onPress }: { text: string; onPress?: () => void }): ReactElement {
  const body = <><Icon name="server" size={14} /><Text numberOfLines={1} style={st.footText}>{text}</Text>{onPress ? <Icon name="chev" size={11} /> : null}</>;
  return onPress
    ? <Pressable role="button" accessibilityRole="button" accessibilityLabel={`${text}. Open Machines`} testID="computer-runs-on" onPress={onPress} style={st.foot}>{body}</Pressable>
    : <View testID="computer-runs-on" style={st.foot}>{body}</View>;
}

/** m:ss from a number of milliseconds. */
export function offsetLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The small frame a step shows in its leading slot: a dark window with a bar and two lines, as the prototype's step list draws the screen at that step. */
function Thumb({ dark, person }: { dark: boolean; person: boolean }): ReactElement {
  return (
    <View testID="step-thumb" aria-hidden style={[st.thumb, dark && st.thumbDark, person && st.thumbMine]}>
      <View style={st.thumbBar} /><View style={st.thumbLine} /><View style={[st.thumbLine, { width: "55%" }]} />
    </View>
  );
}

const st = StyleSheet.create({
  pic: { borderRadius: 12, backgroundColor: "#211f33" as string, overflow: "hidden", marginBottom: 12, borderWidth: 1, borderColor: "var(--line-2)" as string },
  picWin: { position: "absolute", left: "12%", right: "12%", top: 14, bottom: 22, borderRadius: 6, backgroundColor: "#f4f3f8" as string, overflow: "hidden" },
  picBar: { height: 10, backgroundColor: "#dcdbe6" as string },
  dock: { position: "absolute", bottom: 5, left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 5 },
  dockItem: { width: 15, height: 15, borderRadius: 5, backgroundColor: "rgba(255,255,255,0.22)" as string, alignItems: "center", justifyContent: "center" },
  headline: { fontSize: 16.5, fontWeight: "600", color: "var(--ink)" as string, marginBottom: 8 },
  gets: { gap: 7, marginBottom: 14 },
  get: { flexDirection: "row", gap: 9, alignItems: "flex-start" },
  getText: { flex: 1, fontSize: 13, lineHeight: 18, color: "var(--ink-2)" as string },
  label: { fontSize: 11.5, color: "var(--ink-3)" as string, marginBottom: 6, marginTop: 2 },
  host: { flexDirection: "row", gap: 10, alignItems: "center", padding: 10, borderRadius: 10, borderWidth: 1, borderColor: "var(--line-2)" as string },
  hostOn: { borderColor: "var(--accent)" as string, backgroundColor: "var(--accent-wash)" as string },
  radio: { width: 15, height: 15, borderRadius: 8, borderWidth: 1.5, borderColor: "var(--line-2)" as string },
  radioOn: { borderWidth: 5, borderColor: "var(--accent)" as string },
  hostTitle: { flexDirection: "row", alignItems: "center", gap: 6 },
  hostName: { fontSize: 13, fontWeight: "500", color: "var(--ink)" as string, flexShrink: 1 },
  best: { fontSize: 10.5, fontWeight: "600", color: "var(--accent)" as string, backgroundColor: "var(--accent-wash)" as string, paddingHorizontal: 6, borderRadius: 6, overflow: "hidden" },
  hostDetail: { fontSize: 11.5, color: "var(--ink-3)" as string },
  room: { height: 4, borderRadius: 2, backgroundColor: "var(--line-2)" as string, marginVertical: 5, overflow: "hidden" },
  roomFill: { height: 4, borderRadius: 2, backgroundColor: "var(--accent)" as string },
  go: { height: 38, borderRadius: 11, backgroundColor: "var(--accent)" as string, alignItems: "center", justifyContent: "center", marginTop: 12 },
  goText: { fontSize: 13.5, fontWeight: "600", color: "var(--accent-ink)" as string },
  cannot: { gap: 4, padding: 10, borderRadius: 10, backgroundColor: "var(--sunk)" as string },
  cannotHead: { flexDirection: "row", alignItems: "center", gap: 7 },
  cannotTitle: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  step: { flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 8 },
  stepDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: "var(--line-2)" as string, alignItems: "center", justifyContent: "center" },
  stepDone: { backgroundColor: "var(--ok)" as string, borderColor: "var(--ok)" as string },
  stepNow: { borderColor: "var(--accent)" as string },
  stepText: { fontSize: 13, color: "var(--ink-3)" as string },
  fail: { padding: 12, borderRadius: 12, backgroundColor: "var(--sunk)" as string, gap: 7, borderWidth: 1, borderColor: "var(--danger)" as string, marginBottom: 10 },
  failTitle: { fontSize: 13.5, fontWeight: "600", color: "var(--danger)" as string },
  failText: { fontSize: 13, lineHeight: 18, color: "var(--ink)" as string },
  row2: { flexDirection: "row", gap: 8 },
  thumb: { width: 38, height: 26, marginRight: 10, borderRadius: 4, paddingHorizontal: 4, paddingTop: 4, gap: 3, backgroundColor: "#1c1d21" as string, borderWidth: 1, borderColor: "var(--line)" as string, overflow: "hidden" },
  thumbDark: { backgroundColor: "#0c0d0f" as string },
  thumbMine: { borderColor: "var(--accent)" as string },
  thumbBar: { height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.28)" as string },
  thumbLine: { height: 2, borderRadius: 1, backgroundColor: "rgba(255,255,255,0.14)" as string, width: "85%" },
  fill: { flex: 1, minHeight: 0 },
  padded: { paddingHorizontal: 24, paddingVertical: 8 },
  none: { fontSize: 12.5, color: "var(--ink-3)" as string, lineHeight: 18 },
  grow: { flex: 1 },
  chip: { flexShrink: 1, height: 26, flexDirection: "row", alignItems: "center", gap: 7, paddingLeft: 9, paddingRight: 11, borderRadius: 12, backgroundColor: "var(--sunk)" as string },
  foot: { flexDirection: "row", alignItems: "center", gap: 9, marginHorizontal: 24, marginTop: 22, paddingVertical: 14, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  footText: { flex: 1, fontSize: 12.5, color: "var(--ink-3)" as string },
  head: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 24, paddingTop: 18, paddingBottom: 10 },
  back: { height: 24, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 4 },
  backText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  status: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 7 },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "var(--ink-4)" as string },
  dotLive: { backgroundColor: "var(--ok)" as string },
  dotMine: { backgroundColor: "var(--accent)" as string },
  statusText: { flexShrink: 1, fontSize: 12.5, fontWeight: "500", color: "var(--ink-2)" as string },
  screen: { height: SCREEN_H, borderRadius: 14, backgroundColor: "var(--sunk)" as string, overflow: "hidden" },
  screenMine: { borderWidth: 1.5, borderColor: "var(--accent)" as string },
  window: { position: "absolute", left: 14, right: 14, top: 14, bottom: 0, borderTopLeftRadius: 8, borderTopRightRadius: 8, backgroundColor: "var(--raised)" as string, overflow: "hidden" },
  bar: { height: 18, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, backgroundColor: "var(--hover)" as string },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "var(--ink-4)" as string },
  url: { flex: 1, height: 8, marginLeft: 8, borderRadius: 4, backgroundColor: "var(--sunk)" as string },
  body: { padding: 10, gap: 7 },
  line: { height: 7, borderRadius: 4, backgroundColor: "var(--sunk)" as string },
  field: { height: 16, borderRadius: 5, borderWidth: 1, borderColor: "var(--line-2)" as string },
  center: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  wake: { height: 28, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: 14, backgroundColor: "var(--raised)" as string },
  wakeText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink)" as string },
  cap: { position: "absolute", left: 10, right: 10, bottom: 10, alignItems: "flex-start" },
  capText: { maxWidth: "100%", fontSize: 11.5, color: "var(--accent-ink)" as string, backgroundColor: "var(--ink)" as string, opacity: 0.86, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, overflow: "hidden" },
  skHead: { height: 20, width: "40%", borderRadius: 5, backgroundColor: "var(--sunk)" as string, marginBottom: 10 },
  skScreen: { height: SCREEN_H, borderRadius: 10, backgroundColor: "var(--sunk)" as string },
});
