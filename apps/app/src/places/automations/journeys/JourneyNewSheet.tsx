// New Journey type: a name, who goes through it (a real record type of this Space, or a new plain one made here) and the stages as a list you edit in place. Making it makes a record type,
// so its records show in Records under Journeys and open as a board. Nothing here shows a raw backend error; a refusal is put in plain words next to what it is about.
import { createElement, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import { useAutomationsData } from "../canvas/data.tsx";
import { IconButton, TextButton, pointer, webOnly } from "../canvas/parts.tsx";
import type { KeyEventLike } from "../canvas/parts.tsx";
import { each } from "../runs/each.ts";
import { Glyph } from "../config/glyphs.tsx";
import { TypeTile, typeIcon } from "../../records/sidebar/parts.tsx";
import { hueOf } from "../../records/table/model.ts";
import {
  DEFAULT_STAGES, STAGE_TEMPLATES, addStage, boardLine, createPlainType, hasIssues, issuesOf, makeJourney, moveStage, namedStages, plainError, removeStage, renameStage, stagesFrom, typeChoices,
} from "./newModel.ts";
import type { Issues, TypeChoice } from "./newModel.ts";
import type { Stage } from "./model.ts";

type TypesOut = CapMap["schema.types.list"]["out"];
export interface NewSheetProps {
  onClose(): void;
  initialName?: string;
  /** The key of the type already picked. */
  initialSubject?: string;
  initialStages?: readonly string[];
  /** Types already known (a test or a shot); otherwise the sheet reads them from the Space. */
  initialTypes?: readonly TypeChoice[];
}

const stageHue = (key: string): string => `hsl(${hueOf(key)}, 55%, 52%)`;

export function JourneyNewSheet({ onClose, initialName = "", initialSubject = "", initialStages = DEFAULT_STAGES, initialTypes }: NewSheetProps): ReactElement {
  const data = useAutomationsData();
  const [name, setName] = useState(initialName);
  const [types, setTypes] = useState<readonly TypeChoice[] | null>(initialTypes ?? null);
  const [subject, setSubject] = useState<string | null>(initialSubject || null);
  const [stages, setStages] = useState<Stage[]>(() => stagesFrom(initialStages));
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [newType, setNewType] = useState<{ name: string; error?: string; busy?: boolean } | null>(null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (initialTypes) return;
    let live = true;
    data.call("schema.types.list", {}).then((out) => { if (live) setTypes(typeChoices((out as TypesOut).types)); }).catch(() => { if (live) setTypes([]); });
    return () => { live = false; };
  }, [data, initialTypes]);

  const issues: Issues = issuesOf(name, subject, stages);
  const shown: Issues = tried ? issues : {};
  const list = types ?? [];

  const addType = async (): Promise<void> => {
    if (!newType || !newType.name.trim() || newType.busy) return;
    setNewType({ ...newType, busy: true });
    try {
      const made = await createPlainType(data.call, newType.name, list.map((t) => t.key));
      setTypes([...list, made]); setSubject(made.key); setNewType(null);
    } catch (e) { setNewType({ name: newType.name, error: plainError(e) }); }
  };
  const create = async (): Promise<void> => {
    setTried(true);
    if (hasIssues(issues) || busy || !subject) return;
    setBusy(true); setErr(null);
    try {
      const id = await makeJourney(data.call, { name, subject, stages });
      data.nav.openJourney(id);
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : plainError(e)); setBusy(false); }
  };
  const fill = (titles: readonly string[]): void => { setStages(stagesFrom(titles)); setFocusKey(null); };
  const add = (): void => { const next = addStage(stages, ""); setStages(next); setFocusKey(next[next.length - 1]!.key); };
  const dropOn = (key: string): void => {
    if (!dragKey || dragKey === key) { setDragKey(null); return; }
    const to = stages.findIndex((s) => s.key === key);
    setStages(moveStage(stages, dragKey, to)); setDragKey(null);
  };
  const named = namedStages(stages);

  const stageRows = each(stages, (g, i) => {
    const row = (
      <View key={g.key} testID={`stage-row-${g.key}`} style={[s.stageRow, dragKey === g.key && { opacity: 0.5 }]}>
        <Glyph name="grip" size={13} color="var(--ink-4)" />
        <View aria-hidden style={[s.sdot, { backgroundColor: stageHue(g.key) as string }]} />
        <TextInput
          accessibilityLabel={`Stage ${i + 1} name`} testID={`stage-name-${g.key}`} value={g.title} onChangeText={(t) => setStages(renameStage(stages, g.key, t))}
          placeholder="Stage name" placeholderTextColor="var(--ink-4)" autoFocus={focusKey === g.key} style={[s.input, s.grow]}
          {...webOnly({ onKeyDown: (e: KeyEventLike) => { if (e.key === "Enter") { e.preventDefault?.(); add(); } } })}
        />
        <IconButton icon="arrup" label={`Move ${g.title || "stage"} up`} size={22} testID={`stage-up-${g.key}`} onPress={() => i > 0 && setStages(moveStage(stages, g.key, i - 1))} />
        <IconButton icon="arrdn" label={`Move ${g.title || "stage"} down`} size={22} testID={`stage-down-${g.key}`} onPress={() => i < stages.length - 1 && setStages(moveStage(stages, g.key, i + 1))} />
        <IconButton icon="trash" label={`Delete ${g.title || "stage"}`} size={22} testID={`stage-delete-${g.key}`} onPress={() => setStages(removeStage(stages, g.key))} />
      </View>
    );
    if (Platform.OS !== "web") return row;
    return createElement("div", {
      key: g.key, draggable: true, "data-testid": `stage-drag-${g.key}`,
      onDragStart: (e: { dataTransfer?: { setData(t: string, v: string): void; effectAllowed: string } }) => { setDragKey(g.key); if (e.dataTransfer) { e.dataTransfer.setData("text/plain", g.key); e.dataTransfer.effectAllowed = "move"; } },
      onDragEnd: () => setDragKey(null),
      onDragOver: (e: { preventDefault(): void }) => e.preventDefault(),
      onDrop: (e: { preventDefault(): void }) => { e.preventDefault(); dropOn(g.key); },
    }, row);
  });

  const typeChips = each(list, (t) => {
    const on = subject === t.key;
    return (
      <Pressable
        key={t.key} accessibilityRole="radio" accessibilityState={{ checked: on }} {...({ "aria-checked": on } as object)} accessibilityLabel={t.plural} testID={`subject-${t.key}`} onPress={() => setSubject(t.key)}
        style={[s.chip, on && s.chipOn, pointer]}
      >
        <TypeTile icon={typeIcon(t.icon)} hue={t.hue} size={16} />
        <Text numberOfLines={1} style={[s.chipText, on && s.chipTextOn]}>{t.plural}</Text>
      </Pressable>
    );
  });

  return (
    <View testID="journey-new" accessibilityLabel="New Journey type" style={s.card}>
      <View style={s.head}>
        <View style={{ flex: 1 }}>
          <Text accessibilityRole="header" style={s.title}>New Journey type</Text>
          <Text style={s.sub}>Records move through the stages you set. It shows in Records as a board.</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} testID="new-close" style={[s.x, pointer]}><Glyph name="x" size={14} color="var(--ink-3)" /></Pressable>
      </View>
      <ScrollView style={s.scroll} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <Text style={s.fl}>Name</Text>
        <TextInput accessibilityLabel="Journey name" testID="new-name" value={name} onChangeText={setName} placeholder="Client onboarding" placeholderTextColor="var(--ink-4)" autoFocus style={s.input} />
        {shown.name ? <Text testID="issue-name" accessibilityRole="alert" style={s.err}>{shown.name}</Text> : null}

        <Text style={s.fl}>Who goes through it</Text>
        <View accessibilityRole="radiogroup" accessibilityLabel="Who goes through it" style={s.chips} testID="new-subjects">
          {typeChips}
          {newType ? null : (
            <Pressable accessibilityRole="button" accessibilityLabel="New type" testID="new-type" onPress={() => setNewType({ name: "" })} style={[s.chip, s.chipAdd, pointer]}>
              <Glyph name="plus" size={12} color="var(--ink-3)" /><Text style={s.chipText}>New type</Text>
            </Pressable>
          )}
        </View>
        {types === null ? <Text style={s.hint}>Loading your record types</Text> : null}
        {newType ? (
          <View style={s.inline} testID="new-type-form">
            <TextInput
              accessibilityLabel="New type name" testID="new-type-name" value={newType.name} onChangeText={(t) => setNewType({ name: t })} placeholder="Name, such as Candidates" placeholderTextColor="var(--ink-4)" autoFocus style={[s.input, s.grow]}
              {...webOnly({ onKeyDown: (e: KeyEventLike) => { if (e.key === "Enter") { e.preventDefault?.(); void addType(); } if (e.key === "Escape") setNewType(null); } })}
            />
            <TextButton label="Add" testID="new-type-add" disabled={!newType.name.trim() || newType.busy === true} onPress={() => void addType()} />
            <TextButton label="Cancel" testID="new-type-cancel" onPress={() => setNewType(null)} />
          </View>
        ) : null}
        {newType?.error ? <Text testID="issue-new-type" accessibilityRole="alert" style={s.err}>{newType.error}</Text> : null}
        {shown.subject ? <Text testID="issue-subject" accessibilityRole="alert" style={s.err}>{shown.subject}</Text> : null}

        <Text style={s.fl}>Stages</Text>
        <View style={s.chips} testID="new-templates">
          <Text style={s.hintInline}>Start from</Text>
          {each(STAGE_TEMPLATES, (t) => (
            <Pressable key={t.key} accessibilityRole="button" accessibilityLabel={`${t.label}: ${t.stages.join(", ")}`} testID={`template-${t.key}`} onPress={() => fill(t.stages)} style={[s.chip, pointer]}>
              <Text style={s.chipText}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
        <View testID="new-stages" style={s.stageList}>
          {stageRows}
          {stages.length === 0 ? <Text style={s.none}>No stages yet</Text> : null}
        </View>
        <TextButton label="Add a stage" icon="plus" testID="new-add-stage" onPress={add} />
        {shown.stages ? <Text testID="issue-stages" accessibilityRole="alert" style={s.err}>{shown.stages}</Text> : null}

        <Text style={s.fl}>On the board</Text>
        <ScrollView horizontal testID="new-preview" accessibilityLabel="Board preview" style={s.preview} contentContainerStyle={s.previewIn}>
          {each(named, (g) => (
            <View key={g.key} style={s.pcol}>
              <View style={s.phead}><View aria-hidden style={[s.sdot, { backgroundColor: stageHue(g.key) as string }]} /><Text numberOfLines={1} style={s.ptitle}>{g.title}</Text></View>
              <View style={s.pcard} />
            </View>
          ))}
          {named.length === 0 ? <Text style={s.none}>Columns appear here</Text> : null}
        </ScrollView>
        <Text testID="new-stage-count" style={s.hint}>{boardLine(stages)}</Text>
        {err ? <Text testID="new-error" accessibilityRole="alert" style={s.err}>{err}</Text> : null}
      </ScrollView>
      <View style={s.foot}>
        <View style={{ flex: 1 }} />
        <TextButton label="Cancel" testID="new-cancel" onPress={onClose} />
        <TextButton label="Make the Journey" primary disabled={busy} testID="new-create" onPress={() => void create()} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { width: 520, maxWidth: "100%", maxHeight: "100%", borderRadius: 14, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line-2)" as string, overflow: "hidden" },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingTop: 18, paddingHorizontal: 20, paddingBottom: 6 },
  title: { fontSize: 15, lineHeight: 20, fontWeight: "600", color: "var(--ink)" as string },
  sub: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-3)" as string, marginTop: 2 },
  x: { width: 26, height: 26, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  scroll: { flexShrink: 1 },
  body: { paddingHorizontal: 20, paddingBottom: 14 },
  fl: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string, marginTop: 14, marginBottom: 6 },
  input: { height: 32, borderRadius: 8, paddingHorizontal: 10, fontSize: 13, color: "var(--ink)" as string, backgroundColor: "var(--hover)" as string, ...({ outlineStyle: "none", outlineWidth: 0 } as object) },
  grow: { flex: 1, minWidth: 0 },
  chips: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  chip: { height: 28, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 9, borderRadius: 8, backgroundColor: "var(--hover)" as string, maxWidth: 220 },
  chipOn: { backgroundColor: "var(--accent-wash)" as string, boxShadow: "inset 0 0 0 1.5px var(--accent)" } as object,
  chipAdd: { backgroundColor: "transparent", boxShadow: "inset 0 0 0 1px var(--line-2)" } as object,
  chipText: { fontSize: 12.5, color: "var(--ink-2)" as string, flexShrink: 1 },
  chipTextOn: { color: "var(--ink)" as string, fontWeight: "600" },
  inline: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  stageList: { gap: 4, marginTop: 8, marginBottom: 6 },
  stageRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  sdot: { width: 8, height: 8, borderRadius: 8 },
  none: { fontSize: 12, color: "var(--ink-4)" as string, paddingVertical: 4 },
  preview: { borderRadius: 10, backgroundColor: "var(--sunk)" as string },
  previewIn: { flexDirection: "row", gap: 8, padding: 8, minHeight: 64 },
  pcol: { width: 104, borderRadius: 8, backgroundColor: "var(--raised)" as string, padding: 7, gap: 6 },
  phead: { flexDirection: "row", alignItems: "center", gap: 5 },
  ptitle: { fontSize: 11.5, fontWeight: "600", color: "var(--ink)" as string, flexShrink: 1 },
  pcard: { height: 14, borderRadius: 4, backgroundColor: "var(--hover)" as string },
  hint: { fontSize: 12, lineHeight: 17, color: "var(--ink-3)" as string, marginTop: 6 },
  hintInline: { fontSize: 12, color: "var(--ink-3)" as string },
  err: { fontSize: 12.5, color: "var(--danger)" as string, marginTop: 6 },
  foot: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
});
