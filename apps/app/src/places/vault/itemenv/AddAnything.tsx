// Vault AddAnything: one Add that understands what you paste (spec 3.8). Pick what it is first (a search and a reel of app icons, Custom first), or paste anywhere in the sheet:
// one key is matched to its app by its shape, several KEY=value lines become one key each, JSON becomes keys from its top level, a link becomes URL, username and password.
// A one-line status says what was understood, with Undo. Values go to vault.item.put once; they never enter a chat or a log. The footer remembers where you last added.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { TextStyle, ViewStyle } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { useScreenQuery, useVaultData } from "../layout/data.tsx";
import { handleFor } from "../layout/model.ts";
import type { Folder } from "../layout/model.ts";
import { BrandTile, Btn, Glyph, IconBtn, LogoTile, QuietLine } from "../layout/parts.tsx";
import type { IconName } from "../layout/parts.tsx";
import { brandOfTemplate } from "./brands.ts";
import { Sheet } from "../layout/Sheet.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { fieldsFor, filterTemplates, mergeFields, normalizeKey, patchAt, plainFields, templateById, understandPaste } from "./env.ts";
import type { Field, ItemKind, Template } from "./env.ts";
import { LAYOUT_SCREEN } from "./ItemEnv.tsx";

type FoldersOut = CapMap["vault.folders.list"]["out"];

/** Where an item goes, in words: "Mine", or "Shared › Marketing". */
export function whereLabel(f: Folder | undefined): string {
  if (!f) return "Choose a folder";
  return f.scope === "mine" ? "Mine" : `Shared › ${f.name}`;
}

/** The Add to menu: Mine first, then each shared folder, the one the item goes to checked. A loop, not a map, so the JSX below holds no list-building. */
export function folderEntries(list: readonly Folder[], target: string | undefined, pick: (id: string) => void): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const f of list) if (f.scope === "mine") out.push({ label: whereLabel(f), checked: f.id === target, onSelect: () => pick(f.id) });
  for (const f of list) if (f.scope !== "mine") out.push({ label: whereLabel(f), checked: f.id === target, onSelect: () => pick(f.id) });
  return out;
}

/** The three icons of the reel that are not a brand: a blank item, a login and a card. */
const PLAIN_ICON: Readonly<Record<string, IconName>> = { custom: "braces", login: "globe", card: "card" };

export const HINT = "Paste a key or .env, or pick an app";

export interface AddAnythingProps {
  onClose: () => void;
  /** After the item was saved: its id, name and folder, so the list can select it and remember the folder. */
  onAdded: (itemId: string, name: string, folderId: string) => void;
  /** Where the last item went (remembered by the shell between openings). */
  lastFolderId?: string | undefined;
  /** Text to understand on open (a paste that started this sheet). */
  initialPaste?: string | undefined;
  /** A template picked on open (the screenshot mounts and tests use it). */
  initialApp?: string | undefined;
}

interface Snapshot { name: string; kind: ItemKind; template: string; fields: Field[] }

const BLANK: Snapshot = { name: "", kind: "env", template: "custom", fields: [] };

/** A template's form: its own rows, or one blank row for Custom. */
function templateFields(t: Template): Field[] {
  return t.keys.length === 0 ? [{ key: "", value: "", secret: true }] : fieldsFor(t);
}

/** What the sheet starts with: an app picked (the screenshot mounts and tests use it) or a paste that started it. Pure, so the first render already shows it. */
export function startDraft(initialPaste?: string, initialApp?: string): { draft: Snapshot; status: { text: string; undo: Snapshot } | null } {
  let draft = BLANK;
  let status: { text: string; undo: Snapshot } | null = null;
  const t = initialApp ? templateById(initialApp) : undefined;
  if (t) draft = { name: t.id === "custom" ? "" : t.name, kind: t.kind, template: t.id, fields: templateFields(t) };
  if (initialPaste) {
    const u = understandPaste(initialPaste);
    if (u.shape === "none" || u.fields.length === 0) status = { text: u.note || "Nothing to read in that paste", undo: draft };
    else {
      const before = draft;
      draft = { name: u.name && !draft.name ? u.name : draft.name, kind: u.itemKind, template: u.template ?? draft.template, fields: mergeFields(draft.fields, u.fields) };
      status = { text: u.note, undo: before };
    }
  }
  return { draft, status };
}

export function AddAnything({ onClose, onAdded, lastFolderId, initialPaste, initialApp }: AddAnythingProps): ReactElement {
  const data = useVaultData();
  const folders = useScreenQuery<FoldersOut>(LAYOUT_SCREEN, "folders", {});
  const menu = useMenu();
  const list: Folder[] = folders.status === "ready" ? folders.data.folders.filter((f) => f.yourLevel === "edit" || f.yourLevel === "manage") : [];
  const [folderId, setFolderId] = useState<string | undefined>(lastFolderId);
  const [search, setSearch] = useState("");
  const [searchFocus, setSearchFocus] = useState(false);
  const start = useMemo(() => startDraft(initialPaste, initialApp), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [name, setName] = useState(start.draft.name);
  const [nameTouched, setNameTouched] = useState(false);
  const [kind, setKind] = useState<ItemKind>(start.draft.kind);
  const [template, setTemplate] = useState<string>(start.draft.template);
  const [fields, setFields] = useState<Field[]>(start.draft.fields);
  const [status, setStatus] = useState<{ text: string; undo: Snapshot } | null>(start.status);
  const [hoverName, setHoverName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const target = folderId && list.some((f) => f.id === folderId) ? folderId : (list.find((f) => f.scope === "mine") ?? list[0])?.id;
  const folder = list.find((f) => f.id === target);
  const reel = useMemo(() => filterTemplates(search), [search]);
  const snap = (): Snapshot => ({ name, kind, template, fields });

  const applyTemplate = (t: Template): void => {
    setTemplate(t.id); setKind(t.kind); setFields(templateFields(t)); setStatus(null);
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
  };
  // A paste anywhere in the sheet is understood (a key, a .env, a link, JSON): there is no paste box. A paste into the name or a value stays a plain paste.
  const understandRef = useRef(understand);
  understandRef.current = understand;
  useEffect(() => {
    const doc = (globalThis as { document?: { addEventListener(t: string, f: (e: ClipboardEvent) => void): void; removeEventListener(t: string, f: (e: ClipboardEvent) => void): void } }).document;
    if (!doc) return;
    const onPaste = (e: ClipboardEvent): void => {
      const el = e.target as { tagName?: string; getAttribute?: (n: string) => string | null } | null;
      const plain = el?.tagName === "INPUT" || el?.tagName === "TEXTAREA";
      if (plain && el?.getAttribute?.("data-testid") !== "add-search") return;
      const text = e.clipboardData?.getData("text") ?? "";
      if (text.trim()) { e.preventDefault(); understandRef.current(text); }
    };
    doc.addEventListener("paste", onPaste);
    return () => doc.removeEventListener("paste", onPaste);
  }, []);

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

  const started = fields.length > 0;
  const filled = fields.filter((f) => f.key && f.value !== "");
  const canSave = name.trim() !== "" && filled.length > 0 && target !== undefined && !saving;
  const keys = fields.map((f) => f.key).filter(Boolean);
  const dup = keys.find((k, i) => keys.indexOf(k) !== i);

  const save = async (): Promise<void> => {
    if (!canSave || !target) return;
    if (dup) { setError(`Two fields are called ${dup}. Rename one.`); return; }
    setSaving(true); setError(null);
    try {
      const out = (await data.call("vault.item.put", { folderId: target, name: name.trim(), kind, fields: plainFields(filled), ...(templateById(template) && template !== "custom" ? { template } : {}) })) as { item: { id: string; name: string } };
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
    const plain = PLAIN_ICON[t.id];
    const brand = brandOfTemplate(t.id);
    reelTiles.push(
      <Pressable key={t.id} accessibilityRole="button" accessibilityLabel={t.name} accessibilityState={{ selected: template === t.id && started }} testID={`add-app-${t.id}`} onPress={() => applyTemplate(t)}
        onHoverIn={() => setHoverName(t.name)} onHoverOut={() => setHoverName(null)} style={[s.app, template === t.id && started && APP_ON]}>
        {plain ? <View style={s.plainTile}><Glyph name={plain} size={18} color="var(--ink-2)" /></View> : brand ? <BrandTile brand={brand} name={t.name} size={36} /> : <LogoTile name={t.name} size={36} />}
      </Pressable>,
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
            <IconBtn icon={f.secret ? "lock" : "eye"} label={f.secret ? "Secret. Make it plain" : "Plain. Make it secret"} onPress={() => setFields(patchAt(fields, i, { secret: !f.secret }))} testID={`add-secret-${i}`} />
            {f.secret && /(PASSWORD|PIN)$/.test(f.key) ? <IconBtn icon="wand" label="Make a password" onPress={() => { void generate(i); }} testID={`add-generate-${i}`} /> : null}
            <IconBtn icon="x" label={`Remove ${f.key || "the field"}`} onPress={() => setFields(fields.filter((_, j) => j !== i))} testID={`add-remove-${i}`} />
          </View>
    );
  }

  return (
    <Sheet
      title="Add to the Vault" onClose={onClose} testID="add-sheet" icon={<Glyph name="plus" size={16} color="var(--accent)" />}
      footer={<>
        <Text style={s.addTo}>Add to</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`Adding to ${folder?.name ?? "a folder"}`} testID="add-folder" onPress={(e) => { const r = rectOf(e); folderMenu(r.x, r.y); }} style={({ hovered }: { hovered?: boolean }) => [s.folderBtn, hovered === true && HOVER]}>
          <Text style={s.folderText} numberOfLines={1}>{whereLabel(folder)}</Text><Glyph name="chevd" size={11} />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Btn label="Cancel" onPress={onClose} testID="add-cancel" />
        <Btn label={saving ? "Saving" : "Add"} primary disabled={!canSave} onPress={() => { void save(); }} testID="add-save" />
      </>}
    >
      {menu.element}
      <View style={s.topRow}>
        <View style={[s.searchRow, searchRing(searchFocus)]} testID="add-search-box">
          <Glyph name="search" size={14} />
          <TextInput value={search} onChangeText={(v) => { if (v.length - search.length > 8 && !/\s/.test(v.trim())) { understand(v); setSearch(""); } else setSearch(v); }} placeholder="Search apps" accessibilityLabel="Search apps" autoFocus onFocus={() => setSearchFocus(true)} onBlur={() => setSearchFocus(false)} style={[s.search, NO_BROWSER_RING]} testID="add-search"
            onSubmitEditing={() => { const first = reel.find((t) => t.id !== "custom"); if (first && search.trim()) applyTemplate(first); }} />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.reelBox} contentContainerStyle={s.reel} testID="add-reel" accessibilityRole="list">
          {reelTiles}
        </ScrollView>
      </View>
      {started ? null : <Text style={s.hint} testID="add-hint">{hoverName ?? HINT}</Text>}
      {status ? <QuietLine text={status.text} onUndo={undo} testID="add-status" /> : null}

      {started ? (
        <>
          <View style={s.field}>
            <Text style={s.label}>Name</Text>
            <TextInput value={name} onChangeText={(v) => { setName(v); setNameTouched(true); }} placeholder="GoHighLevel" accessibilityLabel="Name" style={s.input} testID="add-name" />
            {name.trim() ? <Text style={s.handle} testID="add-handle">{handleFor(data.spaceName, name)}</Text> : null}
          </View>
          <View style={s.field}>
            <Text style={s.label}>Fields</Text>
            {fieldLines}
            <View style={{ alignSelf: "flex-start" }}><Btn label="Add field" icon="plus" onPress={() => setFields([...fields, { key: "", value: "", secret: true }])} testID="add-field" /></View>
          </View>
        </>
      ) : null}
      {error ? <Text style={s.error} accessibilityRole="alert" testID="add-error">{error}</Text> : null}
    </Sheet>
  );
}

function rectOf(e: unknown): { x: number; y: number } {
  const ev = e as { currentTarget?: { getBoundingClientRect?: () => { left: number; top: number } }; nativeEvent?: { pageX?: number; pageY?: number } };
  const box = ev.currentTarget?.getBoundingClientRect?.();
  return box ? { x: box.left, y: box.top - 4 } : { x: ev.nativeEvent?.pageX ?? 0, y: ev.nativeEvent?.pageY ?? 0 };
}

/** The browser draws its own focus ring on a text field; the search box draws the prototype's quiet ring on the whole box instead (.search3:focus-within). */
const NO_BROWSER_RING = { outlineStyle: "none", outlineWidth: 0, backgroundColor: "transparent" } as unknown as TextStyle;

/** The ring of the search box: a 1 px line at rest, a 1.5 px accent ring while the field has focus. Plain objects, so the token shows in the element's inline style. */
export function searchRing(focused: boolean): ViewStyle {
  return { boxShadow: focused ? "inset 0 0 0 1.5px var(--accent)" : "inset 0 0 0 1px var(--line-2)" } as unknown as ViewStyle;
}

// Plain objects (not StyleSheet ids), as in ui/Row, so the painted token is visible in the element's inline style.
const APP_ON = { backgroundColor: "var(--accent-wash)", boxShadow: "inset 0 0 0 1.5px var(--accent-line)" };
const HOVER = { backgroundColor: "var(--hover)" };

const s = StyleSheet.create({
  topRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  searchRow: { width: 190, flexDirection: "row", alignItems: "center", gap: 8, height: 46, paddingHorizontal: 12, borderRadius: 12, flexShrink: 0 },
  search: { flex: 1, minWidth: 0, color: "var(--ink)" as string, fontSize: 13.5 },
  reelBox: { flex: 1, minWidth: 0 },
  reel: { gap: 6, alignItems: "center", paddingVertical: 4 },
  app: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 12 },
  plainTile: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "var(--sunk)" as string, ...({ boxShadow: "inset 0 0 0 1px var(--line)" } as object) },
  hint: { textAlign: "center", fontSize: 13, color: "var(--ink-3)" as string, paddingVertical: 14 },
  handle: { fontFamily: "var(--mono)" as string, fontSize: 12, color: "var(--ink-3)" as string },
  addTo: { fontSize: 13, color: "var(--ink-3)" as string },
  field: { gap: 6 },
  label: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-2)" as string },
  input: { height: 34, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: "var(--line-2)" as string, backgroundColor: "var(--win)" as string, color: "var(--ink)" as string, fontSize: 13.5 },
  keyIn: { width: 170, fontFamily: "var(--mono)" as string, fontSize: 12.5 },
  rowLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  error: { fontSize: 12.5, color: "var(--danger)" as string },
  folderBtn: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: 260, height: 28, paddingHorizontal: 8, borderRadius: 7 },
  folderText: { fontSize: 13, color: "var(--ink-2)" as string, flexShrink: 1 },
});
