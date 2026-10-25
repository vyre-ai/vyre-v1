// Vault AddAnything: one Add that understands what you paste (spec 3.8). Pick what it is first (a search and a reel of app icons, Custom first), or paste anywhere in the sheet:
// one key is matched to its app by its shape, several KEY=value lines become one key each, JSON becomes keys from its top level, a link becomes URL, username and password.
// A one-line status says what was understood, with Undo. Values go to vault.item.put once; they never enter a chat or a log. The footer remembers where you last added.
import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { useScreenQuery, useVaultData } from "../layout/data.tsx";
import { handleFor } from "../layout/model.ts";
import type { Folder } from "../layout/model.ts";
import { Btn, Glyph, IconBtn, LogoTile, QuietLine } from "../layout/parts.tsx";
import { Sheet } from "../layout/Sheet.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { fieldsFor, filterTemplates, mergeFields, normalizeKey, patchAt, templateById, understandPaste } from "./env.ts";
import type { Field, ItemKind, Template } from "./env.ts";
import { LAYOUT_SCREEN } from "./ItemEnv.tsx";

type FoldersOut = CapMap["vault.folders.list"]["out"];

/** The folder picker's menu: one checked entry for where the item goes. A loop, not a map, so the JSX below holds no list-building. */
function folderEntries(list: readonly Folder[], target: string | undefined, pick: (id: string) => void): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const f of list) out.push({ label: f.scope === "mine" ? `${f.name} (Mine)` : f.name, checked: f.id === target, onSelect: () => pick(f.id) });
  return out;
}

export interface AddAnythingProps {
  onClose: () => void;
  /** After the item was saved: its id, name and folder, so the list can select it and remember the folder. */
  onAdded: (itemId: string, name: string, folderId: string) => void;
  /** Where the last item went (remembered by the shell between openings). */
  lastFolderId?: string | undefined;
  /** Text to understand on open (a paste that started this sheet). */
  initialPaste?: string | undefined;
}

interface Snapshot { name: string; kind: ItemKind; template: string; fields: Field[] }

export function AddAnything({ onClose, onAdded, lastFolderId, initialPaste }: AddAnythingProps): ReactElement {
  const data = useVaultData();
  const folders = useScreenQuery<FoldersOut>(LAYOUT_SCREEN, "folders", {});
  const menu = useMenu();
  const list: Folder[] = folders.status === "ready" ? folders.data.folders.filter((f) => f.yourLevel === "edit" || f.yourLevel === "manage") : [];
  const [folderId, setFolderId] = useState<string | undefined>(lastFolderId);
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [kind, setKind] = useState<ItemKind>("env");
  const [template, setTemplate] = useState<string>("custom");
  const [fields, setFields] = useState<Field[]>([]);
  const [status, setStatus] = useState<{ text: string; undo: Snapshot } | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const target = folderId && list.some((f) => f.id === folderId) ? folderId : (list.find((f) => f.scope === "mine") ?? list[0])?.id;
  const folder = list.find((f) => f.id === target);
  const reel = useMemo(() => filterTemplates(search), [search]);
  const snap = (): Snapshot => ({ name, kind, template, fields });

  const applyTemplate = (t: Template): void => {
    setTemplate(t.id); setKind(t.kind); setFields(fieldsFor(t)); setStatus(null);
    if (!nameTouched) setName(t.id === "custom" ? "" : t.name);
  };
  const understand = (raw: string): void => {
    const u = understandPaste(raw);
    if (u.shape === "none" || u.fields.length === 0) { setStatus({ text: u.note || "Nothing to read in that paste", undo: snap() }); return; }
    const before = snap();
    setFields((cur) => mergeFields(cur, u.fields));
    if (u.template) setTemplate(u.template);
    setKind(u.itemKind);
    if (u.name && !nameTouched && !name) setName(u.name);
    setStatus({ text: u.note, undo: before });
    setPasteText("");
  };
  useEffect(() => { if (initialPaste) understand(initialPaste); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const undo = (): void => {
    if (!status) return;
    setName(status.undo.name); setKind(status.undo.kind); setTemplate(status.undo.template); setFields(status.undo.fields); setStatus(null);
  };
  const generate = async (i: number): Promise<void> => {
    try {
      const out = (await data.call("vault.generate", { kind: "password", length: 24 })) as { value: string };
      setFields((cur) => patchAt(cur, i, { value: out.value, secret: true }));
    } catch { setError("Could not make a password right now."); }
  };

  const filled = fields.filter((f) => f.key && f.value !== "");
  const canSave = name.trim() !== "" && filled.length > 0 && target !== undefined && !saving;
  const keys = fields.map((f) => f.key).filter(Boolean);
  const dup = keys.find((k, i) => keys.indexOf(k) !== i);

  const save = async (): Promise<void> => {
    if (!canSave || !target) return;
    if (dup) { setError(`Two fields are called ${dup}. Rename one.`); return; }
    setSaving(true); setError(null);
    try {
      const out = (await data.call("vault.item.put", { folderId: target, name: name.trim(), kind, fields: filled.map((f) => ({ key: f.key, value: f.value, secret: f.secret })), ...(templateById(template) && template !== "custom" ? { template } : {}) })) as { item: { id: string; name: string } };
      onAdded(out.item.id, out.item.name, target);
    } catch (e) {
      setError(e instanceof Error && /duplicate/.test(e.message) ? `There is already an item called ${name.trim()} here. Pick another name.` : "Could not save. Nothing was lost; try again.");
      setSaving(false);
    }
  };

  const folderMenu = (x: number, y: number): void => {
    menu.show(folderEntries(list, target, setFolderId), x, y, "other");
  };

  const reelTiles: ReactElement[] = [];
  for (const t of reel) {
    reelTiles.push(
          <Pressable key={t.id} accessibilityRole="button" accessibilityLabel={t.name} accessibilityState={{ selected: template === t.id }} testID={`add-app-${t.id}`} onPress={() => applyTemplate(t)} style={[s.app, template === t.id && s.appOn]}>
            {t.id === "custom" ? <View style={s.customTile}><Glyph name="plus" size={16} color="var(--ink-2)" /></View> : <LogoTile name={t.name} size={32} />}
            <Text style={s.appName} numberOfLines={1}>{t.name}</Text>
          </Pressable>
    );
  }
  const fieldLines: ReactElement[] = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]!;
    fieldLines.push(
          <View key={i} style={s.rowLine} testID={`add-row-${i}`}>
            <TextInput value={f.key} onChangeText={(v) => setFields(patchAt(fields, i, { key: normalizeKey(v) }))} placeholder="KEY" autoCapitalize="characters" accessibilityLabel="Field name" style={[s.input, s.keyIn]} testID={`add-key-${i}`} />
            <TextInput
              value={f.value} onChangeText={(v) => setFields(patchAt(fields, i, { value: v }))} secureTextEntry={f.secret} placeholder="Value" autoCapitalize="none" autoCorrect={false}
              accessibilityLabel={`Value of ${f.key || "the field"}`} style={[s.input, { flex: 1, minWidth: 0 }]} testID={`add-value-${i}`}
            />
            <IconBtn icon={f.secret ? "lock" : "eye"} label={f.secret ? "Secret. Make it plain" : "Plain. Make it secret"} onPress={() => setFields(patchAt(fields, i, { secret: !x.secret }))} testID={`add-secret-${i}`} />
            {f.secret && /(PASSWORD|PIN)$/.test(f.key) ? <IconBtn icon="wand" label="Make a password" onPress={() => { void generate(i); }} testID={`add-generate-${i}`} /> : null}
            <IconBtn icon="x" label={`Remove ${f.key || "the field"}`} onPress={() => setFields(fields.filter((_, j) => j !== i))} testID={`add-remove-${i}`} />
          </View>
    );
  }

  return (
    <Sheet
      title="Add to the Vault" onClose={onClose} testID="add-sheet"
      footer={<>
        <Pressable accessibilityRole="button" accessibilityLabel={`Adding to ${folder?.name ?? "a folder"}`} testID="add-folder" onPress={(e) => { const r = rectOf(e); folderMenu(r.x, r.y); }} style={s.folderBtn}>
          <Glyph name={folder?.scope === "mine" ? "mine" : "folder"} size={14} /><Text style={s.folderText} numberOfLines={1}>{folder ? (folder.scope === "mine" ? `${folder.name} · Mine` : `Shared › ${folder.name}`) : "Choose a folder"}</Text><Glyph name="chevron" size={11} />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Btn label="Cancel" onPress={onClose} testID="add-cancel" />
        <Btn label={saving ? "Saving" : "Add"} primary disabled={!canSave} onPress={() => { void save(); }} testID="add-save" />
      </>}
    >
      {menu.element}
      <View style={s.searchRow}>
        <Glyph name="search" size={14} />
        <TextInput value={search} onChangeText={(v) => { if (v.length - search.length > 8 && !/\s/.test(v.trim())) { understand(v); setSearch(""); } else setSearch(v); }} placeholder="Search apps, or paste a key" accessibilityLabel="Search apps" autoFocus style={s.search} testID="add-search"
          onSubmitEditing={() => { const first = reel.find((t) => t.id !== "custom"); if (first && search.trim()) applyTemplate(first); }} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.reel} testID="add-reel" accessibilityRole="list">
        {reelTiles}
      </ScrollView>

      <View style={s.pasteBox}>
        <TextInput
          value={pasteText} onChangeText={(v) => { if (v.length - pasteText.length > 1) understand(v); else setPasteText(v); }} multiline numberOfLines={3} autoCapitalize="none" autoCorrect={false} spellCheck={false}
          placeholder="Paste a key, a .env, a link or JSON. Vyre works out what it is." accessibilityLabel="Paste here" style={s.paste} testID="add-paste"
          onBlur={() => { if (pasteText.trim()) understand(pasteText); }}
        />
        {pasteText.trim() ? <View style={{ alignSelf: "flex-end" }}><Btn label="Read it" icon="wand" onPress={() => understand(pasteText)} testID="add-read" /></View> : null}
      </View>
      <View style={s.statusSlot}>{status ? <QuietLine text={status.text} onUndo={undo} testID="add-status" /> : null}</View>

      <View style={s.field}>
        <Text style={s.label}>Name</Text>
        <TextInput value={name} onChangeText={(v) => { setName(v); setNameTouched(true); }} placeholder="GoHighLevel" accessibilityLabel="Name" style={s.input} testID="add-name" />
        <Text style={s.hint} testID="add-handle">{name.trim() ? `Agents ask for it as ${handleFor(data.spaceName, name)}` : "Agents ask for an item by its handle and never see the values."}</Text>
      </View>

      <View style={s.field}>
        <Text style={s.label}>Fields</Text>
        {fields.length === 0 ? <Text style={s.hint} testID="add-empty">Pick an app, or paste something above. You can also add a field by hand.</Text> : null}
        {fieldLines}
        <View style={{ alignSelf: "flex-start" }}><Btn label="Add field" icon="plus" onPress={() => setFields([...fields, { key: "", value: "", secret: true }])} testID="add-field" /></View>
      </View>
      {error ? <Text style={s.error} accessibilityRole="alert" testID="add-error">{error}</Text> : null}
    </Sheet>
  );
}

function rectOf(e: unknown): { x: number; y: number } {
  const ev = e as { currentTarget?: { getBoundingClientRect?: () => { left: number; top: number } }; nativeEvent?: { pageX?: number; pageY?: number } };
  const box = ev.currentTarget?.getBoundingClientRect?.();
  return box ? { x: box.left, y: box.top - 4 } : { x: ev.nativeEvent?.pageX ?? 0, y: ev.nativeEvent?.pageY ?? 0 };
}

const s = StyleSheet.create({
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8, height: 34, paddingHorizontal: 10, borderRadius: 8, backgroundColor: "var(--sel)" as string },
  search: { flex: 1, minWidth: 0, color: "var(--ink)" as string, fontSize: 13.5 },
  reel: { gap: 6, paddingVertical: 2 },
  app: { width: 76, alignItems: "center", gap: 5, paddingVertical: 8, borderRadius: 10 },
  appOn: { backgroundColor: "var(--accent-wash)" as string },
  customTile: { width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "var(--line-2)" as string },
  appName: { fontSize: 11.5, color: "var(--ink-2)" as string },
  pasteBox: { gap: 6 },
  paste: { minHeight: 64, paddingHorizontal: 10, paddingTop: 8, borderRadius: 8, borderWidth: 1, borderStyle: "dashed", borderColor: "var(--line-2)" as string, color: "var(--ink)" as string, fontFamily: "var(--mono)" as string, fontSize: 12.5 },
  statusSlot: { minHeight: 24 },
  field: { gap: 6 },
  label: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-2)" as string },
  input: { height: 34, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: "var(--line-2)" as string, backgroundColor: "var(--win)" as string, color: "var(--ink)" as string, fontSize: 13.5 },
  keyIn: { width: 170, fontFamily: "var(--mono)" as string, fontSize: 12.5 },
  rowLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  hint: { fontSize: 12, lineHeight: 17, color: "var(--ink-3)" as string },
  error: { fontSize: 12.5, color: "var(--danger)" as string },
  folderBtn: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: 260, height: 28, paddingHorizontal: 8, borderRadius: 7 },
  folderText: { fontSize: 13, color: "var(--ink-2)" as string, flexShrink: 1 },
});
