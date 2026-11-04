// The Island: a pill that floats above the composer while anyone in the chat is working, and goes away when nobody is. It holds the Vyre mark (moving with the lead's real state), the live state word,
// a divider, and one face per working agent in the one state language of every face (a moving ring: working, an amber ring: waiting, a green dot: finished; the one writing now is lifted). A press on
// a face steers that agent; a press on the pill opens the list of everyone working with the background jobs and their Stop; a computer button opens Watch the computer while an agent uses its computer.
// Everything comes from the live turns and their activity frames, never invented. Reduced motion stops the rings and the mark.
// When an agent asks you something (ask_question), the pill turns into the question: the asker's face with an amber ring, the question, its choices as buttons (the recommended one filled, a number
// key picks one), Other for a few words of your own, and the people who can answer. "1 of 3" and arrows when several wait. Answering sends it and the pill goes back to Working. Escape puts the
// pill away and leaves the question in the chat: the question card is always there too, the Island is a shortcut and never the only place.
import { useEffect, useReducer, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { Tooltip } from "../../../../../../ui/src/Tooltip/index.tsx";
import { WorkingMark } from "../../../../../../ui/src/WorkingMark/index.tsx";
import type { ActivityStore, LiveTurn } from "../../../shell/session/turn-streams.ts";
import { turnRowId } from "../../../shell/session/turn-streams.ts";
import { elapsedWords } from "./activity.ts";
import { agentOf, capFaces, cardSeen, choiceForKey, hoverOf, islandOpen, pillChoices, wordOf } from "./island.ts";
import type { IslandAgent, IslandQuestion } from "./island.ts";
import { Glyph } from "./parts.tsx";

export interface IslandJob { threadId: string; title: string; startedAt: number }
export interface IslandProps {
  turns: readonly LiveTurn[];
  activityOf?: ((rowId: string) => ActivityStore | undefined) | undefined;
  nameOf(id: string): string;
  jobs: readonly IslandJob[];
  now(): number;
  onSteer(agentId: string): void;
  onStopJob(threadId: string): void;
  onOpenComputer(agentId: string): void;
  /** The questions agents wait on (island.ts questionsOf), oldest first. */
  questions?: readonly IslandQuestion[] | undefined;
  /** The names of the people who can answer here, for the people button. */
  people?: readonly string[] | undefined;
  /** Sends one answer: the choice's id, or the words typed in Other. A rejection puts the question back with a plain line. */
  onAnswer?(blockId: string, answer: string): Promise<unknown> | void;
}

type KeyLike = { key: string; target?: unknown; defaultPrevented?: boolean; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; preventDefault?: () => void };
type Doc = { addEventListener(t: string, f: (e: KeyLike) => void): void; removeEventListener(t: string, f: (e: KeyLike) => void): void; querySelector(q: string): { focus?: () => void } | null };
const doc = (): Doc | undefined => (globalThis as { document?: Doc }).document;
/** A key typed in the composer or any field is that field's: the number keys and the arrows are the Island's only when nothing is being typed in. */
const typing = (t: unknown): boolean => {
  const e = t as { tagName?: string; isContentEditable?: boolean; closest?: (q: string) => unknown } | null | undefined;
  if (!e) return false;
  const tag = (e.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.isContentEditable === true || (typeof e.closest === "function" && !!e.closest('[contenteditable="true"],[data-testid="composer-field"]'));
};
type El = { getBoundingClientRect(): { top: number; bottom: number } };
type Finder = { querySelector(q: string): El | null };
/** The ids of the question cards now on screen in the chat feed: read from the page now and again on every scroll and each half second (a card is drawn by the chat, not by the Island). */
function useSeenCards(ids: readonly string[]): ReadonlySet<string> {
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set());
  const key = ids.join("|");
  useEffect(() => {
    const d = (globalThis as { document?: Finder & Doc }).document;
    if (!d || ids.length === 0) { setSeen((s) => (s.size === 0 ? s : new Set())); return undefined; }
    const read = (): void => {
      const feed = d.querySelector('[data-testid="conversation-feed"]');
      const now = new Set(ids.filter((id) => cardSeen(d.querySelector(`[data-testid="blk-question-${id}"]`)?.getBoundingClientRect(), feed?.getBoundingClientRect())));
      setSeen((cur) => (cur.size === now.size && [...now].every((x) => cur.has(x)) ? cur : now));
    };
    read();
    const t = setInterval(read, 500);
    (d as unknown as { addEventListener(t: string, f: () => void, c?: boolean): void }).addEventListener("scroll", read, true);
    return () => { clearInterval(t); (d as unknown as { removeEventListener(t: string, f: () => void, c?: boolean): void }).removeEventListener("scroll", read, true); };
  }, [key]);  // eslint-disable-line react-hooks/exhaustive-deps
  return seen;
}
const focusComposer = (): void => { doc()?.querySelector('[data-testid="composer-field"]')?.focus?.(); };

/** The agents behind the live turns, one row each (an agent's newest turn), read from the stores now. A re-render comes with any store's change. */
function useAgents(p: IslandProps): IslandAgent[] {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const offs: Array<() => void> = [];
    for (const t of p.turns) {
      offs.push(t.store.subscribe(bump));
      const a = p.activityOf?.(turnRowId(t.turnId));
      if (a) offs.push(a.subscribe(bump));
    }
    return () => { for (const o of offs) o(); };
  }, [p.turns, p.activityOf]);
  const now = p.now();
  const byAgent = new Map<string, IslandAgent>();
  for (const t of p.turns) {
    const act = p.activityOf?.(turnRowId(t.turnId))?.get();
    byAgent.set(t.agentId, agentOf(t, act, t.store.getSnapshot().blocks.length > 0, p.nameOf(t.agentId), now));
  }
  return [...byAgent.values()];
}

const faceState = (a: IslandAgent): "working" | "waiting" | "done" => a.ring;

export function Island(p: IslandProps): ReactElement | null {
  const agents = useAgents(p);
  const [open, setOpen] = useState(false);
  const width = useWindowDimensions().width;
  const phone = width > 0 && width < 640;
  // the questions on offer: not the ones just answered, not the ones put away with Escape (they stay in the chat), and the one shown is the one the arrows are on
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [away, setAway] = useState<ReadonlySet<string>>(new Set());
  const [at, setAt] = useState(0);
  const [other, setOther] = useState(false);
  const [words, setWords] = useState("");
  const [people, setPeople] = useState(false);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const seen = useSeenCards((p.questions ?? []).map((x) => x.blockId));
  // a question whose card is on screen is answered there; the pill carries it once the card has scrolled away (the Island is a shortcut, never the only place)
  const asked = (p.questions ?? []).filter((x) => !gone.has(x.blockId) && !away.has(x.blockId) && !seen.has(x.blockId));
  const q: IslandQuestion | undefined = asked[Math.min(at, Math.max(0, asked.length - 1))];
  const send = (answer: string): void => {
    if (!q || busy || answer.trim() === "") return;
    setBusy(true); setProblem("");
    const id = q.blockId;
    void Promise.resolve(p.onAnswer?.(id, answer)).then(
      () => { setGone((g) => new Set(g).add(id)); setOther(false); setWords(""); setPeople(false); setBusy(false); },
      () => { setBusy(false); setProblem("Could not send the answer. Try again."); },
    );
  };
  const putAway = (): void => { if (!q) return; const id = q.blockId; setAway((a) => new Set(a).add(id)); setOther(false); setWords(""); setPeople(false); setProblem(""); focusComposer(); };
  const keys = useRef({ q, other, send, putAway, asked: asked.length });
  keys.current = { q, other, send, putAway, asked: asked.length };
  useEffect(() => {
    const d = doc();
    if (!d) return undefined;
    const on = (e: KeyLike): void => {
      const k = keys.current;
      if (!k.q || e.defaultPrevented) return;
      if (e.key === "Escape") { if (k.other) { setOther(false); setWords(""); } else k.putAway(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      const shown = pillChoices(k.q).choices;
      const i = choiceForKey(e.key, shown.length);
      if (i !== null) { e.preventDefault?.(); k.send(shown[i]!.id); return; }
      if (k.asked > 1 && e.key === "ArrowRight") setAt((n) => (n + 1) % k.asked);
      if (k.asked > 1 && e.key === "ArrowLeft") setAt((n) => (n + k.asked - 1) % k.asked);
    };
    d.addEventListener("keydown", on);
    return () => d.removeEventListener("keydown", on);
  }, []);
  if (q) {
    const many = asked.length > 1;
    const here = Math.min(at, asked.length - 1);
    const pill = pillChoices(q);
    return (
      <View testID="island" accessibilityLiveRegion="polite" style={[st.wrap, phone && st.wrapPhone]}>
        {people ? (
          <View testID="island-people" style={st.list}>
            <Text style={st.group}>Anyone here can answer</Text>
            {(p.people ?? []).map((n) => <Text key={n} style={[st.name, { paddingHorizontal: 8, paddingVertical: 5 }]}>{n}</Text>)}
          </View>
        ) : null}
        <View testID="island-question" accessibilityRole="alert" style={[st.qpill, phone && st.qpillPhone]}>
          <View style={st.qhead}>
            <View testID="island-asker" accessible accessibilityLabel={`${q.name} is waiting for your answer`}><Avatar name={q.name} seedId={q.agentId} kind="agent" size={24} state="waiting" /></View>
            <Text testID="island-question-text" numberOfLines={phone ? 3 : 2} style={st.qtext}>{q.prompt}</Text>
            {many ? (
              <View style={st.count}>
                <Pressable accessibilityRole="button" accessibilityLabel="Previous question" testID="island-prev" onPress={() => setAt((n) => (n + asked.length - 1) % asked.length)} style={st.arrow}><Text style={st.arrowText}>{"‹"}</Text></Pressable>
                <Text testID="island-count" style={st.countText}>{`${here + 1} of ${asked.length}`}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Next question" testID="island-next" onPress={() => setAt((n) => (n + 1) % asked.length)} style={st.arrow}><Text style={st.arrowText}>{"›"}</Text></Pressable>
              </View>
            ) : null}
          </View>
          <View testID="island-choices" accessibilityRole="radiogroup" style={st.choices}>
            {pill.choices.map((c, i) => (
              <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={`${c.label}${c.detail ? `. ${c.detail}` : ""}. Key ${i + 1}`} testID={`island-choice-${c.id}`} disabled={busy} onPress={() => send(c.id)} style={[st.choice, c.recommended && st.choiceMain]}>
                <Text style={[st.choiceText, c.recommended && st.choiceMainText]}>{c.label}</Text>
              </Pressable>
            ))}
            {pill.other && pill.choices.length > 0 ? (
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: other }} testID="island-other" onPress={() => setOther((o) => !o)} style={st.choice}><Text style={st.choiceText}>Other</Text></Pressable>
            ) : null}
            <Pressable accessibilityRole="button" accessibilityLabel="Who can answer" testID="island-people-button" onPress={() => setPeople((v) => !v)} style={st.peopleBtn}><Glyph name="people" size={15} color="var(--ink-3)" /></Pressable>
          </View>
          {other || pill.choices.length === 0 ? (
            <View style={st.otherRow}>
              <TextInput testID="island-other-field" autoFocus={other} accessibilityLabel="Your answer" placeholder="Your answer" value={words} onChangeText={setWords} onSubmitEditing={() => send(words)} editable={!busy} style={st.field} />
              <Pressable accessibilityRole="button" testID="island-other-send" disabled={busy || words.trim() === ""} onPress={() => send(words)} style={[st.choice, st.choiceMain, (busy || words.trim() === "") && { opacity: 0.5 }]}><Text style={st.choiceMainText}>Send</Text></Pressable>
            </View>
          ) : null}
          {problem !== "" ? <Text testID="island-problem" accessibilityRole="alert" style={st.problem}>{problem}</Text> : null}
        </View>
      </View>
    );
  }
  if (!islandOpen(agents, p.jobs.length)) return null;
  const word = wordOf(agents) || (p.jobs.length > 0 ? `${p.jobs.length} in the background` : "");
  const { shown, more } = capFaces(agents, phone ? 3 : 8);
  const lead = agents.find((a) => a.writing) ?? agents.find((a) => a.ring !== "done");
  const computerAgent = agents.find((a) => a.computer);
  const now = p.now();
  return (
    <View testID="island" accessibilityLiveRegion="polite" style={st.wrap}>
      {open ? (
        <View testID="island-list" style={st.list}>
          {agents.map((a) => (
            <Pressable key={a.agentId} accessibilityRole="button" accessibilityLabel={`Steer ${a.name}`} testID={`island-row-${a.agentId}`} onPress={() => { p.onSteer(a.agentId); setOpen(false); }} style={st.row}>
              <Avatar name={a.name} seedId={a.agentId} kind="agent" size={24} state={faceState(a)} />
              <Text style={st.name}>{a.name}</Text>
              <Text numberOfLines={1} style={st.what}>{a.line}</Text>
              <Text style={st.time}>{a.ring === "done" ? "" : elapsedWords(a.seconds)}</Text>
            </Pressable>
          ))}
          {p.jobs.length > 0 ? <Text style={st.group}>In the background</Text> : null}
          {p.jobs.map((j) => (
            <View key={j.threadId} testID={`island-job-${j.threadId}`} style={st.row}>
              <WorkingMark state="thinking" size={20} />
              <Text numberOfLines={1} style={[st.name, { flex: 1 }]}>{j.title}</Text>
              <Text style={st.time}>{elapsedWords(Math.max(0, Math.round((now - j.startedAt) / 1000)))}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={`Stop ${j.title}`} testID={`island-stop-${j.threadId}`} onPress={() => p.onStopJob(j.threadId)} style={st.stop}><Text style={st.stopText}>Stop</Text></Pressable>
            </View>
          ))}
        </View>
      ) : null}
      <View testID="island-pill" style={st.pill}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel="Everyone working" testID="island-toggle" onPress={() => setOpen((o) => !o)} style={st.lead}>
          <WorkingMark state={lead?.writing ? "writing" : "thinking"} step={lead?.line ?? ""} size={20} testID="island-mark" />
          <Text testID="island-word" style={st.word}>{word}</Text>
        </Pressable>
        {agents.length > 0 ? <View style={st.sep} /> : null}
        {shown.map((a) => (
          <Tooltip key={a.agentId} text={hoverOf(a)}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${hoverOf(a)}. Steer ${a.name}`} testID={`island-face-${a.agentId}`} onPress={() => p.onSteer(a.agentId)} style={[st.face, a.writing && st.faceLifted]}>
              <Avatar name={a.name} seedId={a.agentId} kind="agent" size={22} state={faceState(a)} />
            </Pressable>
          </Tooltip>
        ))}
        {more > 0 ? <Text testID="island-more" style={st.more}>{`+${more}`}</Text> : null}
        {computerAgent ? (
          <Tooltip text="Watch the computer">
            <Pressable accessibilityRole="button" accessibilityLabel="Watch the computer" testID="island-computer" onPress={() => p.onOpenComputer(computerAgent.agentId)} style={st.comp}><Text style={st.compText}>Watch</Text></Pressable>
          </Tooltip>
        ) : null}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { alignItems: "center", paddingBottom: 8, gap: 6 },
  wrapPhone: { width: "100%" },
  qpill: { gap: 8, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 20, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--warn)" as string, maxWidth: "94%" },
  qpillPhone: { width: "100%", maxWidth: "100%" },
  qhead: { flexDirection: "row", alignItems: "center", gap: 10 },
  qtext: { flexShrink: 1, color: "var(--ink)" as string, fontSize: 14 },
  count: { flexDirection: "row", alignItems: "center", gap: 2, marginLeft: "auto" },
  countText: { color: "var(--warn)" as string, fontSize: 12, fontWeight: "600" },
  arrow: { width: 24, height: 24, alignItems: "center", justifyContent: "center", borderRadius: 12 },
  arrowText: { color: "var(--ink-2)" as string, fontSize: 16 },
  choices: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  choice: { minHeight: 32, paddingHorizontal: 12, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "var(--sunk)" as string },
  choiceMain: { backgroundColor: "var(--accent)" as string },
  choiceText: { color: "var(--ink)" as string, fontSize: 13 },
  choiceMainText: { color: "var(--accent-ink)" as string, fontSize: 13 },
  peopleBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  otherRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  field: { flex: 1, minWidth: 0, height: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: "var(--sunk)" as string, color: "var(--ink)" as string, fontSize: 13 },
  problem: { color: "var(--warn)" as string, fontSize: 12.5 },
  pill: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 18, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line)" as string, maxWidth: "94%" },
  lead: { flexDirection: "row", alignItems: "center", gap: 8 },
  word: { color: "var(--ink-2)" as string, fontSize: 13 },
  sep: { width: 1, height: 16, backgroundColor: "var(--line)" as string },
  face: { padding: 3, borderRadius: 9 },
  faceLifted: { backgroundColor: "var(--accent-wash)" as string },
  more: { color: "var(--ink-3)" as string, fontSize: 12 },
  comp: { height: 24, paddingHorizontal: 8, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: "var(--sunk)" as string },
  compText: { color: "var(--ink-2)" as string, fontSize: 12 },
  list: { width: "100%", maxWidth: 420, padding: 6, borderRadius: 14, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line)" as string },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 34, paddingHorizontal: 8 },
  name: { color: "var(--ink)" as string, fontSize: 13 },
  what: { flex: 1, color: "var(--ink-3)" as string, fontSize: 12.5 },
  time: { color: "var(--ink-4)" as string, fontSize: 12, minWidth: 40, textAlign: "right", fontVariant: ["tabular-nums"] },
  group: { color: "var(--ink-4)" as string, fontSize: 11.5, paddingHorizontal: 8, paddingTop: 8 },
  stop: { height: 24, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: "var(--line)" as string, alignItems: "center", justifyContent: "center" },
  stopText: { color: "var(--ink-2)" as string, fontSize: 12 },
});
