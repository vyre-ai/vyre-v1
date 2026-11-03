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
export interface ChromeCardActions {
  send(heldId: string): void | Promise<void>;
  drop(heldId: string): void | Promise<void>;
  edit(heldId: string): void | Promise<void>;
  watch(agentId: string): void | Promise<void>;
  takeOver(agentId: string): void | Promise<void>;
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

export function HeldSendCard({ id, data, agentId, actions }: { id: string; data: unknown; agentId: string; actions?: ChromeCardActions | undefined }): ReactElement | null {
  const h = heldCardOf(data);
  if (!h) return null;
  const v = verbOf(h.kind);
  const rows: Array<[string, string]> = ([["To", h.to], ["From", h.from], ["Subject", h.subject], ["Message", h.message]] as Array<[string, string]>).filter(([, t]) => t !== "");
  const open = h.state === "waiting";
  void agentId;
  return (
    <View testID={`chrome-held-${id}`} accessibilityRole="summary" accessibilityLabel={`${h.agent} wants to ${v.what}`} style={s.card}>
      <View style={s.head}>
        <Glyph name="lock" color="var(--warn)" />
        <Text style={s.title} numberOfLines={2}>{`${h.agent} wants to ${v.what}`}</Text>
        {h.site ? <Text style={s.site} numberOfLines={1}>{h.site}</Text> : null}
      </View>
      {rows.length > 0 ? (
        <View style={s.rows}>
          {rows.map(([label, text]) => (
            <View key={label} style={s.row}><Text style={s.label}>{label}</Text><Text style={[s.value, label === "Message" && s.message]} numberOfLines={label === "Message" ? 8 : 2}>{text}</Text></View>
          ))}
        </View>
      ) : <Text style={s.summary}>{h.summary || "Something is waiting for you in Chrome."}</Text>}
      {open ? (
        <View style={s.actions}>
          <TextButton label={v.do} primary onPress={() => { void actions?.send(h.heldId); }} disabled={!actions} testID={`chrome-held-send-${id}`} />
          <TextButton label="Edit" onPress={() => { void actions?.edit(h.heldId); }} disabled={!actions} testID={`chrome-held-edit-${id}`} />
          <TextButton label={v.dont} danger onPress={() => { void actions?.drop(h.heldId); }} disabled={!actions} testID={`chrome-held-drop-${id}`} />
        </View>
      ) : <Text style={s.state} testID={`chrome-held-state-${id}`}>{h.state === "sent" ? "Sent" : h.state === "dropped" ? "Not sent" : "No longer waiting"}</Text>}
    </View>
  );
}

export function ChromeStepCard({ id, data, agentId, actions }: { id: string; data: unknown; agentId: string; actions?: ChromeCardActions | undefined }): ReactElement | null {
  const c = stepCardOf(data);
  if (!c) return null;
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
            <TextButton label="Watch" onPress={() => { void actions?.watch(agentId); }} disabled={!actions} testID={`chrome-step-watch-${id}`} />
            <TextButton label="Take over" onPress={() => { void actions?.takeOver(agentId); }} disabled={!actions} testID={`chrome-step-takeover-${id}`} />
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
  card: { marginTop: 6, maxWidth: 520, padding: 12, gap: 10, borderRadius: 12, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--raised)" as string },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flexShrink: 1, fontSize: 13.5, fontWeight: "500", color: "var(--ink)" as string },
  site: { fontSize: 11.5, color: "var(--ink-3)" as string },
  rows: { gap: 6 },
  row: { flexDirection: "row", gap: 10 },
  label: { width: 60, fontSize: 12, color: "var(--ink-3)" as string, paddingTop: 1 },
  value: { flex: 1, minWidth: 0, fontSize: 13, color: "var(--ink)" as string },
  message: { lineHeight: 19, color: "var(--ink-2)" as string },
  summary: { fontSize: 13, color: "var(--ink-2)" as string },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 2 },
  state: { fontSize: 12.5, color: "var(--ink-3)" as string },
  step: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 6, padding: 8, paddingRight: 14, maxWidth: 520, alignSelf: "stretch", minWidth: 0, borderRadius: 12, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--raised)" as string },
  thumb: { width: 96, height: 60, flexShrink: 0, borderRadius: 8, borderWidth: 1, borderColor: "var(--line-2)" as string, backgroundColor: "#fff" },
  tile: { width: 96, height: 60, flexShrink: 0, borderRadius: 8, backgroundColor: "var(--sunk)" as string, alignItems: "center", justifyContent: "center" },
  tileText: { fontSize: 22, fontWeight: "600", color: "var(--ink-3)" as string },
  words: { flex: 1, minWidth: 0, gap: 2 },
  handle: { flexShrink: 1, fontSize: 12.5, color: "var(--ink-2)" as string, fontFamily: "var(--mono, ui-monospace, Menlo, monospace)" as string },
});
