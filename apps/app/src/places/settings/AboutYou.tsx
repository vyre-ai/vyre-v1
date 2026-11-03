// Settings > Memory and privacy (owner ruling 3 Nov). About you: what every agent that works for you knows about you in this Space, in two parts. Public is what your teammates' chats may use;
// Private stays in your own chats with your agents. Each fact says where it came from (a press opens the chat line), and can be edited in place (Enter saves, Escape cancels), moved to the
// other part, forgotten (Undo brings it back; history keeps it) or erased completely after a confirm in the row, which removes it and every earlier version and cannot be undone.
// An agent's suggestion to make a fact public waits here for a yes. Under it, Who pays for memory.
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useMenu } from "../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../ui/src/Menu/index.tsx";
import { Icon, pointOf } from "../files/memory/parts.tsx";
import { useSettingsData } from "./data.tsx";
import { LessonsSection } from "./Lessons.tsx";
import { MemoryKeys } from "./MemoryKeys.tsx";
import { useSaved } from "./saved.tsx";
import { SettingsRow, SmallButton, pointer, s as ui } from "./ui.tsx";
import type { KeyEventLike } from "./ui.tsx";

export type Place = "public" | "private";
export interface ProfileFact {
  factId: string; text: string; place: Place; suggested?: boolean; agentId?: string; sourceKind: string; sourceRef: string; sourceLink?: string; lineLink?: string; learnedAt: number;
}
export interface ProfileOut { audience: "private" | "shared"; basics: Array<{ key: string; label: string; value: string }>; public: ProfileFact[]; private: ProfileFact[] }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayOf = (t: number): string => { const d = new Date(t); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };

/** Where a fact came from, in words: who learned it and when. */
export function sourceText(f: ProfileFact, name: (id: string) => string): string {
  const from = f.sourceKind === "manual" ? "You added this" : f.agentId ? `Learned by ${name(f.agentId)}` : f.sourceKind === "channel" ? "From a channel" : "From a chat";
  return `${from}, ${dayOf(f.learnedAt)}`;
}

export const PART_COPY: Readonly<Record<Place, { title: string; sub: string; empty: string; add: string }>> = {
  public: { title: "Public", sub: "Teammates' chats can use this.", empty: "Nothing public yet. Move a fact here, or add one.", add: "Add something teammates can know" },
  private: { title: "Private", sub: "Only your own chats.", empty: "Nothing private yet.", add: "Add something only your agents should know" },
};

/** The page. Cmd-F lands on About you or Who pays for memory by their row ids (memory.about, memory.keys). */
export function MemoryPage(_props: { found?: string | null }): ReactElement {
  return (
    <>
      <AboutYou />
      <LessonsSection />
      <MemoryKeys />
    </>
  );
}

export function AboutYou(): ReactElement {
  const data = useSettingsData();
  const saved = useSaved();
  const menu = useMenu();
  const [out, setOut] = useState<ProfileOut | null>(() => (data.peek?.("memory.profile.get", {}) as ProfileOut | undefined) ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [erasing, setErasing] = useState<string | null>(null);
  const [adding, setAdding] = useState<Record<Place, string>>({ public: "", private: "" });

  const load = useCallback(async (): Promise<void> => {
    try { setOut((await data.call("memory.profile.get", {})) as ProfileOut); setErr(null); } catch (e) { setErr(e instanceof Error ? e.message : "Your profile could not be read."); }
  }, [data]);
  useEffect(() => { void load(); }, [load]);

  const act = async (cap: string, input: unknown, said: string, undo?: () => Promise<unknown>): Promise<void> => {
    try {
      await data.call(cap, input);
      saved.saved(said, undo ? async () => { await undo(); await load(); } : undefined);
    } catch (e) { saved.failed(e instanceof Error ? e.message : "That did not save."); }
    await load();
  };
  const move = (f: ProfileFact, to: Place): void => {
    void act("memory.profile.move", { factId: f.factId, to }, to === "public" ? "Added to your public profile." : "Moved to your private profile.", () => data.call("memory.profile.move", { factId: f.factId, to: f.place }));
  };
  const keepPrivate = (f: ProfileFact): void => { void act("memory.profile.move", { factId: f.factId, to: "private" }, "Kept private."); };
  const forget = (f: ProfileFact): void => {
    void act("memory.forget", { factIds: [f.factId] }, "Forgotten. History keeps it.", () => data.call("memory.restore", { factId: f.factId }));
  };
  const eraseNow = (f: ProfileFact): void => { setErasing(null); void act("memory.erase", { factIds: [f.factId], reason: "erased from About you" }, "Erased completely."); };
  const startEdit = (f: ProfileFact): void => { setEdit(f.factId); setDraft(f.text); setErasing(null); };
  const save = (f: ProfileFact): void => {
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
  const add = (to: Place): void => {
    const text = adding[to].trim();
    if (text === "") return;
    setAdding((a) => ({ ...a, [to]: "" }));
    void act("memory.profile.add", { text, to }, to === "public" ? "Added to your public profile." : "Added to your private profile.");
  };
  const source = (f: ProfileFact): string | null => f.lineLink ?? f.sourceLink ?? null;
  const openSource = (f: ProfileFact): void => { const l = source(f); if (l && data.nav.openLink) data.nav.openLink(l); };

  const entries = (f: ProfileFact): MenuEntry[] => [
    { label: "Edit", onSelect: () => startEdit(f) },
    f.place === "public" ? { label: "Move to private", onSelect: () => move(f, "private") } : { label: "Move to public", onSelect: () => move(f, "public") },
    ...(source(f) && data.nav.openLink ? [{ label: "Open where it came from", onSelect: () => openSource(f) } as MenuEntry] : []),
    { separator: true },
    { label: "Forget", onSelect: () => forget(f) },
    { label: "Erase completely", danger: true, onSelect: () => { setEdit(null); setErasing(f.factId); } },
  ];

  const editKey = (f: ProfileFact) => (e: KeyEventLike & { nativeEvent?: { key?: string } }): void => {
    const key = e.nativeEvent?.key ?? e.key;
    if (key === "Enter") { e.preventDefault?.(); save(f); }
    if (key === "Escape") { e.preventDefault?.(); setEdit(null); }
  };
  const addKey = (to: Place) => (e: KeyEventLike & { nativeEvent?: { key?: string } }): void => {
    const key = e.nativeEvent?.key ?? e.key;
    if (key === "Enter") { e.preventDefault?.(); add(to); }
    if (key === "Escape") setAdding((a) => ({ ...a, [to]: "" }));
  };

  const factRow = (f: ProfileFact, first: boolean): ReactElement => {
    if (edit === f.factId) {
      return (
        <View key={f.factId} style={[st.editWrap, !first && ui.rowLine]}>
          <TextInput
            autoFocus value={draft} onChangeText={setDraft} onKeyPress={editKey(f) as never} onBlur={() => setEdit(null)} accessibilityLabel="Edit this fact" testID={`about-edit-${f.factId}`}
            style={st.input} multiline={false}
          />
          <Text style={st.hint}>Enter saves. Escape cancels.</Text>
        </View>
      );
    }
    const more = (
      <Pressable
        accessibilityRole="button" accessibilityLabel="More for this fact" {...({ "aria-haspopup": "menu" } as object)} testID={`about-more-${f.factId}`}
        onPress={(e) => { const p = pointOf(e); menu.show(entries(f), p.x, p.y, "other"); }} style={[st.more, pointer]}
      >
        <Icon name="more" size={14} color="var(--ink-3)" />
      </Pressable>
    );
    const control = f.suggested && f.place === "private" ? (
      <View style={st.pair}>
        <SmallButton label="Add to public" primary testID={`about-accept-${f.factId}`} onPress={() => move(f, "public")} />
        <SmallButton label="Keep private" testID={`about-keep-${f.factId}`} onPress={() => keepPrivate(f)} />
        {more}
      </View>
    ) : more;
    return (
      <View key={f.factId}>
        <SettingsRow
          id={`about.${f.factId}`} label={f.text} sub={f.suggested && f.place === "private" ? `An agent asks: add to your public profile? ${sourceText(f, data.name)}` : sourceText(f, data.name)} first={first}
          control={control} inline={!(f.suggested && f.place === "private")} {...(source(f) && data.nav.openLink ? { onPress: () => openSource(f) } : {})}
        />
        {erasing === f.factId ? (
          <View style={st.confirm} testID={`about-erase-confirm-${f.factId}`} accessibilityRole="alert">
            <Text style={st.confirmText}>Erase this completely? It is removed from history with every earlier version and every place an agent used it. This can't be undone.</Text>
            <View style={st.pair}>
              <SmallButton label="Erase completely" danger testID={`about-erase-${f.factId}`} onPress={() => eraseNow(f)} />
              <SmallButton label="Cancel" testID={`about-erase-cancel-${f.factId}`} onPress={() => setErasing(null)} />
            </View>
          </View>
        ) : null}
      </View>
    );
  };

  const part = (place: Place): ReactElement => {
    const copy = PART_COPY[place];
    const facts = out ? out[place] : [];
    const basics = place === "public" && out ? out.basics : [];
    const rows: ReactElement[] = [];
    basics.forEach((b, i) => rows.push(<SettingsRow key={b.key} id={`about.${b.key}`} label={`${b.label}: ${b.value}`} sub="From your Profile" first={i === 0} />));
    // suggestions first: they wait for an answer
    const ordered = [...facts.filter((f) => f.suggested), ...facts.filter((f) => !f.suggested)];
    ordered.forEach((f, i) => rows.push(factRow(f, rows.length === 0 && i === 0)));
    if (out && rows.length === 0) rows.push(<Text key="empty" style={st.empty} testID={`about-empty-${place}`}>{copy.empty}</Text>);
    return (
      <View style={ui.section} testID={`about-${place}`} accessibilityLabel={copy.title}>
        <Text accessibilityRole="header" style={ui.sTitle}>{copy.title}</Text>
        <Text style={st.partSub}>{copy.sub}</Text>
        <View style={ui.card}>
          {rows}
          <View style={[st.addWrap, ui.rowLine]}>
            <Icon name="plus" size={13} color="var(--ink-3)" />
            <TextInput
              value={adding[place]} onChangeText={(t) => setAdding((a) => ({ ...a, [place]: t }))} onKeyPress={addKey(place) as never} placeholder={copy.add} placeholderTextColor="var(--ink-3)"
              accessibilityLabel={copy.add} testID={`about-add-${place}`} style={st.addInput}
            />
          </View>
        </View>
      </View>
    );
  };

  return (
    <View testID="about-you" {...({ dataSet: { sid: "memory.about" } } as object)}>
      <Text accessibilityRole="header" style={[ui.sTitle, st.head]}>About you</Text>
      <Text style={st.lead}>Every agent that works for you reads this. What one agent learns, all of them know. New things land in Private until you move them.</Text>
      {err ? <Text style={st.err} accessibilityRole="alert">{err}</Text> : null}
      <View style={st.parts}>
        <View style={st.col}>{part("public")}</View>
        <View style={st.col}>{part("private")}</View>
      </View>
      {menu.element}
    </View>
  );
}

const st = StyleSheet.create({
  head: { marginTop: 26, fontSize: 14 },
  lead: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-3)" as string, paddingHorizontal: 2 },
  parts: { flexDirection: "column" },
  col: { minWidth: 0 },
  partSub: { fontSize: 12, color: "var(--ink-3)" as string, marginTop: -4, marginBottom: 8, paddingHorizontal: 2 },
  empty: { fontSize: 12.5, color: "var(--ink-3)" as string, paddingHorizontal: 14, paddingVertical: 12 },
  more: { width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  pair: { flexDirection: "row", alignItems: "center", gap: 6 },
  editWrap: { paddingHorizontal: 12, paddingVertical: 8, gap: 4 },
  input: { fontSize: 13.5, color: "var(--ink)" as string, borderWidth: 1, borderColor: "var(--accent)" as string, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 6 },
  hint: { fontSize: 11.5, color: "var(--ink-3)" as string },
  confirm: { marginHorizontal: 10, marginBottom: 10, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: "var(--danger)" as string, gap: 8 },
  confirmText: { fontSize: 12.5, lineHeight: 17, color: "var(--ink)" as string },
  addWrap: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, height: 40 },
  addInput: { flex: 1, fontSize: 13, color: "var(--ink)" as string, height: 36 },
  err: { fontSize: 12.5, color: "var(--danger)" as string, marginTop: 8 },
});
