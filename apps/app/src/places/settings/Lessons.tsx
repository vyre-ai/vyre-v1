// Settings > Memory and privacy > Lessons from your corrections (owner approval 3 Nov 2026). When you edit an agent's draft, say no, undo or decline what it did, or ask for it another way, the agent keeps
// a short lesson and does better next time. This page lists every lesson every agent kept for you in this Space: how it was caught, which agent, when, how often an answer used it, and who may read
// it. Edit changes the words (the old wording is kept in history), Forget takes it away (Undo brings it back). The switch at the top decides whether any are kept at all; off, nothing is learned.
// A lesson is private to you: it never reaches a chat other people read, and sharing one with the Space goes through Proposed in the agent's own Knows tab.
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useMenu } from "../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../ui/src/Menu/index.tsx";
import { Icon, pointOf } from "../files/memory/parts.tsx";
import { useSettingsData } from "./data.tsx";
import { useSaved } from "./saved.tsx";
import { Section, SettingsRow, Switch, pointer, s as ui } from "./ui.tsx";
import type { KeyEventLike } from "./ui.tsx";

export type LessonHow = "edit" | "refuse" | "reverse" | "rewrite";
export interface LessonRowOut {
  factId: string; text: string; agentId?: string; sourceKind: string; sourceRef: string; sourceLink?: string; learnedAt: number;
  lesson?: { how?: LessonHow; used: number; scope: "you" | "proposed" | "space" };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayOf = (t: number): string => { const d = new Date(t); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
export const HOW: Readonly<Record<LessonHow, string>> = { edit: "You edited a draft", refuse: "You said no", reverse: "You undid an action", rewrite: "You rewrote an answer" };
export const SCOPE: Readonly<Record<"you" | "proposed" | "space", string>> = { you: "Only you", proposed: "Proposed to the Space", space: "Shared with the Space" };

/** The line under a lesson: how it was caught, which agent, when, how often it was used, who may read it. */
export function lessonSub(f: LessonRowOut, name: (id: string) => string): string {
  const info = f.lesson;
  const parts = [info?.how ? HOW[info.how] : "From a correction", ...(f.agentId ? [name(f.agentId)] : []), dayOf(f.learnedAt)];
  if (info) parts.push(`used ${info.used} ${info.used === 1 ? "time" : "times"}`, SCOPE[info.scope]);
  return parts.join(" · ");
}

export const LESSONS_HELP = "When you edit a draft, say no, undo an action or rewrite an answer, the agent keeps a short lesson and uses it next time.";
export const LESSONS_FOOT = "A lesson from a private chat stays private to you. Sharing one with the Space puts it in Proposed first, so someone accepts it. Corrections you make in a shared chat never carry your private facts.";

/** The switch "Learn from my corrections": a person setting, on unless turned off. */
function useSwitch(): [boolean, (on: boolean) => void] {
  const data = useSettingsData();
  const saved = useSaved();
  const [on, setOn] = useState(true);
  useEffect(() => {
    let live = true;
    void (data.call("settings.get", { key: "memory.lessons" }) as Promise<{ row?: { value?: unknown } }>).then((r) => { if (live) setOn(r.row?.value !== false); }, () => undefined);
    return () => { live = false; };
  }, [data]);
  const set = (next: boolean): void => {
    const before = on;
    setOn(next);
    void data.call("settings.set", { key: "memory.lessons", value: next }).then(
      () => saved.saved(next ? "Agents keep lessons from your corrections." : "Agents stop keeping lessons.", () => data.call("settings.set", { key: "memory.lessons", value: before }).then(() => setOn(before))),
      (e: unknown) => { setOn(before); saved.failed(e instanceof Error ? e.message : "That did not save."); },
    );
  };
  return [on, set];
}

export function LessonsSection(): ReactElement {
  const data = useSettingsData();
  const saved = useSaved();
  const menu = useMenu();
  const [on, setSwitch] = useSwitch();
  const [rows, setRows] = useState<LessonRowOut[] | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const load = useCallback(async (): Promise<void> => {
    try { setRows(((await data.call("memory.facts.list", { kind: "lesson", layer: "person", status: ["current"] })) as { facts: LessonRowOut[] }).facts); } catch { setRows([]); }
  }, [data]);
  useEffect(() => { void load(); }, [load]);

  const save = (f: LessonRowOut): void => {
    const text = draft.trim();
    setEdit(null);
    if (text === "" || text === f.text) return;
    void (async () => {
      try {
        const r = (await data.call("memory.fact.correct", { factId: f.factId, text })) as { fact: { factId: string } };
        saved.saved("Saved. The old wording is kept in history.", async () => { await data.call("memory.fact.correct", { factId: r.fact.factId, text: f.text }); await load(); });
      } catch (e) { saved.failed(e instanceof Error ? e.message : "That did not save."); }
      await load();
    })();
  };
  const forget = (f: LessonRowOut): void => {
    void (async () => {
      try {
        await data.call("memory.forget", { factIds: [f.factId] });
        saved.saved("Forgotten. The agent stops using it.", async () => { await data.call("memory.restore", { factId: f.factId }); await load(); });
      } catch (e) { saved.failed(e instanceof Error ? e.message : "That did not save."); }
      await load();
    })();
  };
  const source = (f: LessonRowOut): string | null => f.sourceLink ?? null;
  const entries = (f: LessonRowOut): MenuEntry[] => [
    { label: "Edit", onSelect: () => { setEdit(f.factId); setDraft(f.text); } },
    ...(source(f) && data.nav.openLink ? [{ label: "Open where it came from", onSelect: () => data.nav.openLink?.(source(f)!) } as MenuEntry] : []),
    { separator: true },
    { label: "Forget", danger: true, onSelect: () => forget(f) },
  ];
  const editKey = (f: LessonRowOut) => (e: KeyEventLike & { nativeEvent?: { key?: string } }): void => {
    const key = e.nativeEvent?.key ?? e.key;
    if (key === "Enter") { e.preventDefault?.(); save(f); }
    if (key === "Escape") { e.preventDefault?.(); setEdit(null); }
  };

  const row = (f: LessonRowOut, first: boolean): ReactElement => {
    if (edit === f.factId) {
      return (
        <View key={f.factId} style={[st.editWrap, !first && ui.rowLine]}>
          <TextInput autoFocus value={draft} onChangeText={setDraft} onKeyPress={editKey(f) as never} onBlur={() => setEdit(null)} accessibilityLabel="Edit this lesson" testID={`lesson-edit-${f.factId}`} style={st.input} multiline={false} />
          <Text style={st.hint}>Enter saves. Escape cancels.</Text>
        </View>
      );
    }
    const more = (
      <Pressable
        accessibilityRole="button" accessibilityLabel="More for this lesson" {...({ "aria-haspopup": "menu" } as object)} testID={`lesson-more-${f.factId}`}
        onPress={(e) => { const p = pointOf(e); menu.show(entries(f), p.x, p.y, "other"); }} style={[st.more, pointer]}
      >
        <Icon name="more" size={14} color="var(--ink-3)" />
      </Pressable>
    );
    return <SettingsRow key={f.factId} id={`lesson.${f.factId}`} label={f.text} sub={lessonSub(f, data.name)} first={first} control={more} inline {...(source(f) && data.nav.openLink ? { onPress: () => data.nav.openLink?.(source(f)!) } : {})} />;
  };

  return (
    <View testID="lessons" {...({ dataSet: { sid: "memory.lessons" } } as object)}>
      <Section title="Lessons from your corrections" help={LESSONS_HELP}>
        <SettingsRow
          id="memory.lessons.switch" label="Learn from my corrections" first
          sub={on ? "Agents note what you change and say, and show a Learned line you can undo." : "Off. Agents do not keep lessons from what you change."}
          control={<Switch on={on} onChange={setSwitch} label="Learn from my corrections" testID="lessons-switch" />}
        />
      </Section>
      {on ? (
        <View style={ui.card}>
          {rows === null ? null : rows.length === 0 ? <Text style={st.empty} testID="lessons-empty">No lessons yet. They appear here the first time you correct an agent.</Text> : rows.map((f, i) => row(f, i === 0))}
        </View>
      ) : null}
      {on ? <Text style={st.foot}>{LESSONS_FOOT}</Text> : null}
      {menu.element}
    </View>
  );
}

const st = StyleSheet.create({
  empty: { fontSize: 12.5, color: "var(--ink-3)" as string, paddingHorizontal: 14, paddingVertical: 12 },
  more: { width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  editWrap: { paddingHorizontal: 12, paddingVertical: 8, gap: 4 },
  input: { fontSize: 13.5, color: "var(--ink)" as string, borderWidth: 1, borderColor: "var(--accent)" as string, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 6 },
  hint: { fontSize: 11.5, color: "var(--ink-3)" as string },
  foot: { fontSize: 12, lineHeight: 17, color: "var(--ink-3)" as string, paddingHorizontal: 2, paddingTop: 8 },
});
