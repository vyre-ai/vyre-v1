// The agent's desk (lane r42-computer, approved by the owner 19 Nov): ONE surface for an agent's computer. In the pane (the dock) it is the Computer tab's picture; pressing it grows this surface to about 95%
// of the window with the app dimmed behind it, and it can shrink to a small live picture that stays over the chat. It is the same element in both shapes: only its edges move (a CSS transition), so the live
// view never reloads. Esc, a press outside and the shrink button go back to where it was opened from. The shapes and the keys are desk-model.ts; the open desk is desk-store.ts; this file draws it.
//
// While you only watch: F full view, T take over, Esc one step down. While you hold the controls every key belongs to the page (the buttons are the way out), and closing hands the browser back, so a
// closed desk never leaves the agent waiting.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Overlay } from "../../../../../../ui/src/Overlay/index.tsx";
import { BlobImage } from "../../../../../../ui/src/BlobImage/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { useEscapeLayer } from "../../../../../../ui/src/Overlay/escape.ts";
import { Icon } from "./parts.tsx";
import type { IconName } from "./parts.tsx";
import { PreviewImage } from "./PreviewImage.tsx";
import { TerminalSheet } from "./TerminalSheet.tsx";
import { FilesTab } from "./FilesTab.tsx";
import { AGENT_PAGE_SCREEN } from "./ThreadsTab.tsx";
import { RightPaneDataProvider, useScreenQuery } from "./data.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { barOf } from "./BrowserSheet.tsx";
import { browserHead } from "./work-model.ts";
import type { DeskStep, WorkspaceView } from "./work-model.ts";
import type { PaneDeps } from "./actions.ts";
import type { BrowserView } from "./work-model.ts";
import { Dot } from "./WorkParts.tsx";
import { keyAction, keysMayAct, needsShift } from "./desk-model.ts";
import type { ActiveKind } from "./desk-model.ts";
import { drawnAt, showsCursor } from "./desk-pointer.ts";
import type { Drawn, PointerView } from "./desk-pointer.ts";
import type { DeskKey, DeskMode, DeskRoom } from "./desk-model.ts";
import { deskDispatch, useDesk } from "./desk-store.ts";
import type { DeskSession } from "./desk-store.ts";

const MARGIN = 0.025;
export const MINI = { width: 272, height: 196, right: 20, bottom: 104 } as const;
const EDGES =
  "top 320ms cubic-bezier(.2,.8,.2,1), left 320ms cubic-bezier(.2,.8,.2,1), right 320ms cubic-bezier(.2,.8,.2,1), bottom 320ms cubic-bezier(.2,.8,.2,1), border-radius 320ms";

/** The surface's four edges in pixels for a window: full is a 2.5% margin all round, mini a small card over the chat's bottom right. Pure, so it is tested. */
export function edgesOf(
  mode: DeskMode,
  win: { width: number; height: number },
): { top: number; left: number; right: number; bottom: number; radius: number } {
  if (mode === "mini")
    return {
      top: Math.max(0, win.height - MINI.bottom - MINI.height),
      left: Math.max(0, win.width - MINI.right - MINI.width),
      right: MINI.right,
      bottom: MINI.bottom,
      radius: 16,
    };
  const mx = Math.round(win.width * MARGIN),
    my = Math.round(win.height * MARGIN);
  return { top: my, left: mx, right: mx, bottom: my, radius: win.width < 700 ? 0 : 18 };
}

const UNKNOWN_VIEW: BrowserView = { state: "starting", canTakeOver: false, sites: [] };

/** The browser's view of the agent, watched for as long as the desk is open. `known` is false until the first answer: nothing is woken or decided from a view that has not been read yet. */
function useView(session: DeskSession): { view: BrowserView; known: boolean } {
  const [got, setGot] = useState<BrowserView | null>(null);
  useEffect(() => session.data.watch(session.agentId, setGot), [session.data, session.agentId]);
  return { view: got ?? UNKNOWN_VIEW, known: got !== null };
}

/** Ask now and then while `on`: the last answer stays until a newer one comes; a failed ask keeps it. */
function usePolled<T>(ask: () => Promise<T> | undefined, every: number, on: boolean, first: T): T {
  const [v, setV] = useState<T>(first);
  const askRef = useRef(ask);
  askRef.current = ask;
  useEffect(() => {
    if (!on) return undefined;
    let live = true;
    const go = (): void => {
      void Promise.resolve(askRef.current())
        .then((x) => {
          if (live && x !== undefined) setV(x);
        })
        .catch(() => undefined);
    };
    go();
    const t = setInterval(go, every);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [every, on]);
  return v;
}

const CONTROL_TAGS = new Set(["BUTTON", "A", "SUMMARY"]);
const FIELD_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton", "slider"]);
const CONTROL_ROLES = new Set([
  "button",
  "menuitem",
  "option",
  "tab",
  "link",
  "checkbox",
  "switch",
  "radio",
  "treeitem",
]);
/** Where the focus is, for the keys: a field, a control outside the desk (Space there is its own), a control of the desk, or nowhere in particular. */
export function activeKindOf(el: unknown): ActiveKind {
  const e = el as
    | {
        tagName?: string;
        isContentEditable?: boolean;
        getAttribute?: (n: string) => string | null;
        closest?: (s: string) => unknown;
      }
    | null
    | undefined;
  const tag = e?.tagName?.toUpperCase();
  if (!e || !tag || tag === "BODY" || tag === "HTML") return "none";
  const role = (e.getAttribute?.("role") ?? "").toLowerCase();
  if (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    e.isContentEditable === true ||
    FIELD_ROLES.has(role)
  )
    return "field";
  // a widget made of parts: the focused part sits inside the element that has the role
  if (e.closest?.('[role="textbox"],[role="searchbox"],[role="combobox"],[role="spinbutton"],[role="slider"]'))
    return "field";
  const control = CONTROL_TAGS.has(tag) || CONTROL_ROLES.has(role);
  if (!control) return "none";
  return e.closest?.('[data-testid="desk"]') ? "desk_control" : "outside_control";
}
// a menu or a list counts as open only inside the overlay layer, where menus and popovers are drawn: the Chats list in the sidebar is always a listbox and is no popup
export const OTHER_MODAL =
  '[aria-modal="true"]:not([data-testid="desk"]):not([data-testid="desk-mini"]):not([aria-hidden="true"]), #vyre-overlay-root [role="menu"]:not([aria-hidden="true"]):not([hidden]), #vyre-overlay-root [role="listbox"]:not([aria-hidden="true"]):not([hidden])';
const otherModalOpen = (doc: { querySelector?: (s: string) => unknown }): boolean =>
  doc.querySelector?.(OTHER_MODAL) != null;

const typingIn = (t: unknown): boolean => {
  const el = t as { tagName?: string; isContentEditable?: boolean } | null;
  const tag = el?.tagName?.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable === true;
};

/** Whether this window has a network (the browser's own word), so the bar can say so instead of "Watching" over a picture that stopped. */
function useWindowOnline(): boolean {
  const g = globalThis as {
    navigator?: { onLine?: boolean };
    addEventListener?: (n: string, f: () => void) => void;
    removeEventListener?: (n: string, f: () => void) => void;
  };
  return useSyncExternalStore(
    (f) => {
      g.addEventListener?.("online", f);
      g.addEventListener?.("offline", f);
      return () => {
        g.removeEventListener?.("online", f);
        g.removeEventListener?.("offline", f);
      };
    },
    () => g.navigator?.onLine !== false,
    () => true,
  );
}

export function DeskHost(): ReactElement | null {
  const { state, session } = useDesk();
  if (!session || (state.mode !== "full" && state.mode !== "mini")) return null;
  return (
    <Overlay>
      <Desk session={session} mode={state.mode} room={state.room} />
    </Overlay>
  );
}

export function Desk({
  session,
  mode,
  room = "browser",
}: {
  session: DeskSession;
  mode: "full" | "mini";
  room?: DeskRoom;
}): ReactElement {
  const win = useWindowDimensions();
  const { view, known } = useView(session);
  const { agentId, name, data } = session;
  const mine = view.state === "takeover" && view.mine === true;
  const [busy, setBusy] = useState(false);
  const full = mode === "full";
  // a sleeping browser wakes when the desk opens: the call that hands out the live address is the one that starts it
  const woke = useRef(false);
  useEffect(() => {
    if (!known || view.state !== "closed" || woke.current) return;
    woke.current = true;
    data
      .open(agentId)
      .catch((e: unknown) => session.note(e instanceof Error && e.message ? e.message : "The browser did not start."));
  }, [known, view.state, agentId, data, session]);
  const starting = view.state === "closed" || view.state === "starting";
  const t0 = useRef(Date.now());
  const [, tick] = useState(0);
  useEffect(() => {
    if (!starting) return undefined;
    const i = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(i);
  }, [starting]);
  const run = useCallback(
    (f: () => Promise<void>): void => {
      setBusy(true);
      void f()
        .catch((e: unknown) =>
          session.note(e instanceof Error && e.message ? e.message : "That did not work. Try again."),
        )
        .finally(() => setBusy(false));
    },
    [session],
  );
  // Stop is the thread's own turn stop for this agent; if the browser was paused, the step that waits is told the agent was stopped, so it never runs after the stop
  const canStop = session.threadId !== undefined;
  const stop = useCallback((): void => {
    if (session.threadId === undefined) return;
    const thread = session.threadId;
    run(async () => {
      await session.call("engine.stop", { threadId: thread, agentId });
      if (data.resume) await data.resume(agentId, { stopped: true }).catch(() => undefined);
    });
  }, [session, agentId, data, run]);
  const togglePause = useCallback(
    (paused: boolean): void => {
      const f = paused ? data.resume : data.pause;
      if (f) run(() => f.call(data, agentId));
    },
    [data, agentId, run],
  );
  // a send, post or payment of the agent waits for approval: Allow or Not now is the Approve task's own answer (tasks.act); whoever may not answer it is offered nothing and the server would refuse
  const answer = useCallback(
    (verdict: "approve" | "reject"): void => {
      const h = view.held;
      if (!h || !h.taskId) return;
      run(async () => {
        // the Approve task is answered at its source (tasks.act); tasks.decide is for work tasks and refuses it. A refusal needs its reason: "Not now".
        await session.call("tasks.act", {
          taskId: h.taskId,
          action: verdict,
          ...(verdict === "reject" ? { note: "Not now" } : {}),
        });
      });
    },
    [view.held, session, run],
  );
  const close = useCallback((): void => {
    if (mine) void data.giveBack(agentId).catch(() => undefined);
    deskDispatch({ type: "close" });
  }, [mine, data, agentId]);
  // Esc goes one step down while you only watch; while you hold the browser it belongs to the page
  // pressing a done step shows the picture kept after it, until Back to live (or Esc, which leaves the picture first and the full view next)
  const [seen, setSeen] = useState<DeskStep | null>(null);
  const [seenUrl, setSeenUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (seen?.frameFileId === undefined || !data.frame) {
      setSeenUrl(undefined);
      return undefined;
    }
    let live = true;
    setSeenUrl(undefined);
    void data
      .frame(seen.frameFileId)
      .then((u) => live && setSeenUrl(u))
      .catch(() => live && setSeenUrl(null));
    return () => {
      live = false;
    };
  }, [seen, data]);
  // taking over, closing the browser or leaving the full view ends the look back: the live page is what you steer
  useEffect(() => {
    if (mine || !full || view.state !== "open") setSeen(null);
  }, [mine, full, view.state]);
  useEscapeLayer(full && !mine, () => (seen !== null ? setSeen(null) : deskDispatch({ type: "escape" })));
  const canTake = view.state === "open" && view.canTakeOver && !busy;
  const canPause = view.state === "open" && view.canTakeOver && !busy && data.pause !== undefined;
  const isPaused = view.paused === true;
  // the keys: only while you watch, never while a field has the keyboard
  const stateRef = useRef({ mine, canTake, canPause, canStop, isPaused, mode, busy });
  stateRef.current = { mine, canTake, canPause, canStop, isPaused, mode, busy };
  useEffect(() => {
    if (Platform.OS !== "web") return undefined;
    const doc = (globalThis as { document?: Document }).document;
    if (!doc) return undefined;
    const on = (ev: KeyboardEvent): void => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const k: DeskKey | null =
        ev.key === " "
          ? "space"
          : ev.key.length === 1 && "fts".includes(ev.key.toLowerCase())
            ? (ev.key.toLowerCase() as DeskKey)
            : null;
      if (!k) return;
      // Stop is Shift S, never a bare letter
      if (needsShift(k) && !ev.shiftKey) return;
      // Space on a focused button is that button's own press (the browser clicks it on key up): the desk does not also act on it
      if (
        k === "space" &&
        activeKindOf((doc as unknown as { activeElement?: unknown }).activeElement) === "desk_control"
      )
        return;
      const active = (doc as unknown as { activeElement?: unknown }).activeElement;
      if (
        !keysMayAct({
          active: activeKindOf(active),
          modalOpen: otherModalOpen(doc as never),
          repeat: ev.repeat === true,
          composing: ev.isComposing === true,
          prevented: ev.defaultPrevented === true,
        })
      )
        return;
      const cur = stateRef.current;
      const act = keyAction({ mode: cur.mode, prev: cur.mode === "full" ? "dock" : null, room: "browser" }, k, {
        typing: typingIn(ev.target),
        holding: cur.mine,
      });
      // a call in flight (a take-over under way, a pause being sent) is not stacked on: only the view keys work meanwhile
      if (cur.busy && act !== "toggle_full") return;
      if (act === "toggle_full") {
        ev.preventDefault();
        deskDispatch({ type: "toggle_full" });
      } else if (act === "take" && cur.canTake && room === "browser") {
        ev.preventDefault();
        run(() => data.takeOver(agentId));
      } else if (act === "pause" && cur.canPause && room === "browser") {
        ev.preventDefault();
        togglePause(cur.isPaused);
      } else if (act === "stop" && cur.canStop && room === "browser") {
        ev.preventDefault();
        stop();
      }
    };
    doc.addEventListener("keydown", on);
    return () => doc.removeEventListener("keydown", on);
  }, [data, agentId, run, togglePause, stop, room]);

  // the agent's cursor, the highlight on its field, and its steps: only while the full view shows a live page
  const watching = full && room === "browser" && view.state === "open";
  const ptr = usePolled<PointerView | null>(
    () => data.pointer?.(agentId),
    400,
    watching && data.pointer !== undefined,
    null,
  );
  const steps = usePolled<DeskStep[]>(() => data.steps?.(agentId), 2500, watching && data.steps !== undefined, []);
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (!watching) return undefined;
    const t = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(t);
  }, [watching]);
  const drawn = watching && seen === null && showsCursor(ptr, clock) && ptr ? drawnAt(ptr, stage) : null;

  // the full view takes the keyboard: the control that opened it (the picture in the pane) would otherwise keep the focus under the scrim, and F, T and Esc would find a button outside the desk focused and leave the press to it
  useEffect(() => {
    if (!full || Platform.OS !== "web") return;
    const doc = (
      globalThis as { document?: { activeElement?: { blur?: () => void; closest?: (s: string) => unknown } | null } }
    ).document;
    const a = doc?.activeElement;
    if (a && typeof a.blur === "function" && !a.closest?.('[data-testid="desk"]')) a.blur();
  }, [full]);

  const e = edgesOf(mode, win);
  const head = browserHead(view);
  const bar = barOf(view, name, mine, Date.now() - t0.current);
  const online = useWindowOnline();
  const live = view.state === "open" || (view.state === "takeover" && mine);
  return (
    <>
      <Pressable
        testID="desk-scrim"
        accessibilityLabel="Back"
        aria-hidden={!full}
        onPress={() => deskDispatch({ type: "scrim" })}
        style={[st.scrim, { opacity: full ? 1 : 0, pointerEvents: full ? "auto" : "none" } as never]}
      />
      <View
        testID={full ? "desk" : "desk-mini"}
        role="dialog"
        aria-modal={full}
        accessibilityLabel={`${name}'s computer`}
        style={[
          st.surface,
          {
            top: e.top,
            left: e.left,
            right: e.right,
            bottom: e.bottom,
            borderRadius: e.radius,
            transition: EDGES,
          } as never,
        ]}
      >
        {full ? (
          <>
            <View style={st.head}>
              <View style={st.face} accessibilityLabel={`${name}, ${head.word}`}>
                <Text style={st.faceText}>{name.slice(0, 1).toUpperCase()}</Text>
                <View style={st.faceDot}>
                  <Dot tone={head.dot} />
                </View>
              </View>
              <Text style={st.title} numberOfLines={1}>{`${name}'s computer`}</Text>
              {session.pane ? (
                <View accessibilityRole="tablist" style={st.rooms}>
                  <Room icon="globe" tip="Browser" id="browser" on={room} />
                  {session.pane.terminal ? <Room icon="terminal" tip="Terminal" id="term" on={room} /> : null}
                  <Room icon="folder" tip="Files" id="files" on={room} />
                </View>
              ) : null}
              <View style={{ flex: 1 }} />
              <Tip icon="shrink" tip="Back (Esc)" testID="desk-back" onPress={() => deskDispatch({ type: "back" })} />
              <Tip
                icon="pip"
                tip="Minimise to a picture"
                testID="desk-minimise"
                onPress={() => deskDispatch({ type: "minimise" })}
              />
              <Tip icon="x" tip="Close" testID="desk-close" onPress={close} />
            </View>
            {room === "term" && session.pane ? <TerminalRoom session={session} /> : null}
            {room === "files" && session.pane ? <FilesRoom session={session} /> : null}
            {room === "browser" || !session.pane ? (
              <>
                <View
                  testID="desk-live"
                  style={[st.stage, mine && st.stageMine]}
                  onLayout={(ev) =>
                    setStage({ width: ev.nativeEvent.layout.width, height: ev.nativeEvent.layout.height })
                  }
                >
                  {live ? (
                    data.renderLive?.(agentId, { state: view.state, control: mine })
                  ) : (
                    <View style={st.skeleton}>
                      <View style={[st.sk, { width: "46%" }]} />
                      <View style={[st.sk, { width: "70%" }]} />
                      <View style={[st.sk, { width: "58%" }]} />
                    </View>
                  )}
                  {drawn ? <AgentCursor drawn={drawn} name={name} /> : null}
                  {seen !== null ? <Scrubbed step={seen} url={seenUrl} onLive={() => setSeen(null)} /> : null}
                  {watching && steps.length > 0 ? (
                    <StepRing
                      steps={steps}
                      picked={seen?.idx}
                      onPick={(x) => setSeen((cur) => (cur?.idx === x.idx ? null : x))}
                    />
                  ) : null}
                </View>
                <View
                  testID="desk-bar"
                  style={[
                    st.bar,
                    bar.tone === "wait" && st.barWait,
                    bar.tone === "bad" && st.barBad,
                    mine && st.barMine,
                  ]}
                >
                  {view.held ? (
                    <>
                      <Icon name="shield" size={16} color="var(--warn)" />
                      <Text style={st.barBold} numberOfLines={1}>
                        {view.held.mayAnswer ? "Send asks you first" : "A send is waiting for approval"}
                      </Text>
                      {view.held.mayAnswer ? (
                        <Text style={st.barNote} numberOfLines={1}>
                          {view.held.count > 1 ? `${view.held.what} and ${view.held.count - 1} more` : view.held.what}
                        </Text>
                      ) : view.held.count > 1 ? (
                        <Text style={st.barNote} numberOfLines={1}>{`${view.held.count} waiting`}</Text>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <Text style={st.barBold} numberOfLines={1}>
                        {online ? bar.title : "Offline"}
                      </Text>
                      {!online ? (
                        <Text style={st.barNote} numberOfLines={1}>
                          The picture comes back when the connection does.
                        </Text>
                      ) : bar.note ? (
                        <Text style={st.barNote} numberOfLines={1}>
                          {bar.note}
                        </Text>
                      ) : null}
                    </>
                  )}
                  <View style={{ flex: 1 }} />
                  {view.held?.mayAnswer ? (
                    <>
                      <Pill
                        label="Not now"
                        quiet
                        disabled={busy}
                        onPress={() => answer("reject")}
                        testID="browser-deny"
                      />
                      <Pill label="Allow" disabled={busy} onPress={() => answer("approve")} testID="browser-allow" />
                    </>
                  ) : null}
                  {live && view.state === "open" && view.canTakeOver && data.pause ? (
                    isPaused ? null : (
                      <Tip
                        icon="pause"
                        tip="Pause (Space)"
                        testID="browser-pause"
                        disabled={busy}
                        onPress={() => togglePause(false)}
                      />
                    )
                  ) : null}
                  {live && view.state === "open" && canStop ? (
                    <Tip icon="stop" tip="Stop (Shift S)" testID="browser-stop" disabled={busy} onPress={stop} />
                  ) : null}
                  {bar.action === "resume" ? (
                    <Pill
                      label="Resume"
                      hint="Space"
                      disabled={busy}
                      onPress={() => togglePause(true)}
                      testID="browser-resume"
                    />
                  ) : null}
                  {bar.action === "take" || bar.action === "resume" ? (
                    <Pill
                      label="Take over"
                      hint="T"
                      disabled={busy}
                      onPress={() => run(() => data.takeOver(agentId))}
                      testID="browser-take"
                      quiet={bar.action === "resume"}
                    />
                  ) : null}
                  {bar.action === "give" ? (
                    <Pill
                      label="Give back"
                      disabled={busy}
                      onPress={() => run(() => data.giveBack(agentId))}
                      testID="browser-give"
                    />
                  ) : null}
                  {bar.action === "restart" ? (
                    <Pill
                      label="Restart"
                      disabled={busy}
                      onPress={() => run(() => data.open(agentId))}
                      testID="browser-restart"
                    />
                  ) : null}
                </View>
              </>
            ) : null}
          </>
        ) : (
          <Pressable
            testID="desk-mini-open"
            accessibilityLabel={`Open ${name}'s computer`}
            onPress={() => deskDispatch({ type: "full" })}
            style={st.mini}
          >
            <View style={st.miniPic}>
              <PreviewImage call={session.call} agentId={agentId} active={live} />
            </View>
            <View style={st.miniFoot}>
              <Dot tone={head.dot} />
              <Text style={st.miniText} numberOfLines={1}>
                {view.caption ?? head.word}
              </Text>
              <Icon name="expand" size={13} color="var(--ink-3)" />
            </View>
          </Pressable>
        )}
        {!full ? (
          <Pressable testID="desk-mini-close" accessibilityLabel="Dismiss" onPress={close} style={st.miniX}>
            <Icon name="x" size={11} color="#fff" />
          </Pressable>
        ) : null}
      </View>
    </>
  );
}

/** The agent's cursor with its name, gliding to where it acts, and a soft ring on the field it works in. It never takes a press: the page under it is the page. */
export function AgentCursor({ drawn, name }: { drawn: Drawn; name: string }): ReactElement {
  return (
    <View testID="agent-cursor" pointerEvents="none" style={st.cursorLayer}>
      {drawn.ring ? (
        <View
          testID="agent-ring"
          style={[
            st.ring,
            { left: drawn.ring.left, top: drawn.ring.top, width: drawn.ring.width, height: drawn.ring.height } as never,
          ]}
        />
      ) : null}
      <View style={[st.cursor, { left: drawn.x, top: drawn.y } as never]}>
        <Icon name="point" size={20} color="#fff" fill="var(--accent)" width={1.2} />
        <View style={st.cursorTag}>
          <Text style={st.cursorName} numberOfLines={1}>
            {name}
          </Text>
        </View>
      </View>
    </View>
  );
}

/** The steps, small: a ring with how many the agent has taken, opening on hover or a press into the list of what it did, newest last. */
export function StepRing({
  steps,
  picked,
  onPick,
}: {
  steps: readonly DeskStep[];
  picked?: number | undefined;
  onPick?: (s: DeskStep) => void;
}): ReactElement {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hover || pinned;
  const shown = steps.slice(-8);
  return (
    <View
      testID="step-ring"
      style={st.ringBox}
      {...({ onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false) } as object)}
    >
      {open ? (
        <View testID="step-list" style={st.stepList}>
          {shown.map((x, i) => (
            <Row
              key={x.idx}
              id={`step-${x.idx}`}
              title={x.caption || x.tool}
              selected={picked === x.idx || (picked === undefined && i === shown.length - 1)}
              inert={!x.frameFileId || !onPick}
              hint="See the screen after this step"
              leading={<View style={[st.stepDot, i === shown.length - 1 && st.stepDotNow]} />}
              onPress={() => onPick?.(x)}
            />
          ))}
        </View>
      ) : null}
      <Pressable
        testID="step-ring-button"
        accessibilityRole="button"
        accessibilityLabel={`${steps.length} steps`}
        accessibilityState={{ expanded: open }}
        onPress={() => setPinned((v) => !v)}
        style={st.stepButton}
        {...({ title: "Steps" } as object)}
      >
        <View style={st.stepCount}>
          <Text style={st.stepCountText}>{String(Math.min(steps.length, 99))}</Text>
        </View>
        <Icon name="check" size={13} color="#fff" />
      </Pressable>
    </View>
  );
}

/** The screen as it was after a step, over the live page, with the way back. While it is up the cursor is hidden: it points at the live page, not at this picture. */
export function Scrubbed({
  step,
  url,
  onLive,
}: {
  step: DeskStep;
  url: string | null | undefined;
  onLive: () => void;
}): ReactElement {
  return (
    <View testID="scrubbed" style={st.scrub}>
      {url ? (
        <BlobImage
          uri={url}
          accessibilityLabel={`The screen after: ${step.caption}`}
          testID="scrubbed-image"
          resizeMode="contain"
          style={st.scrubImg}
        />
      ) : (
        <View style={st.scrubEmpty}>
          <Text style={st.scrubEmptyText}>{url === null ? "That screen was not kept." : "Opening the screen"}</Text>
        </View>
      )}
      <View style={st.scrubPill}>
        <Icon name="watch" size={14} color="#fff" />
        <Text style={st.scrubText} numberOfLines={1}>
          {step.caption || step.tool}
        </Text>
        <Pressable
          testID="scrub-live"
          accessibilityRole="button"
          accessibilityLabel="Back to live"
          onPress={onLive}
          style={st.scrubLive}
        >
          <Text style={st.scrubLiveText}>Back to live</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** One room of the desk, as an icon in the strip: it switches without leaving the desk or reloading the others. */
function Room({ icon, tip, id, on }: { icon: IconName; tip: string; id: DeskRoom; on: DeskRoom }): ReactElement {
  const sel = on === id;
  return (
    <Pressable
      testID={`desk-room-${id}`}
      accessibilityRole="tab"
      accessibilityLabel={tip}
      accessibilityState={{ selected: sel }}
      onPress={() => deskDispatch({ type: "room", room: id })}
      style={[st.room, sel && st.roomOn]}
      {...({ title: tip } as object)}
    >
      <Icon name={icon} size={16} color={sel ? "var(--accent)" : "var(--ink-3)"} />
    </Pressable>
  );
}

/** The agent's terminals in the desk: the same sheet the Computer tab opens, drawn inside the desk (its own bar and sessions, no window of its own). */
function TerminalRoom({ session }: { session: DeskSession }): ReactElement | null {
  const pane = session.pane;
  const [ws, setWs] = useState<WorkspaceView | null>(null);
  useEffect(
    () => (pane?.workspace ? pane.workspace.watch(session.agentId, setWs) : undefined),
    [pane, session.agentId],
  );
  if (!pane?.terminal) return null;
  const sessions = ws?.sessions ?? [];
  return (
    <TerminalSheet
      embedded
      data={pane.terminal}
      agentName={session.name}
      asleep={ws?.state === "asleep"}
      watchOnly={ws === null || ws.takeOver === false}
      sessions={sessions}
      start={sessions.find((x) => x.terminalId !== undefined)?.terminalId ?? "main"}
      me={pane.me?.id}
      nameOf={pane.nameOf}
      onDrawn={() => pane.workspace?.refresh?.(session.agentId)}
      onClose={() => deskDispatch({ type: "room", room: "browser" })}
    />
  );
}

/** The agent's own folder in the desk: the Computer tab's Files tab, with the same rows and menus. */
function FilesRoom({ session }: { session: DeskSession }): ReactElement | null {
  const pane = session.pane;
  if (!pane) return null;
  return (
    <RightPaneDataProvider value={pane}>
      <FilesInner agentId={session.agentId} deps={session.deps ?? { call: session.call, note: session.note }} />
    </RightPaneDataProvider>
  );
}
function FilesInner({ agentId, deps }: { agentId: string; deps: PaneDeps }): ReactElement {
  const q = useScreenQuery<CapMap["agents.get"]["out"]>(AGENT_PAGE_SCREEN, "agent", { agentId });
  const folderId = q.status === "ready" ? (q.data.agent?.folderId ?? "") : "";
  return (
    <View testID="files-room" style={st.fillRoom}>
      {q.status === "ready" ? (
        folderId === "" ? (
          <Text style={st.roomNote}>{`This agent has no folder yet.`}</Text>
        ) : (
          <FilesTab deps={deps} folderId={folderId} />
        )
      ) : (
        <Text style={st.roomNote}>Opening the folder</Text>
      )}
    </View>
  );
}

function Tip({
  icon,
  tip,
  onPress,
  testID,
  disabled,
}: {
  icon: IconName;
  tip: string;
  onPress: () => void;
  testID: string;
  disabled?: boolean;
}): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tip}
      testID={testID}
      disabled={disabled === true}
      accessibilityState={{ disabled: disabled === true }}
      onPress={onPress}
      onHoverIn={() => setOver(true)}
      onHoverOut={() => setOver(false)}
      style={[st.tip, over && st.tipOver]}
      {...({ title: tip } as object)}
    >
      <Icon name={icon} size={15} color="var(--ink-2)" />
    </Pressable>
  );
}

function Pill({
  label,
  hint,
  onPress,
  disabled,
  testID,
  quiet,
}: {
  label: string;
  hint?: string;
  onPress: () => void;
  disabled?: boolean;
  testID: string;
  quiet?: boolean;
}): ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hint ? `${label} (${hint})` : label}
      accessibilityState={{ disabled: disabled === true }}
      disabled={disabled === true}
      testID={testID}
      onPress={onPress}
      style={[st.pill, quiet === true && st.pillQuiet, disabled === true && { opacity: 0.5 }]}
      {...({ title: hint ? `${label} (${hint})` : label } as object)}
    >
      <Text style={[st.pillText, quiet === true && st.pillTextQuiet]}>{label}</Text>
      {hint ? <Text style={[st.pillKey, quiet === true && st.pillKeyQuiet]}>{hint}</Text> : null}
    </Pressable>
  );
}

const st = StyleSheet.create({
  scrim: {
    position: "fixed" as never,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 99997,
    backgroundColor: "rgba(10,9,16,0.55)",
    transitionProperty: "opacity",
    transitionDuration: "300ms",
  } as never,
  surface: {
    position: "fixed" as never,
    zIndex: 99998,
    overflow: "hidden",
    backgroundColor: "var(--win)" as string,
    borderWidth: 1,
    borderColor: "var(--line-2)" as string,
    boxShadow: "0 30px 90px -30px rgba(0,0,0,.7)",
  } as never,
  head: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    backgroundColor: "var(--side)" as string,
    borderBottomWidth: 1,
    borderBottomColor: "var(--line)" as string,
  },
  face: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "var(--accent)" as string,
    alignItems: "center",
    justifyContent: "center",
  },
  faceText: { color: "var(--accent-ink)" as string, fontSize: 12.5, fontWeight: "600" },
  faceDot: { position: "absolute", right: -3, bottom: -3 },
  title: { fontSize: 13.5, fontWeight: "600", color: "var(--ink)" as string, flexShrink: 1, marginLeft: 4 },
  tip: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  tipOver: { backgroundColor: "var(--hover)" as string },
  stage: { flex: 1, minHeight: 0, backgroundColor: "var(--sunk)" as string },
  stageMine: { borderWidth: 2, borderColor: "var(--accent)" as string },
  skeleton: { flex: 1, padding: 24, gap: 12 },
  sk: { height: 10, borderRadius: 5, backgroundColor: "#e3e5ea" as string },
  bar: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    backgroundColor: "var(--side)" as string,
    borderTopWidth: 1,
    borderTopColor: "var(--line)" as string,
  },
  barWait: { backgroundColor: "var(--warn-soft, var(--side))" as string },
  barBad: { backgroundColor: "var(--danger-soft, var(--side))" as string },
  barMine: { backgroundColor: "var(--accent-soft, var(--side))" as string },
  barBold: { fontSize: 13, fontWeight: "500", color: "var(--ink)" as string },
  barNote: { fontSize: 12.5, color: "var(--ink-3)" as string, flexShrink: 1 },
  pill: {
    height: 36,
    paddingHorizontal: 16,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "var(--accent)" as string,
  },
  pillQuiet: { backgroundColor: "var(--sel)" as string },
  pillTextQuiet: { color: "var(--ink)" as string },
  pillKeyQuiet: { color: "var(--ink-3)" as string, borderColor: "var(--ink-4)" as string },
  pillText: { fontSize: 13, fontWeight: "600", color: "var(--accent-ink)" as string },
  pillKey: {
    fontSize: 10.5,
    color: "var(--accent-ink)" as string,
    opacity: 0.6,
    borderWidth: 1,
    borderColor: "var(--accent-ink)" as string,
    borderRadius: 5,
    paddingHorizontal: 4,
  },
  cursorLayer: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, overflow: "hidden" },
  ring: {
    position: "absolute",
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "var(--accent)" as string,
    boxShadow: "0 0 0 6px var(--accent-wash), 0 0 22px 4px var(--accent-wash)",
    transitionProperty: "left, top, width, height",
    transitionDuration: "420ms",
  } as never,
  cursor: {
    position: "absolute",
    transitionProperty: "left, top",
    transitionDuration: "650ms",
    transitionTimingFunction: "cubic-bezier(.3,.75,.2,1)",
    filter: "drop-shadow(0 3px 6px rgba(20,16,50,.35))",
  } as never,
  cursorTag: {
    position: "absolute",
    left: 14,
    top: 16,
    backgroundColor: "var(--accent)" as string,
    borderRadius: 9,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  cursorName: { color: "var(--accent-ink)" as string, fontSize: 11.5, fontWeight: "600" },
  ringBox: { position: "absolute", left: 14, bottom: 14, alignItems: "flex-start", gap: 6 },
  stepButton: {
    height: 40,
    paddingLeft: 5,
    paddingRight: 14,
    borderRadius: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(24,22,36,.86)",
  },
  stepCount: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "var(--accent)" as string,
  },
  stepCountText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  stepList: {
    width: 288,
    padding: 6,
    borderRadius: 16,
    backgroundColor: "var(--win)" as string,
    borderWidth: 1,
    borderColor: "var(--line-2)" as string,
    gap: 1,
  },
  scrub: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "var(--sunk)" as string },
  scrubImg: { flex: 1 },
  scrubEmpty: { flex: 1, alignItems: "center", justifyContent: "center" },
  scrubEmptyText: { color: "var(--ink-3)" as string, fontSize: 13 },
  scrubPill: {
    position: "absolute",
    top: 14,
    alignSelf: "center",
    maxWidth: "80%",
    height: 36,
    paddingLeft: 14,
    paddingRight: 5,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(24,22,36,.88)",
  },
  scrubText: { color: "#fff", fontSize: 12.5, flexShrink: 1 },
  scrubLive: {
    height: 26,
    paddingHorizontal: 12,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "var(--accent)" as string,
  },
  scrubLiveText: { color: "var(--accent-ink)" as string, fontSize: 12, fontWeight: "600" },
  stepDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "var(--ink-3)" as string },
  stepDotNow: { backgroundColor: "var(--accent)" as string },
  rooms: {
    flexDirection: "row",
    padding: 3,
    borderRadius: 11,
    backgroundColor: "var(--sunk)" as string,
    gap: 1,
    marginLeft: 6,
  },
  room: { width: 34, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  roomOn: { backgroundColor: "var(--win)" as string },
  fillRoom: { flex: 1, minHeight: 0 },
  roomNote: { padding: 24, color: "var(--ink-3)" as string, fontSize: 13 },
  mini: { flex: 1 },
  miniPic: { flex: 1, minHeight: 0, backgroundColor: "#f5f6f8" as string, overflow: "hidden" },
  miniFoot: {
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    backgroundColor: "var(--side)" as string,
  },
  miniText: { flex: 1, fontSize: 12.5, fontWeight: "500", color: "var(--ink)" as string },
  miniX: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(20,18,30,.55)",
    alignItems: "center",
    justifyContent: "center",
  },
});
