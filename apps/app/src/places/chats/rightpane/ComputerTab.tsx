// Right pane > Computer (spec 2.7, 3.2): the agent's screen, what it is doing, the steps of its session, and the sites it is signed in to. Asleep shows the last frame dimmed
// with Wake; working shows a small live view with the caption; after you take over it says "You're in control" with Give back. Click the screen and the computer opens at 90
// percent of the window (P-L9b_08). A Personal Space has no agent computers: one sentence says so.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { NeedsTeamSpace } from "../../../../../../ui/src/NeedsTeamSpace/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import type { VirtualWindow } from "../../../../../../ui/src/VirtualList/index.tsx";
import { copyText, giveBack, provision, signOut, sleep, takeOver, wake } from "./actions.ts";
import type { PaneDeps } from "./actions.ts";
import { useOnline, usePaneData, useScreenQuery } from "./data.tsx";
import { agoLabel, computerView, dayMonth, stepRows, stepWho, stepsLine } from "./model.ts";
import type { Computer, Session, Step } from "./model.ts";
import { Icon, LeadIcon, PaneList, TextButton, Tool } from "./parts.tsx";
import type { Entry } from "./parts.tsx";

type ComputerOut = CapMap["computers.get"]["out"];
type SessionsOut = CapMap["computers.sessions.list"]["out"];
type TimelineOut = CapMap["computers.timeline"]["out"];

export const COMPUTER_SCREEN = "chats.agent-computer";
export const POPUP_SCREEN = "chats.computer-popup";
export const SCREEN_H = 150;

/** The faux window the screen draws: a bar with three dots and a caption line, then lines of content. The real frame replaces it when the stream arrives. */
function Screen({ view, caption, onPress, name, online }: { view: ReturnType<typeof computerView>; caption: string; onPress: () => void; name: string; online: boolean }): ReactElement {
  const dim = view.screen === "asleep";
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={view.screen === "asleep" ? `Wake ${name}'s computer` : `${name}'s computer`}
      onPress={onPress} testID="computer-screen" style={[st.screen, view.screen === "mine" && st.screenMine, !online && { opacity: 0.6 }]}
    >
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
    </Pressable>
  );
}

export function ComputerTab({ deps, window }: { deps: PaneDeps; window?: VirtualWindow }): ReactElement {
  const data = usePaneData();
  const name = data.agent.name;
  const computerId = data.agent.computerId ?? "";
  if (data.space.personal) {
    return <View testID="computer-personal" style={st.padded}><NeedsTeamSpace what="Agent computers" density="regular" /></View>;
  }
  if (computerId === "") {
    return (
      <View testID="computer-none" style={st.padded}>
        <Text style={st.none}>{name} has no computer yet. It gets one when its work needs a browser.</Text>
        <View style={{ alignItems: "flex-start", marginTop: 8 }}><TextButton label="Set up its computer" primary onPress={() => void provision(deps, data.agent.agentId, name)} testID="computer-provision" /></View>
      </View>
    );
  }
  return <ComputerBody deps={deps} computerId={computerId} {...(window ? { window } : {})} />;
}

function ComputerBody({ deps, computerId, window }: { deps: PaneDeps; computerId: string; window?: VirtualWindow }): ReactElement {
  const data = usePaneData();
  const online = useOnline();
  const [sel, setSel] = useState<number | null>(null);
  const headMenu = useMenu();
  const q = useScreenQuery<ComputerOut>(COMPUTER_SCREEN, "computer", { computerId });
  const sq = useScreenQuery<SessionsOut>(COMPUTER_SCREEN, "sessions", { computerId });
  const tq = useScreenQuery<TimelineOut>(POPUP_SCREEN, "timeline", { computerId });
  const name = data.agent.name;
  const clock = data.clock();

  if (q.status === "loading") {
    return <View testID="computer-loading" accessibilityLabel="Loading" style={st.padded}><View style={st.skHead} /><View style={st.skScreen} /></View>;
  }

  const c: Computer = q.data.computer;
  const view = computerView(c);
  const steps: Step[] = tq.status === "ready" ? stepRows(tq.data.steps) : [];
  const sessions: Session[] = sq.status === "ready" ? sq.data.sessions : [];
  const shown = sel !== null ? steps[sel] : undefined;
  const caption = shown ? shown.caption : c.caption ?? view.label;

  const moreItems = (): MenuEntry[] => view.screen === "asleep"
    ? [{ label: "Wake", onSelect: () => void wake(deps, c.computerId, name) }, { label: "Pop Out", onSelect: () => data.nav.openComputer(c.computerId) }]
    : view.screen === "mine"
      ? [{ label: "Give Back", onSelect: () => void giveBack(deps, c.computerId, name) }, { label: "Pop Out", onSelect: () => data.nav.openComputer(c.computerId) }, { separator: true }, { label: "Put to Sleep", onSelect: () => void sleep(deps, c.computerId, name) }]
      : [{ label: "Take Over", onSelect: () => void takeOver(deps, c.computerId, name) }, { label: "Pop Out", onSelect: () => data.nav.openComputer(c.computerId) }, { separator: true }, { label: "Put to Sleep", onSelect: () => void sleep(deps, c.computerId, name) }];

  const head = (
    <View testID="computer-head" style={st.head}>
      {shown ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Back to live" onPress={() => setSel(null)} testID="computer-live" style={st.back}>
          <Icon name="back" size={13} /><Text style={st.backText}>Live</Text>
        </Pressable>
      ) : null}
      <View style={st.status}>
        <View testID="computer-state" accessibilityLabel={view.label} style={[st.statusDot, view.screen === "live" && st.dotLive, view.screen === "mine" && st.dotMine]} />
        <Text numberOfLines={1} style={st.statusText}>{shown ? `Step ${(sel ?? 0) + 1} of ${steps.length}` : view.label}</Text>
      </View>
      {view.action === "wake" ? <TextButton label="Wake" onPress={() => void wake(deps, c.computerId, name)} testID="computer-wake" /> : null}
      {view.action === "give" ? <TextButton label="Give back" primary onPress={() => void giveBack(deps, c.computerId, name)} testID="computer-give" /> : null}
      {view.action === "take" || shown ? <Tool icon="hand" label="Take over" onPress={() => void takeOver(deps, c.computerId, name)} testID="computer-take" /> : null}
      {view.screen !== "asleep" ? <Tool icon="terminal" label="Open terminal" onPress={() => data.nav.openTerminal(c.computerId)} testID="computer-terminal" /> : null}
      <Tool icon="expand" label="Pop out" onPress={() => data.nav.openComputer(c.computerId)} testID="computer-pop" />
      <Tool icon="more" label="More" onPress={(x, y) => headMenu.show(moreItems(), x, y, "other")} testID="computer-more" />
    </View>
  );

  const entries: Entry[] = [
    { key: "head", type: "block", node: head },
    {
      key: "screen", type: "block",
      node: <View style={st.padded}><Screen view={view} caption={caption} name={name} online={online} onPress={() => (view.screen === "asleep" ? void wake(deps, c.computerId, name) : data.nav.openComputer(c.computerId))} /></View>,
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
    entries.push({
      key: `step-${x.stepId}`, type: "row", title: x.caption, note: `${stepWho(x)} · ${running ? "now" : agoLabel(x.at, clock)}`, selected: sel === i,
      leading: <LeadIcon name={x.by === "person" ? "hand" : "watch"} />, onPress: () => setSel(last ? null : i), menu, testID: `step-${x.stepId}`,
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
  return <View style={st.fill}><PaneList entries={entries} {...(window ? { window } : {})} testID="computer-list" />{headMenu.element}</View>;
}

const st = StyleSheet.create({
  fill: { flex: 1, minHeight: 0 },
  padded: { paddingHorizontal: 8, paddingVertical: 8 },
  none: { fontSize: 12.5, color: "var(--ink-3)" as string, lineHeight: 18 },
  head: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingTop: 6 },
  back: { height: 24, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 4 },
  backText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  status: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 7 },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "var(--ink-4)" as string },
  dotLive: { backgroundColor: "var(--ok)" as string },
  dotMine: { backgroundColor: "var(--accent)" as string },
  statusText: { flexShrink: 1, fontSize: 12.5, fontWeight: "500", color: "var(--ink-2)" as string },
  screen: { height: SCREEN_H, borderRadius: 10, backgroundColor: "var(--sunk)" as string, overflow: "hidden" },
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
