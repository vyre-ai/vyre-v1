// Inbox > the softphone dock, bound to the Inbox (spec 2.18, ARCH 7.3, 3.3). The shared ui/Softphone does the drawing and the call state machine; this wires it to the Space: numbers from
// telephony.number.list, the telephony capabilities as its hooks, a caller's record from the calls the replica holds, and Cmd-Shift-K. A call that ends is saved to the conversation of the person
// it was with (the server writes the call into the thread; the dock says where it went and the thread shows it), and Log a task runs telephony.call.log_task. The Voice device is the shell's: it
// passes `device` (the real Twilio Voice SDK Device, or a fake in tests), because the SDK is never imported here.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { IDLE_STATE, Softphone, createPhoneController, stateToProps, useSoftphoneShortcut } from "../../../../../../ui/src/Softphone/index.tsx";
import type { PhoneController, PhoneDeviceLike, PhoneState, TransferTarget } from "../../../../../../ui/src/Softphone/index.tsx";
import { useInboxData, useScreenQuery } from "../sidebar/data.tsx";
import type { ContactRow } from "../sidebar/model.ts";
import { SCREENS } from "../sidebar/model.ts";
import { callerOf, numbersOf, phoneHooks, savedLine, suggestionsFor } from "./model.ts";
import type { CallOut, CallsOut, NumbersOut } from "./model.ts";

export const SOFTPHONE_SCREEN = "telephony.softphone";

type RowsOut = { rows: ContactRow[] };

/** What the rest of the Inbox can ask of the dock. */
export interface InboxPhone {
  dial(number: string, contactId?: string): void;
  toggle(): void;
  state(): PhoneState;
}

const Ctx = createContext<InboxPhone | null>(null);
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
  const [state, setState] = useState<PhoneState>(IDLE_STATE);

  const controller = useMemo<PhoneController>(() => createPhoneController(device, phoneHooks(
    (cap, input) => data.call(cap, input),
    { numberId: () => live.current.from, callId: () => call.current.id, setCallId: (id) => { call.current.id = id; }, contactId: () => call.current.contactId },
    { targets, onHungUp: (c: CallOut) => setSaved(savedLine(live.current.rows.find((r) => r.contactId === c.contactId)?.displayName)) },
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
    if (state.phase === "idle") { call.current = {}; setSaved(undefined); }
  }, [state.phase, state.ended, data, saved]);

  useSoftphoneShortcut(useCallback(() => controller.dispatch({ type: "toggle_dialer" }), [controller]));

  const api = useMemo<InboxPhone>(() => ({
    dial(number, contactId) { call.current = contactId ? { contactId } : {}; void controller.dial(number); },
    toggle() { controller.dispatch({ type: "toggle_dialer" }); },
    state: () => controller.state(),
  }), [controller]);

  const base = stateToProps(state);
  const caller = state.peer ? callerOf(state.peer, calls, rows) : undefined;
  return (
    <Ctx.Provider value={api}>
      {children}
      <Softphone
        {...base}
        {...(caller ? { caller } : {})}
        placement={placement}
        numbers={numbers}
        {...(from ? { fromId: from } : {})}
        transferTargets={targets}
        suggestions={suggestionsFor(typed, calls, rows)}
        secs={state.secs}
        connecting={state.phase === "calling"}
        {...(state.phase === "ended" && saved !== undefined ? { endedNote: saved } : {})}
        {...(state.ended ? { endedSecs: state.ended.secs } : {})}
        onOpen={() => controller.dispatch({ type: "open_dialer" })}
        onClose={() => controller.dispatch({ type: "close_dialer" })}
        onFrom={setFromId}
        onType={setTyped}
        onDial={(n) => api.dial(n, callerOf(n, calls, rows).recordId)}
        onAnswer={() => controller.answer()}
        onDecline={() => controller.decline()}
        onHangup={() => controller.hangup()}
        onMute={() => controller.mute()}
        onHold={() => { void controller.hold(); }}
        onRecord={() => { void controller.record(); }}
        onTransfer={(name) => { void controller.transfer(name); }}
        onDigit={(k) => controller.sendDigit(k)}
        onDismiss={() => controller.dispatch({ type: "dismiss" })}
        onLogTask={(title) => { if (call.current.id) void data.call("telephony.call.log_task", { callId: call.current.id, title }); }}
        {...(caller?.recordId ? { onOpenRecord: () => data.nav.openConversation(rows.find((r) => r.contactId === caller.recordId)?.id ?? "") } : {})}
      />
    </Ctx.Provider>
  );
}
