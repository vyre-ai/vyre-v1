// ui/Softphone: one dock for every place (spec 2.18, ARCH 7.3). Cmd-Shift-K opens the dialer anywhere.
// Calls run through the Twilio Voice JS SDK. This file never imports the SDK: createPhoneController takes anything shaped like a
// Voice SDK Device (connect, on("incoming"), destroy) and a Call (accept, reject, disconnect, mute, sendDigits, on), so the host
// passes the real Device and the tests pass a fake one. Hold, transfer and record are server actions (telephony.hold, .transfer, .record),
// so the host supplies them as hooks and the controller keeps the state in step.
// Recording waits on consent: a record request without logged consent shows "Waiting for consent" and records nothing.
// Colours are skin tokens (CSS variables on web), so a skin switch repaints with no re-render.

import { createElement, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { ViewStyle } from "react-native";
import { Avatar } from "../Avatar/index.tsx";
import { useMenu } from "../Menu/index.tsx";
import type { MenuEntry } from "../Menu/index.tsx";
import { SOFTPHONE_MODES, softphoneLabel } from "./props.ts";
import type { SoftphoneCaller, SoftphoneMode, SoftphoneNumber, SoftphoneProps, TransferTarget } from "./props.ts";

export type { Density, SoftphoneCaller, SoftphoneMode, SoftphoneNumber, SoftphoneProps, TransferTarget } from "./props.ts";
export { SOFTPHONE_MODES, softphoneLabel } from "./props.ts";

/* ---------- contract mapping ---------- */

export const DIAL_CAPABILITY = "telephony.dial" as const;
export const ANSWER_CAPABILITY = "telephony.answer" as const;
export const DECLINE_CAPABILITY = "telephony.decline" as const;
export const HANGUP_CAPABILITY = "telephony.hangup" as const;
export const HOLD_CAPABILITY = "telephony.hold" as const;
export const TRANSFER_CAPABILITY = "telephony.transfer" as const;
export const RECORD_CAPABILITY = "telephony.record" as const;
export const LOG_TASK_CAPABILITY = "telephony.call.log_task" as const;

/** Input of telephony.record. Consent is logged with the start; a stop carries none. */
export interface RecordInput {
  callId: string;
  action: "start" | "stop";
  consent?: { announced: boolean; confirmedBy?: string };
}

export function recordInput(callId: string, start: boolean, announced: boolean, confirmedBy?: string): RecordInput {
  if (!start) return { callId, action: "stop" };
  return { callId, action: "start", consent: { announced, ...(confirmedBy === undefined ? {} : { confirmedBy }) } };
}

/** Input of telephony.transfer: a teammate or an agent, warm by default. */
export function transferInput(callId: string, target: { kind: "person" | "agent"; id: string }, mode: "warm" | "cold" = "warm"): { callId: string; to: { kind: "person" | "agent"; id: string }; mode: "warm" | "cold" } {
  return { callId, to: { kind: target.kind, id: target.id }, mode };
}

/* ---------- dial helpers ---------- */

export const DIAL_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"] as const;
export const DIAL_LETTERS: Readonly<Record<string, string>> = { "2": "ABC", "3": "DEF", "4": "GHI", "5": "JKL", "6": "MNO", "7": "PQRS", "8": "TUV", "9": "WXYZ", "0": "+" };

/** A number the dialer may call: starts with a plus, a bracket or a digit, only digits, spaces, dashes and brackets after, three digits at least. */
export function isDialable(value: string): boolean {
  const v = value.trim();
  return /^[+\d(][\d\s\-()]*$/.test(v) && v.replace(/\D/g, "").length >= 3;
}

/** The E.164 form of what was typed: digits only, a leading plus kept. A bare ten-digit number is a US number. */
export function toE164(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (value.trim().startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

/** Test id suffix for a dial key. */
export function keyId(k: string): string {
  return k === "*" ? "star" : k === "#" ? "hash" : k;
}

export function formatClock(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Cmd-Shift-K (Ctrl-Shift-K off the Mac) opens or closes the dialer. */
export function isSoftphoneShortcut(e: { key: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean }): boolean {
  return e.key.toLowerCase() === "k" && e.shiftKey === true && (e.metaKey === true || e.ctrlKey === true) && e.altKey !== true;
}

export type RecordingState = "off" | "waiting" | "on";

/** Recording only runs once the announcement is played and the consent is logged. */
export function recordingState(p: Pick<SoftphoneProps, "recording" | "consent">): RecordingState {
  if (p.recording !== true) return "off";
  return p.consent === true ? "on" : "waiting";
}

/** The line under the caller's name in the live bar. */
export function liveStatus(p: Pick<SoftphoneProps, "mode" | "held" | "recording" | "consent">, secs: number, connecting = false): string {
  if (connecting) return "Calling";
  const parts = [formatClock(secs)];
  if (p.mode === "held" || p.held === true) parts.push("On hold");
  const rec = recordingState(p);
  if (rec === "on") parts.push("Recording");
  if (rec === "waiting") parts.push("Waiting for consent");
  return parts.join(" · ");
}

/** The transfer menu: teammates, then agents. */
export function transferMenu(targets: readonly TransferTarget[], onTransfer: (name: string) => void): MenuEntry[] {
  const out: MenuEntry[] = [];
  const groups: readonly { head: string; kind: TransferTarget["kind"] }[] = [{ head: "Teammates", kind: "teammate" }, { head: "Agents", kind: "agent" }];
  for (const g of groups) {
    const list = targets.filter((t) => t.kind === g.kind);
    if (list.length === 0) continue;
    if (out.length > 0) out.push({ separator: true });
    out.push({ head: g.head });
    for (const t of list) out.push({ label: t.name, onSelect: () => onTransfer(t.name) });
  }
  if (out.length === 0) out.push({ head: "Nobody to transfer to" });
  return out;
}

/* ---------- the call state machine ---------- */

export type CallPhase = "idle" | "calling" | "incoming" | "live" | "held" | "ended";
export type EndReason = "hangup" | "remote" | "declined" | "missed" | "error" | "transferred";

export interface PhoneState {
  phase: CallPhase;
  dialerOpen: boolean;
  direction: "in" | "out" | null;
  peer: string;
  muted: boolean;
  held: boolean;
  recording: boolean;
  consent: boolean;
  digits: string;
  secs: number;
  transferredTo: string | null;
  ended: { secs: number; reason: EndReason } | null;
  error: string | null;
}

export type PhoneEvent =
  | { type: "open_dialer" }
  | { type: "close_dialer" }
  | { type: "toggle_dialer" }
  | { type: "dial"; to: string }
  | { type: "incoming"; from: string }
  | { type: "connected" }
  | { type: "answer" }
  | { type: "decline" }
  | { type: "cancelled" }
  | { type: "hangup" }
  | { type: "disconnected" }
  | { type: "mute"; on?: boolean }
  | { type: "hold"; on?: boolean }
  | { type: "record"; on?: boolean; consent?: boolean }
  | { type: "digit"; key: string }
  | { type: "tick" }
  | { type: "transferred"; to: string }
  | { type: "dismiss" }
  | { type: "error"; message: string };

export const IDLE_STATE: PhoneState = {
  phase: "idle", dialerOpen: false, direction: null, peer: "", muted: false, held: false, recording: false, consent: false, digits: "", secs: 0, transferredTo: null, ended: null, error: null,
};

const inCall = (s: PhoneState): boolean => s.phase === "live" || s.phase === "held";
const busy = (s: PhoneState): boolean => s.phase === "calling" || s.phase === "incoming" || inCall(s);

function endedState(s: PhoneState, reason: EndReason, error: string | null = null): PhoneState {
  return { ...IDLE_STATE, phase: "ended", direction: s.direction, peer: s.peer, secs: s.secs, transferredTo: s.transferredTo, ended: { secs: s.secs, reason }, error };
}

/** Pure transitions. An event that does not fit the phase returns the same state object. */
export function phoneReduce(s: PhoneState, e: PhoneEvent): PhoneState {
  switch (e.type) {
    case "open_dialer": return busy(s) || s.dialerOpen ? s : { ...s, dialerOpen: true };
    case "close_dialer": return s.dialerOpen ? { ...s, dialerOpen: false } : s;
    case "toggle_dialer": return busy(s) ? s : { ...s, dialerOpen: !s.dialerOpen };
    case "dial":
      if (busy(s)) return s;
      return { ...IDLE_STATE, phase: "calling", direction: "out", peer: e.to };
    case "incoming":
      if (busy(s)) return s;
      return { ...IDLE_STATE, phase: "incoming", direction: "in", peer: e.from };
    case "connected":
      return s.phase === "calling" || s.phase === "incoming" ? { ...s, phase: "live", dialerOpen: false } : s;
    case "answer":
      return s.phase === "incoming" ? { ...s, phase: "live" } : s;
    case "decline":
      return s.phase === "incoming" ? { ...IDLE_STATE, phase: "idle" } : s;
    case "cancelled":
      return s.phase === "incoming" || s.phase === "calling" ? endedState(s, s.phase === "incoming" ? "missed" : "declined") : s;
    case "hangup":
      if (s.phase === "calling") return { ...IDLE_STATE };
      return inCall(s) ? endedState(s, "hangup") : s;
    case "disconnected":
      return inCall(s) || s.phase === "calling" ? endedState(s, "remote") : s;
    case "mute":
      return inCall(s) ? { ...s, muted: e.on ?? !s.muted } : s;
    case "hold": {
      if (!inCall(s)) return s;
      const held = e.on ?? !s.held;
      return { ...s, held, phase: held ? "held" : "live" };
    }
    case "record": {
      if (!inCall(s)) return s;
      const on = e.on ?? !s.recording;
      if (!on) return { ...s, recording: false };
      return { ...s, recording: true, consent: e.consent ?? s.consent };
    }
    case "digit":
      return inCall(s) && /^[0-9*#]$/.test(e.key) ? { ...s, digits: s.digits + e.key } : s;
    case "tick":
      return inCall(s) ? { ...s, secs: s.secs + 1 } : s;
    case "transferred":
      return inCall(s) ? endedState({ ...s, transferredTo: e.to }, "transferred") : s;
    case "dismiss":
      return s.phase === "ended" ? { ...IDLE_STATE } : s;
    case "error":
      return busy(s) ? endedState(s, "error", e.message) : { ...s, error: e.message };
    default:
      return s;
  }
}

/** The frozen SoftphoneMode a state shows as. A call that is still ringing is shown as live with the connecting line. */
export function phoneMode(s: PhoneState): SoftphoneMode {
  switch (s.phase) {
    case "calling": case "live": return "live";
    case "held": return "held";
    case "incoming": return "incoming";
    case "ended": return "ended";
    default: return s.dialerOpen ? "dialer" : "idle";
  }
}

/* ---------- the Twilio Voice JS shape ---------- */

export type PhoneCallEvent = "accept" | "disconnect" | "cancel" | "reject" | "error";

/** The part of a Voice SDK Call the softphone uses. */
export interface PhoneCallLike {
  parameters: { From?: string; To?: string; CallSid?: string };
  accept(): void;
  reject(): void;
  disconnect(): void;
  mute(shouldMute: boolean): void;
  sendDigits(digits: string): void;
  on(event: PhoneCallEvent, handler: (arg?: unknown) => void): void;
}

/** The part of a Voice SDK Device the softphone uses. */
export interface PhoneDeviceLike {
  connect(options: { params: Record<string, string> }): Promise<PhoneCallLike>;
  on(event: "incoming", handler: (call: PhoneCallLike) => void): void;
  destroy(): void;
}

/** Server actions around the media path. Each runs the matching telephony capability. */
export interface PhoneHooks {
  /** telephony.dial: returns the SDK parameters for the call. */
  dial?: (to: string) => Promise<Record<string, string>>;
  hold?: (held: boolean) => Promise<void> | void;
  transfer?: (name: string) => Promise<void> | void;
  record?: (start: boolean) => Promise<{ consentLogged: boolean }> | { consentLogged: boolean };
  hangup?: () => void;
}

export interface PhoneController {
  state(): PhoneState;
  subscribe(listener: (s: PhoneState) => void): () => void;
  dispatch(e: PhoneEvent): void;
  dial(to: string): Promise<void>;
  answer(): void;
  decline(): void;
  hangup(): void;
  mute(): void;
  hold(): Promise<void>;
  record(): Promise<void>;
  transfer(name: string): Promise<void>;
  sendDigit(key: string): void;
  tick(): void;
  destroy(): void;
}

/** Binds a Voice SDK Device to the state machine. The returned controller is what the Softphone view props are read from. */
export function createPhoneController(device: PhoneDeviceLike, hooks: PhoneHooks = {}): PhoneController {
  let state: PhoneState = IDLE_STATE;
  let call: PhoneCallLike | null = null;
  const listeners = new Set<(s: PhoneState) => void>();

  const dispatch = (e: PhoneEvent): void => {
    const next = phoneReduce(state, e);
    if (next === state) return;
    state = next;
    for (const l of [...listeners]) l(state);
  };

  const watch = (c: PhoneCallLike): void => {
    c.on("accept", () => { if (call === c) dispatch({ type: "connected" }); });
    c.on("disconnect", () => { if (call !== c) return; call = null; dispatch({ type: "disconnected" }); });
    c.on("cancel", () => { if (call !== c) return; call = null; dispatch({ type: "cancelled" }); });
    c.on("reject", () => { if (call !== c) return; call = null; dispatch({ type: "cancelled" }); });
    c.on("error", (err) => { if (call !== c) return; call = null; dispatch({ type: "error", message: err instanceof Error ? err.message : "The call failed" }); });
  };

  device.on("incoming", (c) => {
    if (busy(state)) { c.reject(); return; }
    call = c;
    watch(c);
    dispatch({ type: "incoming", from: c.parameters.From ?? "Unknown caller" });
  });

  return {
    state: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispatch,
    async dial(to) {
      if (busy(state)) return;
      dispatch({ type: "dial", to });
      try {
        const params = hooks.dial ? await hooks.dial(to) : { To: to };
        const c = await device.connect({ params });
        if (state.phase !== "calling") { c.disconnect(); return; }
        call = c;
        watch(c);
      } catch (err) {
        dispatch({ type: "error", message: err instanceof Error ? err.message : "The call failed" });
      }
    },
    answer() {
      if (state.phase !== "incoming" || call === null) return;
      call.accept();
      dispatch({ type: "answer" });
    },
    decline() {
      if (state.phase !== "incoming" || call === null) return;
      const c = call;
      call = null;
      c.reject();
      dispatch({ type: "decline" });
    },
    hangup() {
      if (call !== null) { const c = call; call = null; c.disconnect(); }
      hooks.hangup?.();
      dispatch({ type: "hangup" });
    },
    mute() {
      if (call === null || !(state.phase === "live" || state.phase === "held")) return;
      const next = !state.muted;
      call.mute(next);
      dispatch({ type: "mute", on: next });
    },
    async hold() {
      if (!(state.phase === "live" || state.phase === "held")) return;
      const next = !state.held;
      await hooks.hold?.(next);
      dispatch({ type: "hold", on: next });
    },
    async record() {
      if (!(state.phase === "live" || state.phase === "held")) return;
      if (state.recording) { await hooks.record?.(false); dispatch({ type: "record", on: false }); return; }
      const res = hooks.record ? await hooks.record(true) : { consentLogged: false };
      dispatch({ type: "record", on: true, consent: res.consentLogged });
    },
    async transfer(name) {
      if (!(state.phase === "live" || state.phase === "held")) return;
      await hooks.transfer?.(name);
      if (call !== null) { const c = call; call = null; c.disconnect(); }
      dispatch({ type: "transferred", to: name });
    },
    sendDigit(key) {
      if (call === null || !(state.phase === "live" || state.phase === "held") || !/^[0-9*#]$/.test(key)) return;
      call.sendDigits(key);
      dispatch({ type: "digit", key });
    },
    tick() { dispatch({ type: "tick" }); },
    destroy() { listeners.clear(); call = null; device.destroy(); },
  };
}

/** Props the view reads from a controller's state. */
export function stateToProps(s: PhoneState): Pick<SoftphoneProps, "open" | "mode" | "muted" | "held" | "recording" | "consent" | "caller"> {
  const base = { open: s.dialerOpen || s.phase !== "idle", mode: phoneMode(s), muted: s.muted, held: s.held, recording: s.recording, consent: s.consent };
  return s.peer === "" ? base : { ...base, caller: { number: s.peer } };
}

/* ---------- web-only glue ---------- */

const webProps = (props: Record<string, unknown>): Record<string, unknown> => (Platform.OS === "web" ? props : {});

/** Cmd-Shift-K anywhere on web. The handler toggles the dialer. */
export function useSoftphoneShortcut(handler: () => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (Platform.OS !== "web") return undefined;
    const doc = (globalThis as { document?: { addEventListener(t: string, h: (e: KeyboardEvent) => void): void; removeEventListener(t: string, h: (e: KeyboardEvent) => void): void } }).document;
    if (doc === undefined) return undefined;
    const on = (e: KeyboardEvent): void => {
      if (!isSoftphoneShortcut(e)) return;
      e.preventDefault();
      ref.current();
    };
    doc.addEventListener("keydown", on);
    return () => doc.removeEventListener("keydown", on);
  }, []);
}

/** Seconds since the call went live, ticking while active. */
export function useElapsed(active: boolean): number {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!active) { setSecs(0); return undefined; }
    const id = setInterval(() => setSecs((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
  return secs;
}

/* ---------- icons ---------- */

const svg = (inner: string, size = 16): string => `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const IC = {
  phone: '<path d="M3.2 2.8h2.3l1 2.8-1.3.9a8 8 0 003.4 3.4l.9-1.3 2.8 1v2.3c0 .6-.5 1.1-1.1 1.1A9.8 9.8 0 012.1 3.9c0-.6.5-1.1 1.1-1.1z"/>',
  hang: '<path d="M2 8.6c3.5-2.8 8.5-2.8 12 0l-.4 1.8-2.6-.5-.3-1.6c-1.2-.3-2.8-.3-4 0l-.3 1.6-2.6.5z" fill="currentColor"/>',
  mic: '<rect x="6" y="2" width="4" height="7" rx="2"/><path d="M3.8 7.5a4.2 4.2 0 008.4 0M8 11.7V14"/>',
  micoff: '<rect x="6" y="2" width="4" height="7" rx="2"/><path d="M3.8 7.5a4.2 4.2 0 008.4 0M8 11.7V14M2.5 2.5l11 11"/>',
  pause: '<path d="M5.5 3.5v9M10.5 3.5v9"/>',
  pad: '<circle cx="4" cy="3.5" r=".7" fill="currentColor"/><circle cx="8" cy="3.5" r=".7" fill="currentColor"/><circle cx="12" cy="3.5" r=".7" fill="currentColor"/><circle cx="4" cy="7.5" r=".7" fill="currentColor"/><circle cx="8" cy="7.5" r=".7" fill="currentColor"/><circle cx="12" cy="7.5" r=".7" fill="currentColor"/><circle cx="4" cy="11.5" r=".7" fill="currentColor"/><circle cx="8" cy="11.5" r=".7" fill="currentColor"/><circle cx="12" cy="11.5" r=".7" fill="currentColor"/>',
  xfer: '<path d="M9.5 3.5l3 3-3 3M12.5 6.5h-6a3 3 0 00-3 3v3"/>',
  rec: '<circle cx="8" cy="8" r="5.2"/><circle cx="8" cy="8" r="2" fill="currentColor"/>',
  x: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>',
  back: '<path d="M6 4h7.5v8H6L2.5 8z"/><path d="M8.5 6.5l3 3M11.5 6.5l-3 3"/>',
  chev: '<path d="M4 6l4 4 4-4"/>',
  task: '<rect x="2.5" y="2.5" width="11" height="11" rx="2.5"/><path d="M5.5 8.2l1.8 1.8 3.2-3.5"/>',
  check: '<path d="M3 8.5l3 3 7-7"/>',
  link: '<path d="M6.8 9.2a2.6 2.6 0 003.7 0l2-2a2.6 2.6 0 00-3.7-3.7l-.6.6M9.2 6.8a2.6 2.6 0 00-3.7 0l-2 2a2.6 2.6 0 003.7 3.7l.6-.6"/>',
  user: '<circle cx="8" cy="5.5" r="2.5"/><path d="M3 13.5a5 5 0 0110 0"/>',
  circle: '<circle cx="8" cy="8" r="4.5"/>',
} as const;

const NATIVE_GLYPH: Readonly<Record<keyof typeof IC, string>> = {
  phone: "☎", hang: "✆", mic: "●", micoff: "○", pause: "‖", pad: "∷", xfer: "→", rec: "◉", x: "×", back: "⌫", chev: "▾", task: "✓", check: "✓", link: "↗", user: "☺", circle: "○",
};

function Glyph({ name, size = 16, color }: { name: keyof typeof IC; size?: number; color?: string }): ReactElement {
  if (Platform.OS !== "web") return <Text style={{ color: color ?? "var(--ink-2)", fontSize: size, lineHeight: size + 2 }}>{NATIVE_GLYPH[name]}</Text>;
  return createElement("span", { style: { display: "inline-flex", color: color ?? "inherit", width: size, height: size }, dangerouslySetInnerHTML: { __html: svg(IC[name], size) } });
}

/* ---------- small parts ---------- */

type Hover = { hovered?: boolean };

function Tile({ name, size = 26, unknown = false }: { name: string; size?: number; unknown?: boolean }): ReactElement {
  if (!unknown) return <Avatar name={name} kind="person" size={size} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: "var(--sel-strong)" as string, alignItems: "center", justifyContent: "center" }}>
      <Glyph name="user" size={Math.round(size * 0.5)} color="var(--ink-3)" />
    </View>
  );
}

function IconButton(p: { label: string; icon: keyof typeof IC; on?: boolean; tone?: "rec"; onPress: (x: number, y: number) => void; testID: string }): ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={p.label}
      accessibilityState={{ selected: p.on === true }}
      onPress={(e: { nativeEvent?: { pageX?: number; pageY?: number } }) => p.onPress(e.nativeEvent?.pageX ?? 0, e.nativeEvent?.pageY ?? 0)}
      testID={p.testID}
      {...webProps({ title: p.label })}
      style={({ hovered }: Hover) => [styles.ib, hovered === true && styles.ibHover, p.on === true && (p.tone === "rec" ? styles.ibRec : styles.ibOn)]}
    >
      <Glyph name={p.icon} size={16} color={p.on === true ? (p.tone === "rec" ? "var(--danger)" : "var(--accent)") : "var(--ink-2)"} />
    </Pressable>
  );
}

function PillButton(p: { label: string; tone?: "ok" | "quiet" | "danger"; onPress?: (() => void) | undefined; testID: string; flex?: boolean }): ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={p.label}
      onPress={p.onPress}
      testID={p.testID}
      style={({ hovered }: Hover) => [styles.btn, p.flex === true && styles.btnFlex, p.tone === "ok" ? styles.btnOk : p.tone === "danger" ? styles.btnDanger : styles.btnQuiet, hovered === true && styles.btnHover]}
    >
      <Text style={[styles.btnText, p.tone === "ok" && styles.btnTextOn]}>{p.label}</Text>
    </Pressable>
  );
}

/* ---------- the views ---------- */

export interface SoftphoneSuggestion {
  name: string;
  number: string;
  company?: string;
}

export interface SoftphoneViewProps extends SoftphoneProps {
  /** dock: fixed at the bottom right of the window. inline: in the flow, for sheets and screenshots. */
  placement?: "dock" | "inline";
  /** Seconds on the call. Without it the view keeps its own clock while a call is live. */
  secs?: number;
  /** A call that is still ringing out. */
  connecting?: boolean;
  /** Dial-pad suggestions for what is typed (up to three show). */
  suggestions?: readonly SoftphoneSuggestion[];
  /** The after-call line, for example "Saved to Elena's conversation". */
  endedNote?: string;
  /** Duration of the call that ended, in seconds. */
  endedSecs?: number;
  onOpen?: () => void;
  onClose?: () => void;
  onFrom?: (id: string) => void;
  onType?: (value: string) => void;
  onDigit?: (key: string) => void;
  onDismiss?: () => void;
  testID?: string;
}

const DOCK = (Platform.OS === "web" ? { position: "fixed", right: 16, bottom: 16, zIndex: 90 } : { position: "absolute", right: 8, bottom: 8 }) as unknown as ViewStyle;
// a ring is the first thing a person must answer: its sheet sits at the top right under the title bar, as in the prototype; every other state stays at the bottom right
const DOCK_RING = (Platform.OS === "web" ? { position: "fixed", right: 16, top: 46, zIndex: 90 } : { position: "absolute", right: 8, top: 8 }) as unknown as ViewStyle;
const POP_SHADOW = { boxShadow: "var(--sh-pop)" } as unknown as ViewStyle;

function IdlePill({ number, onOpen }: { number: string; onOpen?: (() => void) | undefined }): ReactElement {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Softphone, ${number}. Cmd Shift K`} onPress={onOpen} testID="softphone-pill" {...webProps({ title: "Softphone  ⌘⇧K" })} style={({ hovered }: Hover) => [styles.pill, POP_SHADOW, hovered === true && styles.pillHover]}>
      <View style={styles.dot} />
      <Text style={styles.pillText}>{number}</Text>
    </Pressable>
  );
}

function Dialer(p: SoftphoneViewProps): ReactElement {
  const [value, setValue] = useState("");
  const menu = useMenu();
  const numbers = p.numbers;
  const from: SoftphoneNumber | undefined = numbers.find((n) => n.id === p.fromId) ?? numbers[0];
  const dialable = isDialable(value);
  const compact = p.density === "compact";
  const change = (v: string): void => { setValue(v); p.onType?.(v); };
  const press = (k: string): void => change(value + k);
  const go = (to: string = value): void => { if (isDialable(to)) p.onDial?.(toE164(to)); };
  const pickFrom = (x: number, y: number): void => {
    const items: MenuEntry[] = [];
    for (const n of numbers) items.push({ label: `${n.label}  ${n.num}`, checked: n.id === from?.id, onSelect: () => p.onFrom?.(n.id) });
    menu.show(items, x, y, "context", { label: "Call from" });
  };
  const sugNodes: ReactElement[] = [];
  for (const s of (p.suggestions ?? []).slice(0, 3)) {
    sugNodes.push(
      <Pressable key={s.number} accessibilityRole="button" accessibilityLabel={`Call ${s.name}, ${s.number}`} onPress={() => go(s.number)} testID={`softphone-suggest-${s.number}`} style={({ hovered }: Hover) => [styles.sugRow, hovered === true && styles.ibHover]}>
        <Tile name={s.name} size={22} />
        <Text style={styles.sugName} numberOfLines={1}>{s.name}</Text>
        <Text style={styles.sugNum}>{s.number}</Text>
      </Pressable>,
    );
  }
  const keyNodes: ReactElement[] = [];
  for (const k of DIAL_KEYS) {
    keyNodes.push(
      <Pressable key={k} accessibilityRole="button" accessibilityLabel={k} onPress={() => press(k)} testID={`softphone-key-${keyId(k)}`} style={({ hovered, pressed }: Hover & { pressed?: boolean }) => [styles.key, hovered === true && styles.ibHover, pressed === true && styles.keyPress]}>
        <Text style={styles.keyText}>{k}</Text>
        <Text style={styles.keyLetters}>{DIAL_LETTERS[k] ?? ""}</Text>
      </Pressable>,
    );
  }
  return (
    <View
      accessibilityLabel="Dialer"
      testID="softphone-dialer"
      style={[styles.card, compact && styles.cardCompact, POP_SHADOW]}
      {...webProps({ role: "dialog", onKeyDown: (e: { key: string; stopPropagation?: () => void }) => { if (e.key === "Escape") { e.stopPropagation?.(); p.onClose?.(); } } })}
    >
      <View style={styles.dhead}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Call from ${from?.label ?? "a number"}`} onPress={(e: { nativeEvent?: { pageX?: number; pageY?: number } }) => pickFrom(e.nativeEvent?.pageX ?? 0, e.nativeEvent?.pageY ?? 0)} testID="softphone-from" disabled={numbers.length < 2} style={({ hovered }: Hover) => [styles.from, hovered === true && numbers.length > 1 && styles.fromHover]}>
          <Text style={styles.fromText} numberOfLines={1}>{from ? `${from.label} · ${from.num}` : "No number"}</Text>
          {numbers.length > 1 ? <Glyph name="chev" size={10} color="var(--ink-3)" /> : null}
        </Pressable>
        <View style={styles.grow} />
        <Pressable accessibilityRole="button" accessibilityLabel="Close dialer" onPress={p.onClose} testID="softphone-close" {...webProps({ title: "Close  Esc" })} style={({ hovered }: Hover) => [styles.x, hovered === true && styles.ibHover]}>
          <Glyph name="x" size={14} color="var(--ink-3)" />
        </Pressable>
      </View>
      <View style={styles.dinRow}>
        <TextInput
          value={value}
          onChangeText={change}
          placeholder="Name or number"
          placeholderTextColor="var(--ink-4)"
          accessibilityLabel="Number to call"
          testID="softphone-input"
          autoFocus
          onSubmitEditing={() => go()}
          style={styles.din}
          {...webProps({ inputMode: "tel", autoComplete: "off", spellCheck: false })}
        />
        {value.length > 0 ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Delete last digit" onPress={() => change(value.slice(0, -1))} testID="softphone-backspace" {...webProps({ title: "Delete" })} style={({ hovered }: Hover) => [styles.x, hovered === true && styles.ibHover]}>
            <Glyph name="back" size={16} color="var(--ink-3)" />
          </Pressable>
        ) : null}
      </View>
      {sugNodes.length > 0 ? <View style={styles.sug}>{sugNodes}</View> : null}
      <View style={styles.pad}>{keyNodes}</View>
      <View style={styles.go}>
        <Pressable accessibilityRole="button" accessibilityLabel="Call" accessibilityState={{ disabled: !dialable }} disabled={!dialable} onPress={() => go()} testID="softphone-call" {...webProps({ title: "Call  Enter" })} style={({ hovered }: Hover) => [styles.round, styles.roundOk, !dialable && styles.roundOff, hovered === true && dialable && styles.btnHover]}>
          <Glyph name="phone" size={22} color="#fff" />
        </Pressable>
      </View>
      {menu.element}
    </View>
  );
}

function Incoming(p: SoftphoneViewProps & { via: string }): ReactElement {
  const c = p.caller;
  const known = c?.name !== undefined && c.name.length > 0;
  return (
    <View
      accessibilityLabel="Incoming call"
      testID="softphone-incoming"
      style={[styles.sheet, POP_SHADOW]}
      {...webProps({ role: "alertdialog", onKeyDown: (e: { key: string; preventDefault?: () => void }) => { if (e.key === "Enter") { e.preventDefault?.(); p.onAnswer?.(); } else if (e.key === "Escape") { e.preventDefault?.(); p.onDecline?.(); } } })}
    >
      <View style={styles.inTop}>
        <Tile name={known ? (c?.name ?? "?") : "?"} size={38} unknown={!known} />
        <View style={styles.who}>
          <Text style={styles.inName} numberOfLines={1}>{known ? c?.name : "Unknown caller"}</Text>
          <Text style={styles.sub} numberOfLines={1}>{`${c?.company ? `${c.company} · ` : ""}${c?.number ?? ""}`}</Text>
          <Text style={styles.sub} numberOfLines={1}>{`Incoming to ${p.via}`}</Text>
        </View>
      </View>
      <View style={styles.inActs}>
        <PillButton label="Decline" tone="quiet" onPress={p.onDecline} testID="softphone-decline" flex />
        <PillButton label="Accept" tone="ok" onPress={p.onAnswer} testID="softphone-answer" flex />
      </View>
    </View>
  );
}

/** The bar for a live or held call: caller, clock, mute, hold, keypad, transfer, record, hang up. */
export function CallBar(p: SoftphoneViewProps): ReactElement {
  const menu = useMenu();
  const ticking = useElapsed(p.secs === undefined && p.connecting !== true && (p.mode === "live" || p.mode === "held"));
  const secs = p.secs ?? ticking;
  const [pad, setPad] = useState(false);
  const c = p.caller;
  const name = c?.name !== undefined && c.name.length > 0 ? c.name : (c?.number ?? "Call");
  const held = p.mode === "held" || p.held === true;
  const rec = recordingState(p);
  const targets = p.transferTargets ?? [];
  const padNodes: ReactElement[] = [];
  for (const k of DIAL_KEYS) {
    padNodes.push(
      <Pressable key={k} accessibilityRole="button" accessibilityLabel={k} onPress={() => p.onDigit?.(k)} testID={`softphone-digit-${keyId(k)}`} style={({ hovered }: Hover) => [styles.keySm, hovered === true && styles.ibHover]}>
        <Text style={styles.keyText}>{k}</Text>
      </Pressable>,
    );
  }
  return (
    <View accessibilityLabel={p.connecting === true ? "Calling" : "In call"} accessibilityRole="toolbar" testID="softphone-bar" style={[styles.bar, p.density === "compact" && styles.barCompact]}>
      <Tile name={name} size={26} unknown={c?.name === undefined} />
      <View style={styles.who}>
        <Text style={styles.barName} numberOfLines={1}>{name}</Text>
        <View style={styles.tmRow}>
          {p.connecting === true ? null : <View style={[styles.dot, held && styles.dotHold]} />}
          <Text style={styles.tm} testID="softphone-status">{liveStatus(p, secs, p.connecting === true) + (p.connecting === true ? ` ${c?.number ?? ""}` : "")}</Text>
        </View>
      </View>
      <View style={styles.grow} />
      {p.connecting === true ? null : (
        <View style={styles.ibs}>
          <IconButton label={p.muted === true ? "Unmute" : "Mute"} icon={p.muted === true ? "micoff" : "mic"} on={p.muted === true} onPress={() => p.onMute?.()} testID="softphone-mute" />
          <IconButton label={held ? "Resume" : "Hold"} icon="pause" on={held} onPress={() => p.onHold?.()} testID="softphone-hold" />
          <IconButton label="Keypad" icon="pad" on={pad} onPress={() => setPad((v) => !v)} testID="softphone-keypad" />
          <IconButton label="Transfer" icon="xfer" onPress={(x, y) => menu.show(transferMenu(targets, (n) => p.onTransfer?.(n)), x, y, "context", { label: "Transfer call" })} testID="softphone-transfer" />
          <IconButton label={rec === "off" ? "Record" : "Stop recording"} icon="rec" tone="rec" on={rec !== "off"} onPress={() => p.onRecord?.()} testID="softphone-record" />
        </View>
      )}
      <Pressable accessibilityRole="button" accessibilityLabel={p.connecting === true ? "Cancel call" : "Hang up"} onPress={p.onHangup} testID="softphone-hangup" {...webProps({ title: p.connecting === true ? "Cancel  Esc" : "Hang up" })} style={({ hovered }: Hover) => [styles.hang, hovered === true && styles.btnHover]}>
        <Glyph name="hang" size={16} color="#fff" />
      </Pressable>
      {pad ? (
        <View style={[styles.popPad, POP_SHADOW]} testID="softphone-pad">
          <View style={styles.pad}>{padNodes}</View>
        </View>
      ) : null}
      {menu.element}
    </View>
  );
}

/** The Call tab for the right pane: notes, recording line, the caller's record card. */
export interface CallCard {
  last?: readonly { kind: "mail" | "sms" | "call" | "vm"; text: string; when: string }[];
  tasks?: readonly { title: string; due?: string }[];
}

export interface CallPaneProps {
  caller?: SoftphoneCaller;
  notes?: string;
  recording?: boolean;
  consent?: boolean;
  card?: CallCard;
  density?: "regular" | "compact";
  onNotes?: (text: string) => void;
  onOpenRecord?: (recordId: string) => void;
}

export function CallPane(p: CallPaneProps): ReactElement {
  const c = p.caller;
  const rec = recordingState({ recording: p.recording === true, consent: p.consent === true });
  const recordId = c?.recordId;
  const lastNodes: ReactElement[] = [];
  for (const [i, l] of (p.card?.last ?? []).slice(0, 4).entries()) {
    lastNodes.push(
      <View key={`${l.text}:${i}`} style={styles.line}>
        <Glyph name={l.kind === "call" ? "phone" : "link"} size={14} color="var(--ink-3)" />
        <Text style={styles.lineText} numberOfLines={1}>{l.text}</Text>
        <Text style={styles.lineWhen}>{l.when}</Text>
      </View>,
    );
  }
  const taskNodes: ReactElement[] = [];
  for (const [i, t] of (p.card?.tasks ?? []).slice(0, 4).entries()) {
    taskNodes.push(
      <View key={`${t.title}:${i}`} style={styles.line}>
        <Glyph name="circle" size={14} color="var(--ink-3)" />
        <Text style={styles.lineText} numberOfLines={1}>{t.title}</Text>
        <Text style={styles.lineWhen}>{t.due ?? ""}</Text>
      </View>,
    );
  }
  return (
    <View accessibilityLabel="Call" testID="softphone-pane" style={styles.pane}>
      <Text style={styles.sh}>Notes</Text>
      <TextInput
        defaultValue={p.notes ?? ""}
        onChangeText={p.onNotes}
        placeholder="Notes for this call"
        placeholderTextColor="var(--ink-3)"
        accessibilityLabel="Notes"
        testID="softphone-notes"
        multiline
        style={styles.note}
      />
      {rec !== "off" ? (
        <View style={styles.recRow} testID="softphone-consent">
          <Text style={styles.recText}>{rec === "on" ? "Recording. The caller was told and consent is logged." : "Recording waits for consent. It records nothing until the caller agrees."}</Text>
        </View>
      ) : null}
      {lastNodes.length > 0 ? <Text style={styles.sh}>Last interactions</Text> : null}
      {lastNodes}
      {taskNodes.length > 0 ? <Text style={styles.sh}>Open tasks</Text> : null}
      {taskNodes}
      {recordId === undefined ? (
        <View style={styles.line}><Glyph name="link" size={14} color="var(--ink-3)" /><Text style={styles.lineText}>No record has this number</Text></View>
      ) : (
        <Pressable accessibilityRole="link" accessibilityLabel={`Open ${c?.name ?? "the"} record`} onPress={() => p.onOpenRecord?.(recordId)} testID="softphone-open-record" style={({ hovered }: Hover) => [styles.link, hovered === true && styles.linkHover]}>
          <Text style={styles.linkText}>{`Open ${c?.name !== undefined ? `${c.name}'s` : "the"} record`}</Text>
          <Glyph name="link" size={10} color="var(--accent)" />
        </Pressable>
      )}
    </View>
  );
}

function Ended(p: SoftphoneViewProps): ReactElement {
  const [task, setTask] = useState("");
  const [logged, setLogged] = useState(false);
  const c = p.caller;
  const name = c?.name !== undefined && c.name.length > 0 ? c.name : (c?.number ?? "the caller");
  const secs = p.endedSecs ?? p.secs ?? 0;
  const ready = p.summary !== undefined || (p.transcript ?? []).length > 0;
  const trNodes: ReactElement[] = [];
  for (const [i, t] of (p.transcript ?? []).entries()) trNodes.push(<Text key={`${t.who}:${i}`} style={styles.trLine}><Text style={styles.trWho}>{`${t.who}: `}</Text>{t.text}</Text>);
  return (
    <View accessibilityLabel="Call ended" testID="softphone-ended" style={[styles.card, POP_SHADOW]} {...webProps({ role: "status" })}>
      <View style={styles.dhead}>
        <Tile name={name} size={26} unknown={c?.name === undefined} />
        <View style={styles.who}>
          <Text style={styles.barName} numberOfLines={1}>{`Call ended · ${formatClock(secs)}`}</Text>
          <Text style={styles.tm}>{ready ? (p.endedNote ?? `Saved to ${name}'s conversation`) : "Saving your notes"}</Text>
        </View>
        <View style={styles.grow} />
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={p.onDismiss ?? p.onClose} testID="softphone-dismiss" style={({ hovered }: Hover) => [styles.x, hovered === true && styles.ibHover]}>
          <Glyph name="x" size={14} color="var(--ink-3)" />
        </Pressable>
      </View>
      {p.summary !== undefined ? (
        <View style={styles.sum} testID="softphone-summary">
          <Text style={styles.sh}>Summary</Text>
          <Text style={styles.sumText}>{p.summary}</Text>
        </View>
      ) : null}
      {(p.transcript ?? []).length > 0 ? (
        <View style={styles.sum} testID="softphone-transcript">
          <Text style={styles.sh}>Transcript</Text>
          <View style={styles.tr}>{trNodes}</View>
        </View>
      ) : null}
      {logged ? (
        <View style={styles.okRow}><Glyph name="check" size={14} color="var(--ok)" /><Text style={styles.okText}>Task logged</Text></View>
      ) : (
        <View style={styles.taskRow}>
          <TextInput value={task} onChangeText={setTask} placeholder={`Follow up with ${name}`} placeholderTextColor="var(--ink-3)" accessibilityLabel="Task title" testID="softphone-task-input" style={styles.taskIn} />
          <PillButton label="Log a task" tone="quiet" testID="softphone-log-task" onPress={() => { const title = task.trim().length > 0 ? task.trim() : `Follow up with ${name}`; p.onLogTask?.(title); setLogged(true); }} />
        </View>
      )}
      {c?.recordId !== undefined ? (
        <Pressable accessibilityRole="link" accessibilityLabel={`Open ${name}'s record`} onPress={() => p.onOpenRecord?.(c.recordId ?? "")} testID="softphone-open-record" style={({ hovered }: Hover) => [styles.link, styles.linkPad, hovered === true && styles.linkHover]}>
          <Text style={styles.linkText}>{`Open ${name}'s record`}</Text>
          <Glyph name="link" size={10} color="var(--accent)" />
        </Pressable>
      ) : null}
    </View>
  );
}

/** The Softphone. Props decide the screen: pill, dialer, incoming sheet, call bar, or the after-call card. */
export function Softphone(p: SoftphoneViewProps): ReactElement | null {
  const first = p.numbers[0];
  const from = p.numbers.find((n) => n.id === p.fromId) ?? first;
  const wrap = (child: ReactElement): ReactElement => (
    <View accessibilityLabel={softphoneLabel(p)} testID={p.testID ?? "softphone"} {...webProps({ dataSet: { mode: p.mode } })} style={p.placement === "inline" ? styles.inline : p.mode === "incoming" ? DOCK_RING : DOCK}>
      {child}
    </View>
  );
  switch (p.mode) {
    case "incoming": return wrap(<Incoming {...p} via={from?.num ?? from?.label ?? "your number"} />);
    case "live": case "held": return wrap(<CallBar {...p} />);
    case "ended": return wrap(<Ended {...p} />);
    case "dialer": return wrap(<Dialer {...p} />);
    default:
      if (p.open) return wrap(<Dialer {...p} />);
      if (p.numbers.length === 0) return null;
      return wrap(<IdlePill number={from?.num ?? ""} onOpen={p.onOpen} />);
  }
}

export const SOFTPHONE_VIEW_MODES: readonly SoftphoneMode[] = SOFTPHONE_MODES;

/* ---------- styles ---------- */

const styles = StyleSheet.create({
  inline: { alignSelf: "flex-start", maxWidth: "100%" },
  grow: { flex: 1 },
  card: { width: 328, maxWidth: "100%", borderRadius: 16, backgroundColor: "var(--raised)" as string, overflow: "hidden", paddingBottom: 4 },
  cardCompact: { width: "100%" },
  sheet: { width: 340, maxWidth: "100%", borderRadius: 14, backgroundColor: "var(--raised)" as string, overflow: "hidden" },
  dhead: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 10, paddingLeft: 14, paddingRight: 8, paddingBottom: 6 },
  from: { flexDirection: "row", alignItems: "center", gap: 4, height: 24, paddingHorizontal: 6, marginLeft: -6, borderRadius: 6, flexShrink: 1 },
  fromHover: { backgroundColor: "var(--hover)" as string },
  fromText: { color: "var(--ink-2)" as string, fontSize: 12 },
  x: { width: 26, height: 26, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  dinRow: { flexDirection: "row", alignItems: "center", marginHorizontal: 14, marginTop: 2, marginBottom: 6, gap: 6 },
  din: { flex: 1, minWidth: 0, height: 40, padding: 0, color: "var(--ink)" as string, fontSize: 20, lineHeight: 24, fontWeight: "500" },
  sug: { marginHorizontal: 8, marginBottom: 6, paddingTop: 4, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  sugRow: { flexDirection: "row", alignItems: "center", gap: 9, height: 40, paddingHorizontal: 6, borderRadius: 8 },
  sugName: { flex: 1, color: "var(--ink)" as string, fontSize: 13, fontWeight: "500" },
  sugNum: { color: "var(--ink-3)" as string, fontSize: 12 },
  pad: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 18, paddingTop: 4, paddingBottom: 8, gap: 4 },
  key: { width: "31.5%", height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  keySm: { width: "31.5%", height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  keyPress: { backgroundColor: "var(--press)" as string },
  keyText: { color: "var(--ink)" as string, fontSize: 19, lineHeight: 20, fontWeight: "500" },
  keyLetters: { color: "var(--ink-3)" as string, fontSize: 8.5, letterSpacing: 1, fontWeight: "600", height: 10, marginTop: 2 },
  go: { alignItems: "center", paddingTop: 4, paddingBottom: 16 },
  round: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  roundOk: { backgroundColor: "var(--ok)" as string },
  roundOff: { opacity: 0.4 },
  pill: { height: 34, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 11, paddingRight: 13, borderRadius: 17, backgroundColor: "var(--raised)" as string },
  pillHover: { backgroundColor: "var(--sel-strong)" as string },
  pillText: { color: "var(--ink-2)" as string, fontSize: 12.5, fontWeight: "500" },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "var(--ok)" as string },
  dotHold: { backgroundColor: "var(--warn)" as string },
  bar: { flexDirection: "row", alignItems: "center", gap: 4, height: 46, paddingLeft: 18, paddingRight: 10, backgroundColor: "var(--side)" as string, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string, minWidth: 320, maxWidth: "100%" },
  barCompact: { paddingLeft: 12, paddingRight: 6 },
  who: { flexShrink: 1, minWidth: 0, marginLeft: 8, gap: 1 },
  barName: { color: "var(--ink)" as string, fontSize: 13, lineHeight: 16, fontWeight: "600" },
  tmRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  tm: { color: "var(--ink-3)" as string, fontSize: 12, lineHeight: 15 },
  ibs: { flexDirection: "row", alignItems: "center", gap: 2 },
  ib: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  ibHover: { backgroundColor: "var(--hover)" as string },
  ibOn: { backgroundColor: "var(--accent-wash)" as string },
  ibRec: { backgroundColor: "var(--hover)" as string },
  hang: { width: 34, height: 30, marginLeft: 6, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "var(--danger)" as string },
  popPad: { position: "absolute", top: 46, right: 10, width: 232, borderRadius: 14, backgroundColor: "var(--raised)" as string, paddingVertical: 6, zIndex: 5 },
  inTop: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  inName: { color: "var(--ink)" as string, fontSize: 14, fontWeight: "600" },
  sub: { color: "var(--ink-3)" as string, fontSize: 12.5 },
  inActs: { flexDirection: "row", gap: 8, paddingHorizontal: 14, paddingBottom: 14 },
  btn: { height: 32, paddingHorizontal: 14, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  btnFlex: { flex: 1 },
  btnQuiet: { backgroundColor: "var(--hover)" as string },
  btnOk: { backgroundColor: "var(--ok)" as string },
  btnDanger: { backgroundColor: "var(--danger)" as string },
  btnHover: { opacity: 0.9 },
  btnText: { color: "var(--ink)" as string, fontSize: 13, fontWeight: "600" },
  btnTextOn: { color: "#fff" },
  pane: { paddingTop: 6, paddingHorizontal: 16, paddingBottom: 20 },
  sh: { marginTop: 10, marginBottom: 4, color: "var(--ink-3)" as string, fontSize: 11.5, fontWeight: "600" },
  note: { minHeight: 96, padding: 10, borderRadius: 9, backgroundColor: "var(--hover)" as string, color: "var(--ink)" as string, fontSize: 13, lineHeight: 18, textAlignVertical: "top" },
  recRow: { marginTop: 8 },
  recText: { color: "var(--danger)" as string, fontSize: 12 },
  line: { flexDirection: "row", alignItems: "center", gap: 8, height: 26 },
  lineText: { flex: 1, minWidth: 0, color: "var(--ink-2)" as string, fontSize: 13 },
  lineWhen: { color: "var(--ink-3)" as string, fontSize: 11.5 },
  link: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", height: 22, marginTop: 10, paddingHorizontal: 2, borderRadius: 5 },
  linkPad: { marginHorizontal: 12, marginBottom: 8 },
  linkHover: { backgroundColor: "var(--accent-wash)" as string },
  linkText: { color: "var(--accent)" as string, fontSize: 12.5, fontWeight: "500" },
  sum: { marginTop: 6, marginHorizontal: 14 },
  sumText: { color: "var(--ink)" as string, fontSize: 13, lineHeight: 19 },
  tr: { maxHeight: 120, gap: 2 },
  trLine: { color: "var(--ink-2)" as string, fontSize: 12.5, lineHeight: 18 },
  trWho: { color: "var(--ink)" as string, fontWeight: "600" },
  okRow: { flexDirection: "row", alignItems: "center", gap: 7, marginHorizontal: 14, marginTop: 10 },
  okText: { color: "var(--ok)" as string, fontSize: 12.5, fontWeight: "500" },
  taskRow: { flexDirection: "row", gap: 6, marginHorizontal: 14, marginTop: 10, alignItems: "center" },
  taskIn: { flex: 1, minWidth: 0, height: 32, paddingHorizontal: 10, borderRadius: 8, backgroundColor: "var(--hover)" as string, color: "var(--ink)" as string, fontSize: 13 },
});
