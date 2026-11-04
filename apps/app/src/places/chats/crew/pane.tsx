// The Crew pane (owner, 4 Nov 2026, prototype p-crew). The overview: one sentence of totals, a Show menu, the helpers sorted needs you first, a token bar, the timeline of who ran when, "Ran together", Stop all and the
// keys. A row opens that helper's peek: its brief, what it is on, its answer, the notes between it and the agent that started it, cost and time, Ask it something, Open chat and Stop. All of it from engine.crew.status
// and the helper's own chat; nothing is estimated.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { accountName, modelName } from "../../../../../../lib/model-names.ts";
import { blockLine } from "../helper/model.ts";
import { HelperHooksSection } from "../helper/HelperHooks.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { HelperChip, MemberRing, timeOf, useNow } from "./strip.tsx";
import { clock, isCode, keyAction, testsWords, lineOf, modelTag, money, nameOf, ranTogether, roleOf, shows, sorted, span, stateWord, timeline, tokenSplit, tokens, totalsLine, faceSeed, middle, totalsParts, sortedBy } from "./model.ts";
import type { CrewMember, CrewStatusOut, Show, SortKey } from "./model.ts";
import type { Call } from "./status.ts";

const web = Platform.OS === "web";
const SHOW: Array<{ key: Show; label: string }> = [{ key: "all", label: "All" }, { key: "working", label: "Working" }, { key: "needs_you", label: "Needs you" }, { key: "done", label: "Done" }, { key: "failed", label: "Failed" }];
/** Blocks of a helper's chat that are bookkeeping, not steps a person reads. */
const NOT_STEPS = new Set(["helper_note", "turn_status", "tool_steps", "link_card", "question", "plan"]);
const NONE: Record<Show, string> = { all: "No helpers yet.", working: "No helper is working right now.", needs_you: "No helper needs you.", done: "No helper is done yet.", failed: "No helper failed." };
const BAR = { working: "var(--accent)", needs_you: "var(--warn)", done: "var(--accent)", failed: "var(--ink-4)", stopped: "var(--ink-4)" } as const;

function Face({ m, size = 34 }: { m: CrewMember; size?: number }): ReactElement {
  return <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}><MemberRing state={m.state} size={size} id={`crew-pane-${m.id}`} /><Avatar name={nameOf(m)} seedId={faceSeed(m)} kind="agent" size={Math.round(size * 0.74)} /></View>;
}

/** The Show menu: which helpers the list keeps. The one now showing is checked. */
export const showEntries = (current: Show, pick: (s: Show) => void): Array<{ label: string; checked: boolean; onSelect: () => void }> => SHOW.map((o) => ({ label: o.label, checked: o.key === current, onSelect: () => pick(o.key) }));

export function CrewOverview({ status, call, threadId, onPeek, onRefresh, initialShow = "all" }: { status: CrewStatusOut; call: Call; threadId: string; onPeek: (id: string) => void; onRefresh: () => void; initialShow?: Show }): ReactElement {
  const [show, setShow] = useState<Show>(initialShow);
  const menu = useMenu();
  const live = status.totals.working + status.totals.needsYou > 0;
  const now = useNow(live);
  const [sortKey, setSortKey] = useState<SortKey>("state");
  const all = sortedBy(status.members, sortKey);
  const rows = all.filter((m) => shows(m, show));
  const tl = timeline(all, now);
  const together = ranTogether(all);
  const split = tokenSplit(status.totals);
  const stopAll = (): void => { void Promise.resolve(call("engine.helpers.stop_all", { threadId })).then(onRefresh, () => undefined); };
  useEffect(() => {
    if (!web) return undefined;
    const on = (e: KeyboardEvent): void => {
      const a = keyAction(e, rows);
      if (!a) return;
      e.preventDefault();
      if (a.kind === "stop_all") { if (live) stopAll(); } else onPeek(a.id);
    };
    (globalThis as { addEventListener?: (t: string, f: (e: KeyboardEvent) => void) => void }).addEventListener?.("keydown", on);
    return () => (globalThis as { removeEventListener?: (t: string, f: (e: KeyboardEvent) => void) => void }).removeEventListener?.("keydown", on);
  });
  return (
    <View testID="crew-overview" style={st.page}>
      <Text accessibilityRole="header" style={st.title}>Crew</Text>
      <Text testID="crew-overview-totals" style={st.sub}>
        {/* ui-rows-lint: not a list (the totals are one sentence; each part is a word you press to sort) */}
        {totalsParts(status.totals).map((p, i) => (
          <Text key={p.key}>{i > 0 ? " · " : ""}<Text accessibilityRole="button" testID={`crew-sort-${p.key}`} onPress={() => setSortKey(p.key)} style={sortKey === p.key && p.key !== "state" ? st.sortOn : undefined}>{p.text}</Text></Text>
        ))}
      </Text>
      <View style={st.bar}>
        <Pressable accessibilityRole="button" testID="crew-show" onPress={(e) => { const r = (e as unknown as { nativeEvent?: { pageX?: number; pageY?: number } }).nativeEvent; menu.show(showEntries(show, setShow), r?.pageX ?? 0, r?.pageY ?? 0, "context", { label: "Show" }); }} style={st.quiet}><Text style={st.quietText}>{`Show: ${SHOW.find((o) => o.key === show)!.label} ▾`}</Text></Pressable>
        {live ? <Pressable accessibilityRole="button" testID="crew-stop-all" onPress={stopAll} style={st.quiet}><Text style={st.quietText}>Stop all</Text></Pressable> : null}
      </View>

      {rows.length === 0 ? <Text testID="crew-empty-show" style={st.hint}>{NONE[show]}</Text> : (
        <View testID="crew-rows" style={st.card}>
          {/* ui-rows-lint: not a list (the same helper rows as the strip in the chat: a face in a ring with a state, a name, a line and a clock) */}
          {rows.map((m, i) => <HelperChip key={m.id} m={m} now={now} index={i} last={i === rows.length - 1} onPress={() => onPeek(m.id)} />)}
        </View>
      )}

      <Text style={st.section}>Side by side</Text>
      <View testID="crew-timeline" style={{ gap: 3 }}>
        {all.map((m, i) => (
          <Row
            key={m.id} id={`crew-tl-${m.id}`} title={nameOf(m)} onPress={() => onPeek(m.id)} leading={<View style={{ marginRight: 8 }}><Avatar name={nameOf(m)} seedId={faceSeed(m)} kind="agent" size={18} /></View>}
            trailing={<View style={st.tlt}><View testID={`crew-tl-${m.id}-bar`} style={{ position: "absolute", top: 0, bottom: 0, left: `${(tl[i]?.left ?? 0) * 100}%`, width: `${(tl[i]?.width ?? 1) * 100}%`, borderRadius: 5, backgroundColor: BAR[m.state] as string, opacity: m.state === "failed" || m.state === "stopped" ? 0.5 : 1 } as object} /></View>}
          />
        ))}
      </View>
      {together ? <Text testID="crew-ran-together" style={st.together}>{together}</Text> : null}

      {status.totals.costMicros > 0 ? <View style={st.kv}><Text style={st.k}>Total cost</Text><Text testID="crew-cost" style={st.v}>{money(status.totals.costMicros)}</Text></View> : null}
      <View style={st.kv}><Text style={st.k}>Total time</Text><Text testID="crew-time" style={st.v}>{span(status.totals.elapsedMs)}</Text></View>
      {status.totals.tokensIn + status.totals.tokensOut > 0 ? (
        <View testID="crew-tokens" style={{ gap: 5, marginTop: 6 }}>
          <View style={st.tokbar}><View style={{ flex: split.input, backgroundColor: "var(--accent)" as string }} /><View style={{ flex: split.output, backgroundColor: "var(--ok)" as string }} /></View>
          <Text style={st.hint}>{tokens(status.totals.tokensIn)} in · {tokens(status.totals.tokensOut)} out</Text>
        </View>
      ) : null}
      {status.totals.filesChanged > 0 ? <View style={st.kv}><Text style={st.k}>Files changed</Text><Text testID="crew-files" style={st.v}>{status.totals.filesChanged} · <Text style={{ color: "var(--ok)" as string }}>+{status.totals.added}</Text> <Text style={{ color: "var(--danger)" as string }}>−{status.totals.deleted}</Text></Text></View> : null}
      <Text testID="crew-keys" style={st.keys}>⌘ . stops all · ⌥ 1 to ⌥ 9 jump to a helper</Text>
    </View>
  );
}

type Cat = { accounts: Array<{ ref: string; provider: string; label: string; models: Array<{ model: string; title?: string; tier?: string; available: boolean }> }> };

/** The choices for Change model: each account the person may use with the models it can run now, the one on the helper left out. */
export function modelChoices(cat: Cat, current?: string): Array<{ account: string; accountLabel: string; model: string; tier?: string }> {
  return cat.accounts.flatMap((a) => a.models.filter((m) => m.available && m.model !== current).map((m) => ({ account: a.ref, accountLabel: a.label, model: m.model, ...(m.tier ? { tier: m.tier } : {}) })));
}

/** The confirm line: what restarting costs, in what the helper has really used so far. */
export const restartWords = (name: string, model: string, spentMicros: number): string => `Restart ${name} on ${modelName(model)}? It has used ${money(spentMicros)} so far and starts over.`;

function ChangeModel({ member, call, onDone }: { member: CrewMember; call: Call; onDone: () => void }): ReactElement {
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState<Cat | null>(null);
  const [pick, setPick] = useState<{ account: string; accountLabel: string; model: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const show = (): void => { setOpen(true); void Promise.resolve(call("engine.helper_models", { threadId: member.parentThreadId, agentId: member.agentId })).then((r) => setCat(r as Cat), () => setErr("The models could not be read. Try again.")); };
  const go = (): void => {
    if (!pick) return;
    void Promise.resolve(call("engine.helpers.change_model", { threadId: member.parentThreadId, helperId: member.id, account: pick.account, model: pick.model })).then(() => { setOpen(false); setPick(null); onDone(); }, () => setErr("It could not restart on that model."));
  };
  if (!open) return <Pressable accessibilityRole="button" testID="crew-peek-change-model" onPress={show} style={st.pill}><Text style={st.pillText}>Change model</Text></Pressable>;
  const choices = cat ? modelChoices(cat, member.model) : [];
  return (
    <View testID="crew-change-model" style={{ gap: 6, marginTop: 8 }}>
      {pick ? (
        <>
          <Text testID="crew-change-confirm" style={st.rowLine}>{restartWords(nameOf(member), pick.model, member.costMicros)}</Text>
          <View style={st.actions}>
            <Pressable accessibilityRole="button" testID="crew-change-go" onPress={go} style={[st.pill, { backgroundColor: "var(--accent)" as string }]}><Text style={[st.pillText, { color: "var(--accent-ink)" as string }]}>Restart</Text></Pressable>
            <Pressable accessibilityRole="button" testID="crew-change-cancel" onPress={() => setPick(null)} style={st.pill}><Text style={st.pillText}>Cancel</Text></Pressable>
          </View>
        </>
      ) : cat === null ? <Text style={st.hint}>Reading the models…</Text> : choices.length === 0 ? <Text testID="crew-change-none" style={st.hint}>No other model is available right now.</Text> : choices.map((c) => <Row key={`${c.account}:${c.model}`} id={`crew-change-${c.model}`} title={modelName(c.model)} note={`${accountName(c.accountLabel)}${c.tier ? ` · ${c.tier}` : ""}`} onPress={() => setPick(c)} />)}
      {err ? <Text testID="crew-change-error" style={st.hint}>{err}</Text> : null}
    </View>
  );
}

type Note = { messageId: string; who: "brief" | "person" | "parent" | "helper"; authorId: string; body: string; kind?: string; state?: string; seenAt?: number; restart?: boolean };
const WHO = { brief: "Brief", person: "You", parent: "Agent", helper: "Helper" } as const;

export function CrewPeek({ member, call, nameOfId, onBack, onOpenChat, onRefresh }: { member: CrewMember; call: Call; nameOfId?: (id: string) => string; onBack: () => void; onOpenChat: (threadId: string) => void; onRefresh: () => void }): ReactElement {
  const [notes, setNotes] = useState<Note[]>([]);
  const [steps, setSteps] = useState<Array<{ id: string; title: string; sub: string; state?: string }>>([]);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const live = member.state === "working" || member.state === "needs_you";
  const now = useNow(live);
  useEffect(() => {
    let dead = false;
    const read = (): void => {
      void Promise.resolve(call("chat.helper.notes", { threadId: member.id })).then((r) => { if (!dead) setNotes((r as { notes: Note[] }).notes); }, () => undefined);
      // the steps it has taken, in plain words: the blocks of its own chat that are work, not notes
      void Promise.resolve(call("chat.messages.list", { threadId: member.id })).then((r) => {
        if (dead) return;
        const blocks = ((r as { messages?: Array<{ blocks: Array<{ id: string; type: string; data?: unknown; state?: string }> }> } | undefined)?.messages ?? []).flatMap((m) => m.blocks).filter((b) => !NOT_STEPS.has(b.type));
        setSteps(blocks.map((b) => { const l = blockLine(b as never); return { id: b.id, title: l.title, sub: l.sub, ...(b.state ? { state: b.state } : {}) }; }));
      }, () => undefined);
    };
    read();
    const t = live ? setInterval(read, 2500) : undefined;
    (t as { unref?: () => void } | undefined)?.unref?.();
    return () => { dead = true; if (t) clearInterval(t); };
  }, [call, member.id, member.state, live]);
  const brief = notes.find((n) => n.who === "brief");
  const log = notes.filter((n) => n.restart !== true && (n.who !== "brief" && n.kind !== undefined || n.who === "person"));
  const retry = (): void => {
    const instruction = brief?.body ?? "";
    if (instruction === "") { setErr("There is no brief to start again from."); return; }
    void Promise.resolve(call("chat.helper.start", { threadId: member.parentThreadId, title: member.title, instruction, idempotencyKey: `retry-${member.id}-${Date.now()}` })).then(onRefresh, () => setErr("It could not start again."));
  };
  const send = (): void => {
    const body = text.trim();
    if (body === "") return;
    setErr(null);
    void Promise.resolve(call("chat.helper.steer", { threadId: member.id, body, idempotencyKey: `steer-${member.id}-${Date.now()}` })).then(() => { setText(""); onRefresh(); }, () => setErr("It could not take that. Ask in its chat."));
  };
  return (
    <View testID="crew-peek" style={st.page}>
      <Pressable accessibilityRole="button" testID="crew-peek-back" onPress={onBack}><Text style={st.back}>‹ Crew</Text></Pressable>
      <View style={st.peekHead}>
        <Face m={member} size={48} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} testID="crew-peek-name" style={st.peekName}>{nameOf(member)}</Text>
          <Text testID="crew-peek-state" style={st.sub}>{stateWord(member.state)} · {timeOf(member, now)}</Text>
        </View>
      </View>
      {member.state === "needs_you" ? <View testID="crew-peek-needs" style={st.needs}><Text style={st.needsT}>Needs your OK</Text><Text style={st.rowLine}>{lineOf(member)}</Text></View> : null}
      {member.state === "failed" || member.state === "stopped" ? <Text testID="crew-peek-line" style={st.rowLine}>{lineOf(member)}</Text> : null}
      <Text style={st.section}>Brief from {brief ? (nameOfId?.(brief.authorId) ?? "the agent") : "the agent"}</Text>
      <View style={st.brief}><Text testID="crew-peek-brief" style={st.briefText}>{brief?.body ?? member.title}</Text></View>
      {steps.length > 0 || (member.state === "working" && member.step) ? <Text style={st.section}>Steps</Text> : null}
      {/* ui-rows-lint: not a list (what the helper has done, in order: a quiet log of plain-word steps, nothing to press) */}
      {steps.slice(-6).map((x) => <View key={x.id} testID={`crew-step-${x.id}`} style={st.step}><View style={[st.stepDot, x.state === "live" && { backgroundColor: "var(--accent)" as string }]} /><Text numberOfLines={1} style={st.rowLine}>{x.title}{x.sub ? ` · ${x.sub}` : ""}</Text></View>)}
      {member.state === "working" && member.step && !steps.some((x) => x.state === "live") ? <View style={st.step}><View style={[st.stepDot, { backgroundColor: "var(--accent)" as string }]} /><Text testID="crew-peek-step" numberOfLines={1} style={st.rowLine}>{member.step}</Text></View> : null}
      {member.model ? <><Text style={st.section}>Runs on</Text><Text testID="crew-peek-model" style={st.rowLine}>{modelTag(member)}{member.accountLabel ? ` · ${accountName(member.accountLabel)}` : ""}</Text></> : null}
      {live || member.state === "failed" || member.state === "stopped" ? <ChangeModel member={member} call={call} onDone={onRefresh} /> : null}
      <HelperHooksSection threadId={member.id} call={call} lead={brief ? (nameOfId?.(brief.authorId) ?? "the agent") : "the agent"} name={nameOf(member)} />
      {member.found ? <><Text style={st.section}>Answer</Text><Text testID="crew-peek-answer" style={st.rowLine}>{member.found}</Text></> : null}
      {isCode(member) ? <><Text style={st.section}>Code</Text><Text testID="crew-peek-code" style={st.mono}>{member.branch} · +{member.added ?? 0} −{member.deleted ?? 0} · {member.files?.length ?? 0} files{member.tests ? ` · ${testsWords(member.tests)}` : ""}</Text></> : null}
      {log.length > 0 ? <Text style={st.section}>Notes</Text> : null}
      {/* ui-rows-lint: not a list (a read-only log of what was said between the helper and the agent that started it, each entry a sender and words, nothing to press) */}
      {log.map((n) => <View key={n.messageId} testID={`crew-note-${n.messageId}`} style={st.note}><Text style={st.noteWho}>{WHO[n.who]}{n.who === "parent" && n.seenAt !== undefined ? " · seen" : ""}</Text><Text style={st.rowLine}>{n.body}</Text></View>)}
      <Text style={st.section}>Cost and time</Text>
      <View style={st.kv}><Text style={st.k}>Time</Text><Text testID="crew-peek-time" style={st.v}>{timeOf(member, now)}</Text></View>
      {member.costMicros > 0 ? <View style={st.kv}><Text style={st.k}>Cost</Text><Text testID="crew-peek-cost" style={st.v}>{money(member.costMicros)}</Text></View> : null}
      {member.tokensIn + member.tokensOut > 0 ? <View style={st.kv}><Text style={st.k}>Tokens</Text><Text testID="crew-peek-tokens" style={st.v}>{tokens(member.tokensIn)} in · {tokens(member.tokensOut)} out</Text></View> : null}
      <View style={st.actions}>
        <Pressable accessibilityRole="button" testID="crew-peek-open" onPress={() => onOpenChat(member.id)} style={st.pill}><Text style={st.pillText}>Open chat</Text></Pressable>
        {member.state === "failed" || member.state === "stopped" ? <Pressable accessibilityRole="button" testID="crew-peek-retry" onPress={retry} style={st.pill}><Text style={st.pillText}>Retry</Text></Pressable> : null}
        {live ? <Pressable accessibilityRole="button" testID="crew-peek-stop" onPress={() => { void Promise.resolve(call("engine.stop", { threadId: member.id })).then(onRefresh, () => undefined); }} style={st.pill}><Text style={st.pillText}>Stop</Text></Pressable> : null}
      </View>
      {live ? (
        <View style={st.ask}>
          <TextInput testID="crew-peek-ask" value={text} onChangeText={setText} onSubmitEditing={send} placeholder="Ask it something" placeholderTextColor="var(--ink-4)" style={st.input} />
          <Pressable accessibilityRole="button" accessibilityLabel="Send" testID="crew-peek-send" onPress={send} style={st.send}><Text style={st.sendT}>↑</Text></Pressable>
        </View>
      ) : null}
      {err ? <Text testID="crew-peek-error" style={st.hint}>{err}</Text> : null}
    </View>
  );
}

const st = StyleSheet.create({
  page: { paddingHorizontal: 14, paddingBottom: 18, gap: 4 },
  title: { fontSize: 17, fontWeight: "600", color: "var(--ink)" as string, paddingTop: 8 },
  sub: { fontSize: 13, color: "var(--ink-3)" as string },
  bar: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  label: { fontSize: 12.5, color: "var(--ink-3)" as string },
  pill: { height: 28, paddingHorizontal: 11, borderRadius: 9, justifyContent: "center", backgroundColor: "var(--hover)" as string },
  pillText: { fontSize: 12.5, color: "var(--ink)" as string },
  section: { fontSize: 12, color: "var(--ink-3)" as string, marginTop: 14, marginBottom: 2 },
  sortOn: { color: "var(--ink)" as string, fontWeight: "600" },
  quiet: { height: 28, paddingHorizontal: 8, borderRadius: 8, justifyContent: "center" },
  quietText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  card: { marginTop: 8, borderRadius: 14, overflow: "hidden", backgroundColor: "var(--raised)" as string, boxShadow: "inset 0 0 0 1px var(--line)" } as object,
  tlr: { flexDirection: "row", alignItems: "center", gap: 8, height: 28 },
  tln: { width: 52, fontSize: 13, color: "var(--ink-2)" as string },
  tlt: { width: 120, height: 9, borderRadius: 5, backgroundColor: "var(--hover)" as string, overflow: "hidden" },
  together: { marginTop: 8, padding: 10, borderRadius: 12, backgroundColor: "var(--accent-wash)" as string, fontSize: 13.5, color: "var(--ink)" as string },
  kv: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  k: { fontSize: 13.5, color: "var(--ink-2)" as string },
  v: { fontSize: 13.5, color: "var(--ink)" as string },
  tokbar: { flexDirection: "row", height: 7, borderRadius: 4, overflow: "hidden", backgroundColor: "var(--hover)" as string },
  hint: { fontSize: 12, color: "var(--ink-3)" as string },
  listHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7 },
  rowTitle: { fontSize: 13.5, color: "var(--ink)" as string },
  rowLine: { fontSize: 13, lineHeight: 18, color: "var(--ink-2)" as string },
  rowState: { fontSize: 12.5, color: "var(--ink-3)" as string },
  hidden: { display: "none" },
  keys: { marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: "var(--line)" as string, fontSize: 12, color: "var(--ink-3)" as string },
  back: { fontSize: 13, color: "var(--ink-3)" as string, paddingVertical: 6 },
  peekHead: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 6 },
  peekName: { fontSize: 18, fontWeight: "600", color: "var(--ink)" as string },
  needs: { padding: 12, borderRadius: 14, gap: 4, backgroundColor: "color-mix(in srgb, var(--warn) 12%, var(--raised))" as string },
  needsT: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  brief: { padding: 12, borderRadius: 12, borderLeftWidth: 3, borderLeftColor: "var(--accent)" as string, backgroundColor: "var(--accent-wash)" as string },
  briefText: { fontSize: 13.5, lineHeight: 20, color: "var(--ink)" as string },
  mono: { fontSize: 12, color: "var(--ink-2)" as string, fontFamily: "var(--mono)" as string },
  note: { paddingVertical: 6, gap: 1 },
  step: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 22 },
  stepDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "var(--ink-4)" as string },
  noteWho: { fontSize: 11.5, color: "var(--ink-3)" as string },
  actions: { flexDirection: "row", gap: 8, marginTop: 12 },
  ask: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  input: { flex: 1, height: 36, paddingHorizontal: 12, borderRadius: 18, fontSize: 13.5, color: "var(--ink)" as string, backgroundColor: "var(--field)" as string },
  send: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: "var(--accent)" as string },
  sendT: { fontSize: 16, color: "var(--accent-ink)" as string },
});
