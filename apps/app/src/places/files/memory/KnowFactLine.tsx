// One fact of a living page (Files > Knowledge > Page): a bullet, the words, the source chip, who wrote it and how old it is. The age is underlined when the fact has earlier versions; resting the
// pointer on it, or focusing it, opens the history of the fact (each earlier wording with who and when, and "Restore this version"). Pressing the words edits them in place (Enter saves, Escape
// cancels, or the Cancel and Save buttons); the old wording is kept in history. Right-click (or the menu key, or the "..." button) opens Edit, Show history, Open source, Copy text, Promote to a
// wider layer and Move to Trash. Every write is a capability call (memory.fact.correct, memory.undo, memory.restore, memory.promote); a refusal shows as text under the fact, never swallowed.
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { menuTrigger, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { correctFact, errorText, restoreFact, undoFact } from "./actions.ts";
import { useLive, useMemoryData } from "./data.tsx";
import type { FlashState } from "./KnowFrame.tsx";
import { ageText, stampText } from "./know.ts";
import type { KFact } from "./know.ts";
import { SourceChip, TextButton } from "./KnowParts.tsx";
import { Icon, pointOf } from "./parts.tsx";
import { each } from "./model.ts";

/** What a fact needs to know about the page it is on, to offer the layers it could be promoted to. */
export interface FactPage { layer: KFact["layer"]; agentId?: string; projectId?: string; ownerRef?: string }

type Layer = KFact["layer"];
const RANK: Record<Layer, number> = { person: 0, agent: 1, project: 2, space: 3 };
const TARGET_NAME = { agent: "Agent", project: "Project", space: "Space" } as const;

/** "you" for the signed-in person, the name for anyone else, "Upkeep" for upkeep, an empty string when the row does not say. */
export function whoText(f: KFact, me: { id: string } | undefined, nameOf: (id: string) => string): string {
  if (f.byKind === "upkeep") return "Upkeep";
  if (!f.by) return "";
  return me && f.by === me.id ? "you" : nameOf(f.by);
}

/** The layers wider than the fact's own that a promotion can go to for this page, as the capability takes them (an agent needs its id, a project its id). */
export function promoteTargets(fact: Pick<KFact, "layer" | "agentId">, page: FactPage): Array<{ toLayer: "agent" | "project" | "space"; agentId?: string; projectId?: string }> {
  const out: Array<{ toLayer: "agent" | "project" | "space"; agentId?: string; projectId?: string }> = [];
  const agentId = fact.agentId ?? page.agentId;
  const projectId = page.projectId ?? (page.ownerRef !== undefined && page.ownerRef.startsWith("prj_") ? page.ownerRef : undefined);
  if (RANK.agent > RANK[fact.layer] && agentId) out.push({ toLayer: "agent", agentId });
  if (RANK.project > RANK[fact.layer] && projectId) out.push({ toLayer: "project", projectId });
  if (RANK.space > RANK[fact.layer]) out.push({ toLayer: "space" });
  return out;
}

const copyText = (text: string): boolean => {
  try { const c = (globalThis as { navigator?: { clipboard?: { writeText(t: string): unknown } } }).navigator?.clipboard; if (!c) return false; void c.writeText(text); return true; } catch { return false; }
};

/** The earlier versions of a fact as the popover lists them. */
function History({ fact, now, onRestore, onClose, who }: { fact: KFact; now: number; onRestore: (old: KFact) => void; onClose: () => void; who: (f: KFact) => string }): ReactElement {
  const q = useLive("memory.fact.get", { factId: fact.factId });
  const older = (q.status === "ready" ? q.data.history : []).slice().sort((a, b) => b.learnedAt - a.learnedAt) as KFact[];
  return (
    <View style={s.pop} accessibilityRole="none" accessibilityLabel="History of this fact" testID={`fact-history-${fact.factId}`}>
      <Text style={s.popHead}>History of this fact</Text>
      <View style={s.ver}>
        <View style={s.verTop}><Text style={s.verNow}>Now</Text><Text style={s.verWho}>{who(fact) === "you" ? "You" : who(fact)}{who(fact) ? " · " : ""}{stampText(fact.learnedAt, now)}</Text></View>
        <Text style={s.verText}>{fact.text}</Text>
      </View>
      {each(older, (o) => (
        <View key={o.factId} style={s.ver} testID={`fact-version-${o.factId}`}>
          <View style={s.verTop}><Text style={s.verDate}>{stampText(o.learnedAt, now)}</Text><Text style={s.verWho}>{who(o) === "you" ? "You" : who(o)}</Text></View>
          <Text style={s.verText}>{o.text}</Text>
          <View style={s.verAct}><TextButton label="Restore this version" accent testID={`fact-restore-${o.factId}`} a11y={`Restore this version: ${o.text}`} onPress={() => { onRestore(o); onClose(); }} /></View>
        </View>
      ))}
      {q.status === "ready" && older.length === 0 ? <Text style={s.none}>No earlier versions. Edits are kept here, never overwritten.</Text> : null}
      {q.status === "loading" ? <Text style={s.none}>Loading</Text> : null}
    </View>
  );
}

export interface KnowFactLineProps {
  fact: KFact;
  page: FactPage;
  now: number;
  /** The fact flashes briefly (it was the search hit this page opened for). */
  lit?: boolean;
  onFlash: (f: FlashState | null) => void;
}

export function KnowFactLine({ fact, page, now, lit = false, onFlash }: KnowFactLineProps): ReactElement {
  const data = useMemoryData();
  const menu = useMenu();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(fact.text);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pop, setPop] = useState(false);
  const [glow, setGlow] = useState(lit);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const who = (f: KFact): string => whoText(f, data.me, data.nameOf);
  const versions = fact.versions ?? 1;

  useEffect(() => { if (!lit) return undefined; setGlow(true); const t = setTimeout(() => setGlow(false), 2400); return () => clearTimeout(t); }, [lit]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const later = (fn: () => void, ms: number): void => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(fn, ms); };
  const stopTimer = (): void => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };

  const fail = (e: unknown, what: string): void => { setErr(errorText(e, what)); setBusy(false); };
  const startEdit = (): void => { setDraft(fact.text); setErr(null); setEditing(true); setPop(false); };
  const cancel = (): void => { setEditing(false); setDraft(fact.text); setErr(null); };
  const save = (): void => {
    const text = draft.trim();
    if (text === "" || text === fact.text || busy) { if (text === fact.text) cancel(); return; }
    setBusy(true); setErr(null);
    correctFact(data, fact.factId, text)
      .then((out) => {
        setBusy(false); setEditing(false);
        const was = fact.text, newId = (out as { fact?: { factId: string } }).fact?.factId;
        onFlash({ text: "Saved. The old wording is kept in history.", ...(newId ? { undo: () => { void correctFact(data, newId, was).catch((e: unknown) => onFlash({ text: errorText(e, "Could not undo the edit") })); } } : {}) });
      })
      .catch((e: unknown) => fail(e, "Could not save the fact"));
  };
  const trash = (): void => {
    setErr(null);
    undoFact(data, fact.factId)
      .then(() => onFlash({ text: "Moved to Trash. Agents no longer recall it.", undo: () => { void restoreFact(data, fact.factId).catch((e: unknown) => onFlash({ text: errorText(e, "Could not restore the fact") })); } }))
      .catch((e: unknown) => setErr(errorText(e, "Could not move the fact to Trash")));
  };
  const restoreVersion = (old: KFact): void => {
    setErr(null);
    const was = fact.text;
    correctFact(data, fact.factId, old.text)
      .then((out) => { const newId = (out as { fact?: { factId: string } }).fact?.factId; onFlash({ text: "Restored the earlier wording. The newer one is kept in history.", ...(newId ? { undo: () => { void correctFact(data, newId, was).catch((e: unknown) => onFlash({ text: errorText(e, "Could not undo the restore") })); } } : {}) }); })
      .catch((e: unknown) => setErr(errorText(e, "Could not restore that version")));
  };
  const promote = (t: { toLayer: "agent" | "project" | "space"; agentId?: string; projectId?: string }): void => {
    setErr(null);
    data.call("memory.promote", { factId: fact.factId, ...t })
      .then((out) => onFlash({ text: (out as { promoted?: boolean }).promoted === false ? `Asked to share this with the ${TARGET_NAME[t.toLayer]}. It waits for approval.` : `Now shared with the ${TARGET_NAME[t.toLayer]}.` }))
      .catch((e: unknown) => setErr(errorText(e, "Could not promote the fact")));
  };
  const openSource = (): void => { if (fact.sourceLink) data.nav.openChat(fact.sourceLink); else data.nav.openSource(fact.sourceRef); };

  const entries = (): MenuEntry[] => {
    const targets = promoteTargets(fact, page);
    const items: MenuEntry[] = [
      { label: "Edit", onSelect: startEdit },
      { label: "Show history", onSelect: () => setPop(true) },
      { label: "Open source", onSelect: openSource },
      { label: "Copy text", onSelect: () => { if (!copyText(fact.text)) setErr("Could not copy: the clipboard is not available here."); } },
    ];
    if (targets.length > 0) {
      items.push({ separator: true }, { head: "Promote to a wider layer" });
      for (const t of targets) items.push({ label: `Promote to ${TARGET_NAME[t.toLayer]}`, onSelect: () => promote(t) });
    }
    items.push({ separator: true }, { label: "Move to Trash", danger: true, onSelect: trash });
    return items;
  };
  const trig = menuTrigger((x, y) => menu.show(entries(), x, y));
  const shown = over || focused || editing;
  const age = ageText(fact.learnedAt, now);
  const whoName = who(fact);
  const hasVersions = versions > 1;

  return (
    <View style={[s.row, glow && s.glow, pop && s.up]} testID={`fact-${fact.factId}`} onPointerEnter={() => setOver(true)} onPointerLeave={() => setOver(false)} {...(trig as object)}>
      <View style={s.bul} />
      <View style={s.body}>
        {editing ? (
          <View>
            <View style={s.edit}>
              <TextInput
                value={draft} onChangeText={setDraft} autoFocus selectTextOnFocus accessibilityLabel="Edit this fact" testID={`fact-input-${fact.factId}`} editable={!busy}
                onSubmitEditing={save} onKeyPress={(e: { nativeEvent: { key: string } }) => { if (e.nativeEvent.key === "Escape") cancel(); }}
                style={s.input}
              />
              <TextButton label="Cancel" onPress={cancel} testID={`fact-cancel-${fact.factId}`} />
              <TextButton label="Save" accent onPress={save} testID={`fact-save-${fact.factId}`} />
            </View>
            <Text style={s.hint}>The old wording is kept in history.</Text>
          </View>
        ) : (
          <Pressable accessibilityRole="button" accessibilityLabel={`Edit this fact: ${fact.text}`} testID={`fact-text-${fact.factId}`} onPress={startEdit} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}>
            <Text style={s.text}>{fact.text}</Text>
          </Pressable>
        )}
        <View style={s.meta}>
          <SourceChip fact={fact} testID={`fact-source-${fact.factId}`} />
          {whoName ? <Text style={s.who}>{whoName}</Text> : null}
          <Text style={s.dot}>·</Text>
          <View style={s.ageBox} onPointerEnter={() => { later(() => setPop(true), 320); }} onPointerLeave={() => { later(() => setPop(false), 260); }}>
            <Pressable
              accessibilityRole="button" accessibilityLabel={`History of this fact, ${age}${hasVersions ? `, ${versions} versions` : ""}`} accessibilityState={{ expanded: pop }} testID={`fact-age-${fact.factId}`}
              onPress={() => { stopTimer(); setPop((v) => !v); }} onFocus={() => { stopTimer(); setPop(true); }} onBlur={() => later(() => setPop(false), 220)}
              {...({ onKeyDown: (e: { key: string }) => { if (e.key === "Escape") { stopTimer(); setPop(false); } } } as object)}
              style={s.age}
            >
              <Text style={[s.ageText, hasVersions && s.under]}>{age}</Text>
              {hasVersions ? <Text style={[s.ageText, s.vers, s.under]}>{versions} versions</Text> : null}
            </Pressable>
            {pop ? <History fact={fact} now={now} who={who} onRestore={restoreVersion} onClose={() => setPop(false)} /> : null}
          </View>
        </View>
        {err ? <Text style={s.err} accessibilityRole="alert" testID={`fact-error-${fact.factId}`}>{err}</Text> : null}
      </View>
      {!editing ? (
        <View style={[s.rt, !shown && s.hid]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Edit" testID={`fact-edit-${fact.factId}`} onPress={startEdit} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} style={({ hovered }: { hovered?: boolean }) => [s.act, hovered === true && s.actOver]}><Icon name="edit" size={14} color="var(--ink-3)" /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="More" testID={`fact-more-${fact.factId}`} onPress={(e) => { const p = pointOf(e); menu.show(entries(), p.x, p.y); }} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} style={({ hovered }: { hovered?: boolean }) => [s.act, hovered === true && s.actOver]}><Icon name="more" size={14} color="var(--ink-3)" /></Pressable>
        </View>
      ) : null}
      {menu.element}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 9, paddingHorizontal: 4, borderRadius: 8 },
  up: { zIndex: 60 },
  glow: { backgroundColor: "var(--accent-wash)" as string },
  bul: { width: 5, height: 5, borderRadius: 3, backgroundColor: "var(--ink-4)" as string, marginTop: 9, marginLeft: 6 },
  body: { flex: 1, minWidth: 0 },
  text: { fontSize: 14.5, lineHeight: 22, color: "var(--ink)" as string },
  meta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 7, marginTop: 4 },
  who: { fontSize: 12, color: "var(--ink-3)" as string },
  dot: { fontSize: 12, color: "var(--ink-4)" as string },
  ageBox: { position: "relative" },
  age: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 20 },
  ageText: { fontSize: 12, color: "var(--ink-3)" as string },
  vers: { color: "var(--ink-3)" as string },
  under: { textDecorationLine: "underline" },
  edit: { flexDirection: "row", alignItems: "center", gap: 6 },
  input: { flex: 1, height: 32, paddingHorizontal: 9, borderRadius: 7, borderWidth: 1, borderColor: "var(--accent)" as string, backgroundColor: "var(--field)" as string, color: "var(--ink)" as string, fontSize: 14, outlineStyle: "none" } as never,
  hint: { marginTop: 6, fontSize: 12, color: "var(--ink-3)" as string },
  err: { marginTop: 6, fontSize: 12.5, color: "var(--danger)" as string },
  rt: { flexDirection: "row", gap: 2, marginTop: 1 },
  hid: { opacity: 0 },
  act: { width: 26, height: 26, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  actOver: { backgroundColor: "var(--hover)" as string },
  pop: { position: "absolute", top: 24, left: 0, zIndex: 30, width: 340, paddingVertical: 6, borderRadius: 10, backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-pop)" as string, borderWidth: 1, borderColor: "var(--line)" as string } as never,
  popHead: { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 6, fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string },
  ver: { paddingHorizontal: 12, paddingVertical: 6, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  verTop: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  verNow: { fontSize: 12, fontWeight: "600", color: "var(--ink)" as string },
  verDate: { fontSize: 12, fontWeight: "600", color: "var(--ink-2)" as string },
  verWho: { fontSize: 12, color: "var(--ink-3)" as string },
  verText: { marginTop: 2, fontSize: 13, lineHeight: 18, color: "var(--ink)" as string },
  verAct: { flexDirection: "row", marginTop: 2, marginLeft: -8 },
  none: { paddingHorizontal: 12, paddingVertical: 6, fontSize: 12, color: "var(--ink-3)" as string },
});
