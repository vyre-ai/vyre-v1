// The two cards an agent working in the person's own Chrome leaves in a chat (Chrome step 2):
//   chrome_held  a send, post, payment or delete the agent reached and did not press: what it would do (To, From, Subject, Message), with Send, Edit and Don't send. The page in Chrome says
//                "Waiting for you in Vyre" meanwhile. The fields are read from the page by the extension (never a secret field), not written by the agent.
//   chrome_step  "Using your Chrome · <site>": a small masked picture of the tab, refreshed while the agent works, with Watch (opens the tab) and Take over.
// Both read only their own data; a picture is shown only as a data: image the extension made. What the buttons do is the caller's (actions.chrome).
import { useState } from "react";
import type { ReactElement } from "react";
import { Image, StyleSheet, Text, TextInput, View } from "react-native";
import { Glyph, TextButton } from "./parts.tsx";
import { HeldCard } from "./held-card.tsx";

export interface HeldCardData {
  heldId: string; agent: string; site: string; kind: string; to: string; from: string; subject: string; message: string; summary: string;
  state: "waiting" | "sent" | "dropped" | "expired";
}
export interface StepCardData { agent: string; site: string; thumb: string | null; state: "using" | "waiting" | "paused" | "done" | "stopped"; /** Vault handles the agent was given on this page (names, never values). */ saw: string[]; /** The list of handles starts open (a screenshot mount). */ open: boolean; goal: string; steps: Array<{ text: string; state: "done" | "waiting" | "todo" }> }
/** What a button press on a card needs to name. */
export interface HeldRef { heldId: string; agentId: string; summary: string }
/** What the buttons do. Each answers when it is done, or throws with words for the person. send answers whether it went out now (false: it was already done). */
export interface ChromeCardActions {
  send(h: HeldRef, edits?: { to?: string; subject?: string; message?: string }): Promise<{ sent: boolean }>;
  drop(h: HeldRef, reason?: string): Promise<void>;
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
  return { agent: str(d["agent"], 60) || "An agent", site, thumb: typeof d["thumb"] === "string" && THUMB.test(d["thumb"]) ? d["thumb"] : null, state, saw, open: d["open"] === true, goal: str(d["goal"], 200), steps: (Array.isArray(d["steps"]) ? d["steps"] : []).slice(0, 21).flatMap((x) => { const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>; const text = str(o["text"], 200); return text ? [{ text, state: (o["state"] === "done" || o["state"] === "waiting" ? o["state"] : "todo") as "done" | "waiting" | "todo" }] : []; }) };
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
  const [saved, setSaved] = useState<{ to: string; subject: string; message: string } | null>(null);
  if (!found) return null;
  const h = { ...found, agent: found.agent === "An agent" && agentName ? agentName : found.agent };
  const v = verbOf(h.kind);
  const shown = saved ?? { to: h.to, subject: h.subject, message: h.message };
  const ref: HeldRef = { heldId: h.heldId, agentId: found.agentId || agentId, summary: h.summary };
  const fields: Array<readonly [string, string]> = [];
  if (h.from) fields.push(["From", h.from]);
  if (h.site) fields.push(["Where", `${h.site}, in your Chrome`]);
  const body = shown.message || (h.summary ? h.summary : "Something is waiting for you in Chrome.");
  // the one held card (held-card.tsx): To is the recipient, the Message is the body; what Send, Edit and Don't send do is Chrome's (the extension writes the edits into the page, then presses)
  return (
    <HeldCard
      testID={`chrome-held-${id}`} agent={h.agent} to={shown.to ? [{ name: shown.to, seed: shown.to, kind: "person" }] : []} verb={shown.to && h.kind === "send" ? `send this to ${shown.to}` : v.what}
      subject={shown.subject || undefined} fields={fields} body={body} edited={saved !== null} state={h.state === "sent" ? "sent" : h.state === "dropped" ? "dropped" : "waiting"}
      doneLine={h.state === "dropped" ? `Not sent. ${h.agent} was told.` : undefined} editable={Boolean(actions)} editTo editSubject sendLabel={v.do} dropLabel={v.dont} stoppedNote={`${h.agent} stopped before ${v.do}`}
      onSend={async () => { await (actions as ChromeCardActions).send(ref, saved ? { to: saved.to, subject: saved.subject, message: saved.message } : undefined); }}
      onSave={async (e) => { setSaved({ to: e.to ?? h.to, subject: e.subject ?? h.subject, message: e.body }); }}
      onDrop={async (reason) => { await (actions as ChromeCardActions).drop(ref, reason || undefined); }}
    />
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
        {c.steps.length > 0 ? (
          <View style={s.checks} testID={`chrome-step-checks-${id}`}>
            {/* ui-rows-lint: not a list (the lines of one checklist inside a card) */}
            {c.steps.map((st, i) => (
              <View key={i} style={s.check}><Glyph name={st.state === "waiting" ? "lock" : "check"} size={13} color={st.state === "done" ? "var(--ok)" : "var(--ink-3)"} /><Text style={[s.checkText, st.state === "waiting" && s.checkWait]}>{st.text}</Text></View>
            ))}
            <Text style={s.site}>{`Tab group "Vyre · ${c.agent}" in your Chrome.`}</Text>
          </View>
        ) : null}
        {live ? (
          <View style={s.actions}>
            <TextButton label="Watch" onPress={() => { void actions?.watch(agentId).catch(() => undefined); }} disabled={!actions} testID={`chrome-step-watch-${id}`} />
            <TextButton label="Take over" onPress={() => { void actions?.takeOver(agentId).catch(() => undefined); }} disabled={!actions} testID={`chrome-step-takeover-${id}`} />
          </View>
        ) : null}
        {c.saw.length > 0 ? (
          <View style={{ gap: 3, alignSelf: "flex-start" }}>
            <TextButton link label={showSaw ? `Hide what ${c.agent} saw` : `Show what ${c.agent} saw`} onPress={() => setShowSaw((x) => !x)} testID={`chrome-step-saw-${id}`} />
            {/* ui-rows-lint: not a list (handle names in one disclosure) */}
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
  input: { flex: 1, minWidth: 0, minHeight: 30, borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 7, paddingHorizontal: 9, paddingVertical: 5, color: "var(--ink)" as string, backgroundColor: "var(--win)" as string, fontSize: 13 },
  inputArea: { minHeight: 96, textAlignVertical: "top" as const },
  checks: { gap: 4, marginTop: 4 },
  check: { flexDirection: "row", alignItems: "center", gap: 8 },
  checkText: { flex: 1, fontSize: 13, color: "var(--ink)" as string },
  checkWait: { color: "var(--ink-3)" as string },
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
  step: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 6, padding: 8, paddingRight: 14, maxWidth: 666, alignSelf: "stretch", alignItems: "flex-start", minWidth: 0, borderRadius: 12, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--raised)" as string },
  thumb: { width: 220, height: 138, flexShrink: 0, maxWidth: "46%" as unknown as number, borderRadius: 8, borderWidth: 1, borderColor: "var(--line-2)" as string, backgroundColor: "#fff" },
  tile: { width: 220, height: 138, flexShrink: 0, maxWidth: "46%" as unknown as number, borderRadius: 8, backgroundColor: "var(--sunk)" as string, alignItems: "center", justifyContent: "center" },
  tileText: { fontSize: 22, fontWeight: "600", color: "var(--ink-3)" as string },
  words: { flex: 1, minWidth: 0, gap: 2 },
  handle: { flexShrink: 1, fontSize: 12.5, color: "var(--ink-2)" as string, fontFamily: "var(--mono, ui-monospace, Menlo, monospace)" as string },
});
