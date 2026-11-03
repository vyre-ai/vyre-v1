// The two cards an agent working in the person's own Chrome leaves in a chat (Chrome step 2):
//   chrome_held  a send, post, payment or delete the agent reached and did not press: what it would do (To, From, Subject, Message), with Send, Edit and Don't send. The page in Chrome says
//                "Waiting for you in Vyre" meanwhile. The fields are read from the page by the extension (never a secret field), not written by the agent.
//   chrome_step  "Using your Chrome · <site>": a small masked picture of the tab, refreshed while the agent works, with Watch (opens the tab) and Take over.
// Both read only their own data; a picture is shown only as a data: image the extension made. What the buttons do is the caller's (actions.chrome).
import { useState } from "react";
import type { ReactElement } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { Glyph, TextButton } from "./parts.tsx";

export interface HeldCardData {
  heldId: string; agent: string; site: string; kind: string; to: string; from: string; subject: string; message: string; summary: string;
  state: "waiting" | "sent" | "dropped" | "expired";
}
export interface StepCardData { agent: string; site: string; thumb: string | null; state: "using" | "waiting" | "paused" | "done" | "stopped"; /** Vault handles the agent was given on this page (names, never values). */ saw: string[]; /** The list of handles starts open (a screenshot mount). */ open: boolean }
/** What a button press on a card needs to name. */
export interface HeldRef { heldId: string; agentId: string; summary: string }
/** What the buttons do. Each answers when it is done, or throws with words for the person. send answers whether it went out now (false: it was already done). */
export interface ChromeCardActions {
  send(h: HeldRef): Promise<{ sent: boolean }>;
  drop(h: HeldRef): Promise<void>;
  /** Edit means the person changes it in Chrome themselves: the agent steps back and the tab is theirs. */
  edit(h: HeldRef): Promise<void>;
  watch(agentId: string): Promise<void>;
  takeOver(agentId: string): Promise<void>;
}

const HANDLE = /^#[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/;
const THUMB = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const str = (v: unknown, n: number): string => (typeof v === "string" ? v.trim().slice(0, n) : "");

export const isChromeHeld = (type: string): boolean => type === "chrome_held";
export const isChromeStep = (type: string): boolean => type === "chrome_step";

/** A chrome_held block's data, or null when it names no held item. */
export function heldCardOf(data: unknown): HeldCardData | null {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const heldId = str(d["heldId"], 80);
  if (!/^hld_[0-9a-f]+$/.test(heldId)) return null;
  const card = (d["card"] && typeof d["card"] === "object" ? d["card"] : d) as Record<string, unknown>;
  const state = d["state"] === "sent" || d["state"] === "dropped" || d["state"] === "expired" ? d["state"] : "waiting";
  return { heldId, agent: str(d["agent"], 60) || "An agent", site: str(d["site"] ?? card["site"], 120), kind: str(d["kind"], 20) || "send", to: str(card["to"], 200), from: str(card["from"], 200), subject: str(card["subject"], 200), message: str(card["message"], 2000), summary: str(d["summary"], 200), state };
}

/** A chrome_step block's data, or null when it names no site. */
export function stepCardOf(data: unknown): StepCardData | null {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const site = str(d["site"], 120);
  if (!site) return null;
  const state = d["state"] === "waiting" || d["state"] === "paused" || d["state"] === "done" || d["state"] === "stopped" ? d["state"] : "using";
  const saw = (Array.isArray(d["saw"]) ? d["saw"] : []).filter((h): h is string => typeof h === "string" && HANDLE.test(h)).slice(0, 20);
  return { agent: str(d["agent"], 60) || "An agent", site, thumb: typeof d["thumb"] === "string" && THUMB.test(d["thumb"]) ? d["thumb"] : null, state, saw, open: d["open"] === true };
}

/** What the button and the card call the act: Send, Post, Pay or Delete. */
export function verbOf(kind: string): { do: string; dont: string; what: string } {
  switch (kind) {
    case "post": return { do: "Post", dont: "Don't post", what: "post this" };
    case "payment": return { do: "Pay", dont: "Don't pay", what: "make this payment" };
    case "delete": return { do: "Delete", dont: "Don't delete", what: "delete this" };
    case "send": return { do: "Send", dont: "Don't send", what: "send this" };
    default: return { do: "Go ahead", dont: "Don't", what: "do this" };
  }
}

export const stepWords = (s: StepCardData): string => (s.state === "done" ? `Used your Chrome · ${s.site}` : s.state === "stopped" ? `Stopped in your Chrome · ${s.site}` : s.state === "paused" ? `Paused in your Chrome · ${s.site}` : s.state === "waiting" ? `Waiting for you · ${s.site}` : `Using your Chrome · ${s.site}`);

export function HeldSendCard({ id, data, agentId, agentName, actions }: { id: string; data: unknown; agentId: string; agentName?: string | undefined; actions?: ChromeCardActions | undefined }): ReactElement | null {
  const found = heldCardOf(data);
  if (!found) return null;
  const h = { ...found, agent: found.agent === "An agent" && agentName ? agentName : found.agent };
  const v = verbOf(h.kind);
  const rows: Array<[string, string]> = ([["To", h.to], ["From", h.from], ["Subject", h.subject], ["Message", h.message]] as Array<[string, string]>).filter(([, t]) => t !== "");
  const [local, setLocal] = useState<"" | "sent" | "dropped" | "editing">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = h.state === "waiting" && local === "";
  const ref: HeldRef = { heldId: h.heldId, agentId: found.agentId || agentId, summary: h.summary };
  const press = (f: () => Promise<void>): void => {
    setBusy(true); setError("");
    f().then(() => setBusy(false), (e: unknown) => { setBusy(false); setError(e instanceof Error ? e.message : "That did not work. Try again."); });
  };
  const where = h.site ? `${h.site}, in your Chrome` : "";
  const heldTitle = h.kind === "send" ? "Held: send this" : h.kind === "post" ? "Held: post this" : h.kind === "payment" ? "Held: make this payment" : h.kind === "delete" ? "Held: delete this" : "Held: waiting for you";
  return (
    <View testID={`chrome-held-${id}`} accessibilityRole="summary" accessibilityLabel={`${h.agent} wants to ${v.what}`} style={s.card}>
      <View style={s.band}>
        <Glyph name="lock" color="var(--ink-2)" />
        <Text style={s.bandTitle} numberOfLines={1}>{heldTitle}</Text>
        <Text style={s.needs}>{open ? "Needs you" : h.state === "sent" ? "Sent" : "Done"}</Text>
      </View>
      <Text style={s.who}>{`${h.agent} wants to ${v.what}`}</Text>
      {rows.length > 0 ? (
        <View style={s.rows}>
          {rows.map(([label, text]) => (
            <View key={label} style={s.row}><Text style={s.label}>{label}</Text><Text style={[s.value, label === "Message" && s.message]} numberOfLines={label === "Message" ? 8 : 2}>{text}</Text></View>
          ))}
          {where ? <View style={s.row}><Text style={s.label}>Where</Text><Text style={s.value}>{where}</Text></View> : null}
        </View>
      ) : <Text style={s.summary}>{h.summary || "Something is waiting for you in Chrome."}</Text>}
      <View style={s.foot}>
        {open ? (
          <View style={s.actions}>
            <TextButton label={v.do} primary icon="check" onPress={() => press(async () => { await (actions as ChromeCardActions).send(ref); setLocal("sent"); })} disabled={!actions || busy} testID={`chrome-held-send-${id}`} />
            <TextButton label="Edit" ring icon="edit" onPress={() => press(async () => { await (actions as ChromeCardActions).edit(ref); setLocal("editing"); })} disabled={!actions || busy} testID={`chrome-held-edit-${id}`} />
            <TextButton label={v.dont} onPress={() => press(async () => { await (actions as ChromeCardActions).drop(ref); setLocal("dropped"); })} disabled={!actions || busy} testID={`chrome-held-drop-${id}`} />
          </View>
        ) : <Text style={s.state} testID={`chrome-held-state-${id}`}>{h.state === "sent" || local === "sent" ? "Sent" : h.state === "dropped" || local === "dropped" ? `Not sent. ${h.agent} was told.` : local === "editing" ? "The tab is yours. Change what you need in Chrome and press Send there. The agent waits." : "No longer waiting"}</Text>}
        {error ? <Text style={s.error} accessibilityRole="alert" testID={`chrome-held-error-${id}`}>{error}</Text> : null}
        {open ? <Text style={s.stopped}>{`${h.agent} stopped before ${v.do}`}</Text> : null}
      </View>
    </View>
  );
}

export function ChromeStepCard({ id, data, agentId, agentName, actions }: { id: string; data: unknown; agentId: string; agentName?: string | undefined; actions?: ChromeCardActions | undefined }): ReactElement | null {
  const found = stepCardOf(data);
  if (!found) return null;
  const c = { ...found, agent: found.agent === "An agent" && agentName ? agentName : found.agent };
  const live = c.state === "using" || c.state === "waiting";
  const [showSaw, setShowSaw] = useState(c.open);
  return (
    <View testID={`chrome-step-${id}`} accessibilityLabel={stepWords(c)} style={s.step}>
      {c.thumb ? <Image testID={`chrome-step-${id}-thumb`} source={{ uri: c.thumb }} style={s.thumb} resizeMode="cover" accessibilityIgnoresInvertColors /> : <View style={s.tile}><Text style={s.tileText}>{(c.site[0] ?? "?").toUpperCase()}</Text></View>}
      <View style={s.words}>
        <Text style={s.title} numberOfLines={1}>{stepWords(c)}</Text>
        <Text style={s.site} numberOfLines={1}>{c.agent}</Text>
        {live ? (
          <View style={s.actions}>
            <TextButton label="Watch" onPress={() => { void actions?.watch(agentId).catch(() => undefined); }} disabled={!actions} testID={`chrome-step-watch-${id}`} />
            <TextButton label="Take over" onPress={() => { void actions?.takeOver(agentId).catch(() => undefined); }} disabled={!actions} testID={`chrome-step-takeover-${id}`} />
          </View>
        ) : null}
        {c.saw.length > 0 ? (
          <View style={{ gap: 3, alignSelf: "flex-start" }}>
            <TextButton link label={showSaw ? `Hide what ${c.agent} saw` : `Show what ${c.agent} saw`} onPress={() => setShowSaw((x) => !x)} testID={`chrome-step-saw-${id}`} />
            {showSaw ? <View testID={`chrome-step-handles-${id}`}>{c.saw.map((h) => <Text key={h} style={s.handle}>{h}</Text>)}<Text style={s.site}>Names only. What they hold never reached {c.agent}.</Text></View> : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { marginTop: 6, maxWidth: 666, alignSelf: "stretch", gap: 10, paddingBottom: 12, borderRadius: 10, borderWidth: 1, borderColor: "var(--accent-line)" as string, backgroundColor: "var(--raised)" as string, overflow: "hidden" },
  band: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: "var(--sel)" as string },
  bandTitle: { flex: 1, fontSize: 13.5, fontWeight: "500", color: "var(--ink)" as string },
  needs: { fontSize: 12, color: "var(--ink-3)" as string },
  who: { paddingHorizontal: 12, fontSize: 12.5, color: "var(--ink-3)" as string },
  foot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, paddingHorizontal: 12, paddingTop: 4 },
  error: { fontSize: 12, color: "var(--danger)" as string },
  stopped: { fontSize: 12, color: "var(--ink-3)" as string },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flexShrink: 1, fontSize: 13.5, fontWeight: "500", color: "var(--ink)" as string },
  site: { fontSize: 11.5, color: "var(--ink-3)" as string },
  rows: { gap: 6, paddingHorizontal: 12 },
  row: { flexDirection: "row", gap: 10 },
  label: { width: 72, fontSize: 12, color: "var(--ink-3)" as string, paddingTop: 1 },
  value: { flex: 1, minWidth: 0, fontSize: 13, color: "var(--ink)" as string },
  message: { lineHeight: 19, color: "var(--ink-2)" as string },
  summary: { paddingHorizontal: 12, fontSize: 13, color: "var(--ink-2)" as string },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 2 },
  state: { fontSize: 12.5, color: "var(--ink-3)" as string },
  step: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 6, padding: 8, paddingRight: 14, maxWidth: 520, alignSelf: "stretch", minWidth: 0, borderRadius: 12, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--raised)" as string },
  thumb: { width: 96, height: 60, flexShrink: 0, borderRadius: 8, borderWidth: 1, borderColor: "var(--line-2)" as string, backgroundColor: "#fff" },
  tile: { width: 96, height: 60, flexShrink: 0, borderRadius: 8, backgroundColor: "var(--sunk)" as string, alignItems: "center", justifyContent: "center" },
  tileText: { fontSize: 22, fontWeight: "600", color: "var(--ink-3)" as string },
  words: { flex: 1, minWidth: 0, gap: 2 },
  handle: { flexShrink: 1, fontSize: 12.5, color: "var(--ink-2)" as string, fontFamily: "var(--mono, ui-monospace, Menlo, monospace)" as string },
});
