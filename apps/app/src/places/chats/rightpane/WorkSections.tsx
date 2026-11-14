// Right pane > Computer as drawn (AGENT-COMPUTER-2026-11-13.md part A): Terminals (every terminal of the agent's computer, its helpers' and people's tabs, each a row that opens full screen; the agent's own is
// already open, nothing to attach), Browser (one live picture that opens the browser full screen; Take over lives there), and what it is signed in to. Nothing to set up. The logic is in work-model.ts.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import type { VirtualWindow } from "../../../../../../ui/src/VirtualList/index.tsx";
import { reasonOf } from "./actions.ts";
import type { PaneDeps } from "./actions.ts";
import { usePaneData, useOnline } from "./data.tsx";
import { GATE, allows, useOptionalShellRuntime } from "../../../shell/providers/runtime.tsx";
import { dayMonth } from "./model.ts";
import { Icon, LeadIcon, PaneList, TextButton } from "./parts.tsx";
import type { Entry } from "./parts.tsx";
import { BrowserSheet } from "./BrowserSheet.tsx";
import { TerminalSheet } from "./TerminalSheet.tsx";
import { PreviewImage } from "./PreviewImage.tsx";
import { useWhenText } from "../../../../../../ui/src/Time/index.tsx";
import { Dot, GroupHead, SectionHead } from "./WorkParts.tsx";
import { browserHead, groupSessions, olderDesktopMenu, sessionWords, sharedWait, terminalsHead } from "./work-model.ts";
import type { BrowserData, BrowserView, WorkspaceData, WorkspaceView } from "./work-model.ts";

/** Is the new layout wanted: the browser half is bound, or the workspace is and the agent has no legacy desktop computer. An agent that still has one keeps today's Computer tab until the browser half is bound. */
export const usesWorkModel = (d: {
  workspace?: WorkspaceData | undefined;
  browser?: BrowserData | undefined;
  agent?: { computerId?: string | undefined } | undefined;
}): boolean => d.browser !== undefined || (d.workspace !== undefined && (d.agent?.computerId ?? "") === "");

type Watched<V> = { status: "none" } | { status: "loading" } | { status: "ready"; view: V };
function useWatched<V>(
  src: { watch(agentId: string, on: (v: V) => void): () => void } | undefined,
  agentId: string,
): Watched<V> {
  const [w, setW] = useState<Watched<V>>(src ? { status: "loading" } : { status: "none" });
  useEffect(() => {
    if (!src) {
      setW({ status: "none" });
      return;
    }
    // a new source keeps what was drawn until its first answer: no flicker when the pane data is rebuilt
    setW((was) => (was.status === "ready" ? was : { status: "loading" }));
    return src.watch(agentId, (view) => setW({ status: "ready", view }));
  }, [src, agentId]);
  return w;
}

/** One line where a half is not bound yet. */
export function NotYet({ what, testID }: { what: string; testID: string }): ReactElement {
  return (
    <Text
      testID={testID}
      style={[st.note, { paddingHorizontal: 24 }]}
    >{`${what} is not available on this server yet.`}</Text>
  );
}

/** The browser's one picture in the pane: the live view (off while asleep) in a fixed 8:5 box, and the whole box is one button that opens the browser full screen. */
export function BrowserPicture({
  view,
  name,
  live,
  onOpen,
  caption,
}: {
  view: BrowserView;
  name: string;
  live?: ReactElement | undefined;
  onOpen(): void;
  caption: string;
}): ReactElement {
  const awake = view.state === "open" || view.state === "takeover";
  return (
    <View style={st.pic}>
      <View style={[st.box]}>
        <View style={st.skeleton}>
          <View style={[st.sk, { width: "44%" }]} />
          <View style={[st.sk, { width: "72%" }]} />
          <View style={[st.sk, { width: "56%" }]} />
        </View>
        {awake && live ? (
          <View testID="browser-live" style={st.liveOver}>
            {live}
          </View>
        ) : (
          <View style={st.playWrap}>
            <View style={st.play}>
              <Icon name="globe" size={18} color="var(--ink-2)" />
            </View>
          </View>
        )}
        {/* the press layer sits above everything in the box, so a click always reaches it, whatever the live view draws */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${name}'s browser`}
          testID="browser-picture"
          onPress={onOpen}
          style={({ hovered }: { hovered?: boolean }) => [st.press, hovered === true && st.pressOver]}
        />
      </View>
      <Text testID="browser-caption" numberOfLines={1} style={st.cap}>
        {caption}
      </Text>
    </View>
  );
}

/** The pane: Terminals, Browser, what it is signed in to. */
export function WorkSections({ deps, window }: { deps: PaneDeps; window?: VirtualWindow }): ReactElement {
  const data = usePaneData();
  const online = useOnline();
  const agentId = data.agent.agentId;
  const name = data.agent.name;
  const clock = data.clock();
  const when = useWhenText();
  const ws = useWatched<WorkspaceView>(data.workspace, agentId);
  const br = useWatched<BrowserView>(data.browser, agentId);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [termSheet, setTermSheet] = useState<string | null>(null);
  const rt = useOptionalShellRuntime();
  const canManageComputers = allows(rt, GATE.provisionComputer);
  const run = (f: () => Promise<void>): void => {
    setBusy(true);
    void f()
      .catch((e: unknown) => deps.note(reasonOf(e) || "That did not work. Try again."))
      .finally(() => setBusy(false));
  };
  // The agent's terminal is open before anyone asks: when the computer has room and none is open, one is opened here, in the background (nothing waits for it)
  const wsView = ws.status === "ready" ? ws.view : undefined;
  const needsOne =
    wsView !== undefined &&
    wsView.canAttach &&
    (wsView.state === "running" || wsView.state === "asleep") &&
    wsView.sessions.length === 0;
  useEffect(() => {
    if (!needsOne) return;
    void data.workspace?.ensure?.(agentId)?.catch(() => undefined);
  }, [needsOne, data.workspace, agentId]);

  const entries: Entry[] = [];
  const wait = sharedWait(wsView, br.status === "ready" ? br.view : undefined);
  if (wait !== null)
    entries.push({
      key: "wait",
      type: "block",
      node: (
        <View style={st.waitBox}>
          <Text testID="work-wait" style={st.waitText}>
            {wait}
          </Text>
        </View>
      ),
    });

  // ---- Terminals
  if (ws.status === "none") {
    entries.push({ key: "l-terminal", type: "block", node: <SectionHead text="Terminals" /> });
    entries.push({
      key: "terminal-none",
      type: "block",
      node: <NotYet what={`${name}'s terminal`} testID="terminal-none" />,
    });
  } else if (ws.status === "loading") {
    entries.push({ key: "l-terminal", type: "block", node: <SectionHead text="Terminals" /> });
    entries.push({
      key: "terminal-loading",
      type: "block",
      node: <View testID="terminal-loading" accessibilityLabel="Loading" style={st.sk2} />,
    });
  } else {
    const v = ws.view;
    const h = terminalsHead(v);
    entries.push({
      key: "l-terminal",
      type: "block",
      node: <SectionHead testID="terminals-head" text="Terminals" dot={h.dot} word={h.word} />,
    });
    if (!v.canAttach && v.state !== "unavailable") {
      // access none: one line, no list
      entries.push({
        key: "terminal-cannot",
        type: "block",
        node: (
          <View testID="terminal-cannot" style={st.lock}>
            <Icon name="lock" size={16} color="var(--ink-3)" />
            <Text style={st.lockTitle}>{`You cannot see ${name}'s computer`}</Text>
            <Text style={st.note}>{`Only people who can use ${name} can.`}</Text>
          </View>
        ),
      });
    } else if (v.state === "unavailable") {
      entries.push({
        key: "terminal-note",
        type: "block",
        node: (
          <View style={st.fault}>
            <Text testID="terminal-note" style={st.note}>
              {v.line ?? "This Space cannot run a computer yet."}
            </Text>
            {canManageComputers && data.nav.openMachines ? (
              <TextButton
                label="Open Console > Computers"
                primary
                onPress={() => data.nav.openMachines?.()}
                testID="terminal-open-console"
              />
            ) : null}
          </View>
        ),
      });
    } else if (v.state === "error" || v.state === "waiting") {
      if (!(wait !== null && v.state === "waiting"))
        entries.push({
          key: "terminal-note",
          type: "block",
          node: (
            <View style={st.fault}>
              <Text style={st.faultTitle}>
                {v.state === "waiting" ? "Waiting for room" : "This computer could not start"}
              </Text>
              <Text testID="terminal-note" style={st.note}>
                {v.line ??
                  (v.state === "waiting"
                    ? "Other computers are running. Yours starts when one stops."
                    : "The computer did not start.")}
              </Text>
              {v.state === "error" ? (
                <TextButton
                  label="Retry"
                  primary
                  disabled={busy || !online}
                  onPress={() => run(() => data.workspace!.wake(agentId))}
                  testID="terminal-retry"
                />
              ) : null}
            </View>
          ),
        });
    } else {
      const asleep = v.state === "asleep";
      const groups = groupSessions(v.sessions, name, { me: data.me?.id, nameOf: data.nameOf });
      for (const g of groups) {
        entries.push({
          key: `g-${g.key}`,
          type: "block",
          node: <GroupHead name={g.name} tag={g.tag} agent={g.kind !== "person"} />,
        });
        for (const sx of g.rows) {
          const w = sessionWords(sx, asleep, { me: data.me?.id, nameOf: data.nameOf });
          entries.push({
            key: `session-${sx.terminalId ?? sx.name}`,
            type: "row",
            title: sx.name,
            ...(sx.cwd ? { suffix: sx.cwd } : {}),
            ...(sx.lastLine ? { note: sx.lastLine } : {}),
            leading: (
              <View style={st.dotLead}>
                <Dot tone={w.dot} />
              </View>
            ),
            trailing: <Text style={st.state}>{w.word}</Text>,
            testID: `session-${sx.name}`,
            ...(sx.terminalId !== undefined
              ? {
                  onPress: () =>
                    data.terminal ? setTermSheet(sx.terminalId!) : data.workspace?.open?.(sx.terminalId!),
                }
              : {}),
          });
        }
      }
      // nothing open yet (the background open has not landed): the one row it will be, already there and pressable
      if (groups.length === 0)
        entries.push({
          key: "session-ready",
          type: "row",
          title: "main",
          leading: (
            <View style={st.dotLead}>
              <Dot tone={asleep ? "zz" : "idle"} />
            </View>
          ),
          trailing: <Text style={st.state}>{asleep ? "Asleep" : "Ready"}</Text>,
          testID: "session-main",
          onPress: () =>
            run(async () => {
              const id = (await data.workspace?.ensure?.(agentId)) ?? undefined;
              if (id !== undefined && data.terminal) setTermSheet(id);
              else await data.workspace!.attach(agentId);
            }),
        });
      for (const p of v.projects ?? [])
        entries.push({
          key: `project-${p}`,
          type: "row",
          title: p,
          note: "Shared project folder",
          leading: <LeadIcon name="folder" />,
          testID: `project-${p}`,
        });
    }
  }

  // ---- Browser
  if (br.status === "none") {
    entries.push({ key: "l-browser", type: "block", node: <SectionHead text="Browser" /> });
    entries.push({
      key: "browser-none",
      type: "block",
      node: <NotYet what={`${name}'s browser`} testID="browser-none" />,
    });
  } else if (br.status === "loading") {
    entries.push({ key: "l-browser", type: "block", node: <SectionHead text="Browser" /> });
    entries.push({
      key: "browser-loading",
      type: "block",
      node: (
        <View
          testID="browser-loading"
          accessibilityLabel="Loading"
          style={[st.sk2, { aspectRatio: 1.6, height: undefined }]}
        />
      ),
    });
  } else {
    const v = br.view;
    const h = browserHead(v);
    entries.push({
      key: "l-browser",
      type: "block",
      node: <SectionHead testID="browser-head" text="Browser" dot={h.dot} word={h.word} />,
    });
    if (!v.canTakeOver) {
      // a browser that cannot run says so in one line; a person who may not open it is told why
      const said = v.state === "error" || v.state === "waiting" ? v.line : undefined;
      entries.push({
        key: "browser-cannot",
        type: "block",
        node: (
          <Text
            testID={said !== undefined ? "browser-note" : "browser-cannot"}
            style={[st.note, { paddingHorizontal: 24 }]}
          >
            {said ?? v.cannotTakeOver ?? `You cannot open ${name}'s browser.`}
          </Text>
        ),
      });
    } else {
      const caption =
        v.state === "closed"
          ? v.lastActiveAt !== undefined
            ? `Asleep. Last seen ${when(v.lastActiveAt, clock.now)}`
            : `Asleep. Opens when ${name} loads a page.`
          : v.state === "takeover"
            ? v.mine === true
              ? "You have the browser"
              : `${v.takenBy ?? "Someone"} has the browser`
            : v.state === "waiting"
              ? "Waiting for room"
              : v.state === "error"
                ? "The browser stopped"
                : (v.caption ?? "");
      entries.push({
        key: "browser-picture",
        type: "block",
        node: (
          <BrowserPicture
            view={v}
            name={name}
            caption={caption}
            onOpen={() => setSheet(true)}
            live={
              <PreviewImage
                call={data.call}
                agentId={agentId}
                active={!sheet && (v.state === "open" || v.state === "takeover")}
              />
            }
          />
        ),
      });
      // the logins its profile keeps; the section is there only when there are some
      if (v.sites.length > 0)
        entries.push({ key: "l-sites", type: "block", node: <SectionHead text="Signed in on its computer" /> });
      for (const x of v.sites) {
        const out = (): void => run(() => data.browser!.signOut(agentId, x.site));
        const menu: MenuEntry[] = [{ label: "Sign out", danger: true, onSelect: out }];
        entries.push({
          key: `site-${x.site}`,
          type: "row",
          title: x.site,
          note: `${x.signedInAs ? `${x.signedInAs} \u00b7 ` : ""}${dayMonth(x.since, clock)}`,
          leading: <LeadIcon name="lock" />,
          testID: `site-${x.site}`,
          menu,
        });
      }
    }
  }
  // An agent that still has an older desktop keeps a way to open it, one row, until Console removes it
  const older = data.agent.computerId ?? "";
  if (older !== "") {
    entries.push({ key: "l-older", type: "block", node: <SectionHead text="Older desktop" /> });
    const menu: MenuEntry[] = olderDesktopMenu({
      canRemove: canManageComputers,
      open: data.nav.openComputerInConsole ? () => data.nav.openComputerInConsole?.(older) : undefined,
    });
    entries.push({
      key: "older-desktop",
      type: "row",
      title: "Open its desktop",
      leading: <LeadIcon name="watch" />,
      testID: "older-desktop",
      onPress: () => data.nav.openComputer(older),
      ...(menu.length > 0 ? { menu } : {}),
    });
  }
  return (
    <View style={st.fill}>
      <PaneList entries={entries} {...(window ? { window } : {})} testID="work-list" />
      {sheet && br.status === "ready" && data.browser ? (
        <BrowserSheet
          agentId={agentId}
          name={name}
          view={br.view}
          data={data.browser}
          onClose={() => setSheet(false)}
          onNote={deps.note}
        />
      ) : null}
      {termSheet !== null && data.terminal ? (
        <TerminalSheet
          data={data.terminal}
          agentName={name}
          asleep={wsView?.state === "asleep"}
          sessions={wsView?.sessions ?? []}
          start={termSheet}
          me={data.me?.id}
          nameOf={data.nameOf}
          onClose={() => setTermSheet(null)}
        />
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  fill: { flex: 1, minHeight: 0 },
  waitBox: { marginHorizontal: 24, marginTop: 10, marginBottom: 2, gap: 8 },
  waitText: { fontSize: 13, lineHeight: 18, color: "var(--ink)" as string },
  note: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-3)" as string },
  state: { fontSize: 12, color: "var(--ink-3)" as string },
  dotLead: { width: 18, marginRight: 4, alignItems: "center", justifyContent: "center" },
  sk2: { height: 60, marginHorizontal: 24, borderRadius: 10, backgroundColor: "var(--sunk)" as string },
  lock: { marginHorizontal: 24, marginTop: 8, gap: 6, alignItems: "flex-start" },
  lockTitle: { fontSize: 13, fontWeight: "500", color: "var(--ink)" as string },
  fault: { marginHorizontal: 24, marginTop: 4, gap: 8, alignItems: "flex-start" },
  faultTitle: { fontSize: 13, fontWeight: "500", color: "var(--ink)" as string },
  pic: { marginHorizontal: 24, gap: 8 },
  box: {
    width: "100%" as unknown as number,
    maxWidth: 520,
    aspectRatio: 1.6,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#f5f6f8" as string,
    borderWidth: 1,
    borderColor: "var(--line-2)" as string,
  },
  press: {
    position: "absolute",
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "transparent",
  } as object,
  pressOver: { borderColor: "var(--accent)" as string },
  skeleton: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, padding: 18, gap: 10 },
  sk: { height: 8, borderRadius: 4, backgroundColor: "#e3e5ea" as string },
  liveOver: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 },
  playWrap: {
    position: "absolute",
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  play: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "var(--raised)" as string,
  },
  cap: { fontSize: 12, color: "var(--ink-3)" as string },
});
