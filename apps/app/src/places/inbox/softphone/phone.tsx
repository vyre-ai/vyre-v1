// Inbox > the softphone dock, bound to the Inbox (spec 2.18, ARCH 7.3, 3.3). The shared ui/Softphone does the drawing and the call state machine; this wires it to the Space: numbers from
// telephony.number.list, the telephony capabilities as its hooks, a caller's record from the calls the replica holds, and Cmd-Shift-K. A call that ends is saved to the conversation of the person
// it was with (the server writes the call into the thread; the dock says where it went and the thread shows it), and Log a task runs telephony.call.log_task. The Voice device is the shell's: it
// passes `device` (the real Twilio Voice SDK Device, or a fake in tests), because the SDK is never imported here.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { IDLE_STATE, Softphone, createPhoneController, stateToProps, useSoftphoneShortcut } from "../../../../../../ui/src/Softphone/index.tsx";
import type { PhoneController, PhoneDeviceLike, PhoneState, SoftphoneViewProps, TransferTarget } from "../../../../../../ui/src/Softphone/index.tsx";
import { useInboxData, useScreenQuery } from "../sidebar/data.tsx";
import type { ContactRow } from "../sidebar/model.ts";
import { SCREENS } from "../sidebar/model.ts";
import { callerOf, numbersOf, phoneHooks, savedLine, sameNumber, suggestionsFor } from "./model.ts";
import type { CallOut, CallsOut, NumbersOut } from "./model.ts";

export const SOFTPHONE_SCREEN = "telephony.softphone";

type RowsOut = { rows: ContactRow[] };

/** What the rest of the Inbox can ask of the dock. */
export interface InboxPhone {
  dial(number: string, contactId?: string): void;
  toggle(): void;
  state(): PhoneState;
  /** The Softphone's view props for the call now (caller, clock, handlers): what the call bar in a conversation header draws. */
  view(): SoftphoneViewProps;
  /** A conversation that is open says so; while it is the caller's, the floating dock keeps out of the way and the conversation shows the call. Returns the release. */
  claim(c: ConversationKey): () => void;
  /** True when the open conversation is the one this call is with. */
  isClaimed(): boolean;
  /** Seconds, notes: the Call pane's own text for this call. */
  notes(): string;
  setNotes(text: string): void;
}

/** What identifies the conversation a call can belong to. */
export interface ConversationKey { id: string; contactId?: string | undefined; address: string; /** other phones the person is known by (from their thread) */ numbers?: readonly string[] | undefined }

/** The dock's context. Exported so a screen test can stand a call in without a Voice device. */
export const InboxPhoneContext = createContext<InboxPhone | null>(null);
const Ctx = InboxPhoneContext;

/** Does the floating dock draw? Not while the conversation the call is with is open and shows the call itself. */
export const dockFloats = (claimed: boolean, phase: string): boolean => !(claimed && (phase === "live" || phase === "held" || phase === "ended"));
/** The dock's controls, or null when no dock is mounted (the Call button then asks the shell to open the dialer). */
export const usePhone = (): InboxPhone | null => useContext(Ctx);

export interface PhoneTarget extends TransferTarget { id: string; kind2: "person" | "agent" }

export interface InboxPhoneProps {
  device: PhoneDeviceLike;
  /** Teammates and agents a call may be handed to. */
  targets?: readonly PhoneTarget[];
  children?: ReactNode;
  placement?: "dock" | "inline";
}

/** The provider and the dock in one: children may call `usePhone()`. */
const NO_TARGETS: readonly PhoneTarget[] = [];

export function InboxPhoneDock({ device, targets = NO_TARGETS, children, placement = "dock" }: InboxPhoneProps): ReactElement {
  const data = useInboxData();
  const numbersQ = useScreenQuery<NumbersOut>(SOFTPHONE_SCREEN, "numbers");
  const callsQ = useScreenQuery<CallsOut>(SOFTPHONE_SCREEN, "calls");
  const rowsQ = useScreenQuery<RowsOut>(SCREENS.list, "rows");
  const numbers = useMemo(() => numbersOf(numbersQ.status === "ready" ? numbersQ.data : null), [numbersQ]);
  const calls = callsQ.status === "ready" ? callsQ.data : null;
  const rows = rowsQ.status === "ready" ? rowsQ.data.rows : [];
  const [fromId, setFromId] = useState<string | undefined>(undefined);
  const from = fromId ?? numbers[0]?.id ?? "";
  const live = useRef({ from, rows, calls, numbersCount: numbers.length });
  live.current = { from, rows, calls, numbersCount: numbers.length };
  const call = useRef<{ id?: string; contactId?: string }>({});
  const [typed, setTyped] = useState("");
  const [saved, setSaved] = useState<string | undefined>(undefined);
  const [summary, setSummary] = useState<string | undefined>(undefined);
  const [state, setState] = useState<PhoneState>(IDLE_STATE);
  const [claims, setClaims] = useState<readonly ConversationKey[]>([]);
  const [notes, setNotes] = useState("");
  const opened = useRef<string>("");

  const controller = useMemo<PhoneController>(() => createPhoneController(device, phoneHooks(
    (cap, input) => data.call(cap, input),
    { numberId: () => live.current.from, callId: () => call.current.id, setCallId: (id) => { call.current.id = id; }, contactId: () => call.current.contactId },
    { targets, onHungUp: (c: CallOut) => { setSaved(savedLine(live.current.rows.find((r) => r.contactId === c.contactId)?.displayName)); setSummary(c.summary); } },
  )), [device, data, targets]);

  useEffect(() => { setState(controller.state()); return controller.subscribe(setState); }, [controller]);
  useEffect(() => () => controller.destroy(), [controller]);
  // the clock of a live call
  useEffect(() => {
    if (state.phase !== "live" && state.phase !== "held") return undefined;
    const t = setInterval(() => controller.tick(), 1000);
    return () => clearInterval(t);
  }, [controller, state.phase]);
  // a call the other side ended: it was saved all the same
  useEffect(() => {
    if (state.phase === "ended" && state.ended?.reason === "remote" && call.current.id && saved === undefined) {
      void data.call("telephony.hangup", { callId: call.current.id }).then((out) => setSaved(savedLine(live.current.rows.find((r) => r.contactId === (out as { call: CallOut }).call.contactId)?.displayName)));
    }
    if (state.phase === "idle") { call.current = {}; setSaved(undefined); setSummary(undefined); }
  }, [state.phase, state.ended, data, saved]);

  useSoftphoneShortcut(useCallback(() => controller.dispatch({ type: "toggle_dialer" }), [controller]));

  const base = stateToProps(state);
  const caller = state.peer ? callerOf(state.peer, calls, rows) : undefined;
  const rowOf = (n: string, recordId?: string): ContactRow | undefined => rows.find((r) => (recordId !== undefined && r.contactId === recordId) || sameNumber(r.address, n));
  const claimed = claims.some((c) => state.peer !== "" && ((caller?.recordId !== undefined && c.contactId === caller.recordId) || sameNumber(c.address, state.peer) || (c.numbers ?? []).some((n) => sameNumber(n, state.peer))));

  const view: SoftphoneViewProps = {
    ...base,
    ...(caller ? { caller } : {}),
    placement,
    numbers,
    ...(from ? { fromId: from } : {}),
    transferTargets: targets,
    suggestions: suggestionsFor(typed, calls, rows),
    secs: state.secs,
    connecting: state.phase === "calling",
    ...(state.phase === "ended" && saved !== undefined ? { endedNote: saved } : {}),
    ...(state.phase === "ended" && summary !== undefined ? { summary } : {}),
    ...(state.ended ? { endedSecs: state.ended.secs } : {}),
    notes,
    onOpen: () => controller.dispatch({ type: "open_dialer" }),
    onClose: () => controller.dispatch({ type: "close_dialer" }),
    onFrom: setFromId,
    onType: setTyped,
    onDial: (n) => { call.current = (callerOf(n, calls, rows).recordId ? { contactId: callerOf(n, calls, rows).recordId as string } : {}); void controller.dial(n); },
    onAnswer: () => controller.answer(),
    onDecline: () => controller.decline(),
    onHangup: () => controller.hangup(),
    onMute: () => controller.mute(),
    onHold: () => { void controller.hold(); },
    onRecord: () => { void controller.record(); },
    onTransfer: (name) => { void controller.transfer(name); },
    onDigit: (k) => controller.sendDigit(k),
    onDismiss: () => controller.dispatch({ type: "dismiss" }),
    onLogTask: (title) => { if (call.current.id) void data.call("telephony.call.log_task", { callId: call.current.id, title }); },
    ...(caller?.recordId ? { onOpenRecord: () => data.nav.openConversation(rowOf(state.peer, caller.recordId)?.id ?? "") } : {}),
  };

  // a call that connects opens the caller's conversation (once per call), so the call bar sits in its header
  useEffect(() => {
    if (state.phase !== "live" || opened.current === `${state.peer}` ) return;
    opened.current = state.peer;
    const r = rowOf(state.peer, caller?.recordId);
    if (r && !claimed) data.nav.openConversation(r.id);
  }, [state.phase, state.peer]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (state.phase === "idle") { opened.current = ""; setNotes(""); } }, [state.phase]);

  const latest = useRef({ view, claimed, notes });
  latest.current = { view, claimed, notes };
  const api = useMemo<InboxPhone>(() => ({
    dial(number, contactId) { call.current = contactId ? { contactId } : {}; void controller.dial(number); },
    toggle() { controller.dispatch({ type: "toggle_dialer" }); },
    state: () => controller.state(),
    view: () => latest.current.view,
    claim(c) { setClaims((cs) => [...cs, c]); return () => setClaims((cs) => cs.filter((x) => x !== c)); },
    isClaimed: () => latest.current.claimed,
    notes: () => latest.current.notes,
    setNotes,
  // a new object whenever the call, the claims or the notes change, so a conversation that reads the call re-renders with it
  }), [controller, state, claimed, claims, notes, saved, summary]);
  // while the conversation is open the call lives in its header; the floating dock is for the dialer, an incoming ring and a call whose conversation is not open
  const floating = dockFloats(claimed, state.phase);
  return (
    <Ctx.Provider value={api}>
      {children}
      {floating ? <Softphone {...view} /> : null}
    </Ctx.Provider>
  );
}
