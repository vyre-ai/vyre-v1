// Settings > Appearance: When (match my device, always light, always dark), the By day and At night slots, a gallery of skins drawn as small apps (hover shows the whole app in it, a press keeps it and says so with Undo),
// Get a skin from a link, Make your own, then Display (text size, density, reduce motion, language) and the keyboard shortcuts. The look is one person setting (look.ts); the shell paints it (settings-look.ts).
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { skins } from "../../../../../ui/src/tokens/skins.ts";
import type { Palette } from "../../../../../ui/src/tokens/skins.ts";
import { Overlay } from "../automations/config/Overlay.tsx";
import { useSettingsData } from "./data.tsx";
import { ACCENTS, LANGUAGES, LOOK_KEY, TEXT_MAX, TEXT_MIN, TEXT_STEP, baseOfSlot, buildSkin, changedLine, choose, effectiveSkin, lookFrom, paletteOf, parseSkinLink, slotIsLive, slotKey, withMode, withSkinAdded } from "./look.ts";
import type { Contrast, CustomSkin, Look, LookMode } from "./look.ts";
import type { SettingRow } from "./model.ts";
import { useSaved } from "./saved.tsx";
import { Choice, Glyph, Section, Segmented, SettingsRow, SmallButton, Slider, Switch, pointer, webOnly } from "./ui.tsx";
import { Shortcuts } from "./pages-b.tsx";

const stock = skins;
const paletteById = (id: string, mine: readonly CustomSkin[]): Palette => { const m = mine.find((x) => x.id === id); return m ? paletteOf(m) : (skins.find((x) => x.id === id) ?? skins[0]!).palette; };
const nameById = (id: string, mine: readonly CustomSkin[]): string => mine.find((x) => x.id === id)?.name ?? skins.find((x) => x.id === id)?.name ?? id;
const noteById = (id: string, mine: readonly CustomSkin[]): string => mine.find((x) => x.id === id)?.note ?? skins.find((x) => x.id === id)?.note ?? "";

/** A skin as a small app: the sidebar, a message and the field, in the skin's own colours. */
export function Thumb({ palette, big = false }: { palette: Palette; big?: boolean }): ReactElement {
  const p = palette;
  return (
    <View testID="skin-thumb" aria-hidden style={[t.thumb, big && t.thumbBig, { backgroundColor: p.win, borderColor: p.me }]}>
      <View style={[t.side, { backgroundColor: p.side }]}><View style={[t.dot, { backgroundColor: p.accent }]} /><View style={[t.bar, { backgroundColor: p.me }]} /><View style={[t.bar, { backgroundColor: p.ink4 }]} /></View>
      <View style={t.main}>
        <View style={[t.msg, { backgroundColor: p.me }]} /><View style={[t.line, { backgroundColor: p.ink3 }]} /><View style={[t.line, { width: "60%", backgroundColor: p.ink4 }]} />
        <View style={[t.field, { backgroundColor: p.raised, borderColor: p.me }]}><View style={[t.send, { backgroundColor: p.accent }]} /></View>
      </View>
    </View>
  );
}

export function AppearancePage({ rows, found }: { rows: readonly SettingRow[]; found?: string | null }): ReactElement {
  const data = useSettingsData();
  const saved = useSaved();
  const stored = rows.find((r) => r.key === LOOK_KEY)?.value;
  const [look, setLook] = useState<Look>(() => lookFrom(stored));
  const [editing, setEditing] = useState<"day" | "night">("day");
  const [all, setAll] = useState(false);
  const [dlg, setDlg] = useState<null | "make" | "link">(null);
  const dark = (): boolean => globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  const key = slotKey(look, editing);
  const base = baseOfSlot(key);
  const current = look[key];
  const save = (next: Look, line: string, undo?: Look): void => {
    setLook(next);
    data.nav.applyLook?.(next);
    void Promise.resolve(data.call("settings.set", { key: LOOK_KEY, value: next })).then(
      () => saved.saved(line, undo ? () => { setLook(undo); data.nav.applyLook?.(undo); void data.call("settings.set", { key: LOOK_KEY, value: undo }); } : undefined),
      (e: unknown) => { setLook(look); data.nav.applyLook?.(look); saved.failed(e instanceof Error ? e.message : "That did not work."); },
    );
  };
  const pick = (id: string): void => {
    const next = choose(look, key, id);
    data.nav.previewSkin?.(null);
    if (next) save(next, changedLine(nameById(id, look.mine), key, slotIsLive(look, editing, dark())), look);
  };
  const setMode = (m: string): void => save(withMode(look, m as LookMode), "Saved");
  const set = <K extends keyof Look>(k: K, v: Look[K]): void => save({ ...look, [k]: v }, "Saved");
  const ofBase = <T extends { base: "light" | "dark" }>(list: readonly T[]): T[] => list.filter((k) => all || k.base === base);
  const tile = (id: string, name: string, note: string): ReactElement => {
    const on = current === id;
    return (
      <Pressable
        key={id} accessibilityRole="button" accessibilityState={{ selected: on }} aria-pressed={on} accessibilityLabel={`${name}. ${note}`} testID={`skin-${id}`} onPress={() => pick(id)}
        onHoverIn={() => data.nav.previewSkin?.(id)} onHoverOut={() => data.nav.previewSkin?.(null)} style={[t.tile, on && t.tileOn, pointer]}
      >
        <Thumb palette={paletteById(id, look.mine)} />
        <View style={t.tileName}><Text numberOfLines={1} style={t.name}>{name}</Text>{on ? <Glyph name="check" size={12} color="var(--accent)" /> : null}</View>
      </Pressable>
    );
  };
  const grid = (list: readonly { id: string; name: string; note: string }[], tid: string): ReactElement | null => (list.length ? <View style={t.grid} testID={tid}>{list.map((k) => tile(k.id, k.name, k.note))}</View> : null);
  const slot = (k: "day" | "night" | "light" | "dark", label: string, on: boolean, press: () => void): ReactElement => (
    <Pressable key={k} accessibilityRole="button" aria-pressed={on} accessibilityLabel={`${label}: ${nameById(look[k], look.mine)}. Pick to change it`} testID={`slot-${k}`} onPress={press} style={[t.slot, on && t.slotOn, pointer]}>
      <Thumb palette={paletteById(look[k], look.mine)} /><View style={{ flex: 1, minWidth: 0 }}><Text style={t.slotLabel}>{label}</Text><Text numberOfLines={1} style={t.slotName}>{nameById(look[k], look.mine)}</Text></View>
    </Pressable>
  );
  const stockShown = stock.filter((k) => all || k.base === base);
  return (
    <>
      <Section title="When" testID="look-when">
        <View style={t.pad}><Segmented value={look.mode} label="When" testID="look-mode" onChange={setMode} options={[{ value: "device", label: "Match my device" }, { value: "light", label: "Always light" }, { value: "dark", label: "Always dark" }]} /></View>
      </Section>
      <View style={t.slots} testID="look-slots">
        {look.mode === "device"
          ? [slot("day", "By day", editing === "day", () => setEditing("day")), slot("night", "At night", editing === "night", () => setEditing("night"))]
          : [slot(look.mode, look.mode === "light" ? "Always light" : "Always dark", true, () => undefined)]}
      </View>
      <Text style={t.foot}>{look.mode === "device" ? `Vyre follows your device. Pick a slot, then a skin below. Just for you, in ${data.space.name}.` : `Just for you, in ${data.space.name}.`}</Text>
      <View style={t.head}>
        <Text accessibilityRole="header" style={t.heading}>{all ? "All skins" : base === "dark" ? "Dark skins" : "Light skins"}</Text>
        <Pressable accessibilityRole="button" testID="look-all" onPress={() => setAll(!all)} style={pointer}><Text style={t.link}>{all ? `Show only ${base} skins` : "Show all"}</Text></Pressable>
      </View>
      <View testID="look-gallery" {...webOnly({ dataSet: { sid: "appearance.skin" } })} style={found === "appearance.skin" ? t.found : undefined}>
        {grid(stockShown.map((k) => ({ id: k.id, name: k.name, note: k.note })), "skins-stock")}
        {ofBase(look.mine).length > 0 ? <><Text style={t.sub}>Yours</Text>{grid(ofBase(look.mine).map((k) => ({ id: k.id, name: k.name, note: k.note })), "skins-mine")}</> : null}
      </View>
      <Section>
        <SettingsRow id="appearance.link" first label="Get a skin from a link" sub="Someone shared a skin with you" lead={<Glyph name="link" size={16} />} control={<SmallButton label="Paste a link" testID="look-link" onPress={() => setDlg("link")} />} />
        <SettingsRow id="appearance.make" label="Make your own" sub="Pick a base, an accent and the contrast" lead={<Glyph name="palette" size={16} />} control={<SmallButton label="Make a skin" testID="look-make" onPress={() => setDlg("make")} />} />
      </Section>
      <Section title="Display" testID="look-display">
        <SettingsRow id="appearance.text" first label="Text size" sub="The quick brown fox jumps over the lazy dog."
          control={<Slider value={look.text} min={TEXT_MIN} max={TEXT_MAX} step={TEXT_STEP} label="Text size" testID="look-text" format={(n) => `${n}%`} onChange={(n) => set("text", n)} />} />
        <SettingsRow id="appearance.density" label="Density" control={<Segmented value={look.density} label="Density" testID="look-density" onChange={(v) => set("density", v as Look["density"])} options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]} />} />
        <SettingsRow id="appearance.motion" label="Reduce motion" sub="Fewer animations everywhere" control={<Switch on={look.rm} label="Reduce motion" testID="look-rm" onChange={(v) => set("rm", v)} />} />
        <SettingsRow id="appearance.lang" label="Language" control={<Choice value={look.lang} label="Language" testID="look-lang" onChange={(v) => set("lang", v)} options={LANGUAGES.map((l) => ({ value: l, label: l }))} />} />
      </Section>
      <Text style={t.foot}>Text size, density and motion are the same in every Space.</Text>
      <Shortcuts found={found === "shortcuts"} />
      {dlg === "make" ? <MakeDialog onClose={() => setDlg(null)} onSave={(s) => { setDlg(null); const next = { ...withSkinAdded(look, s) }; const placed = choose(next, key, s.id) ?? next; save(placed, `Added ${s.name}`, look); }} /> : null}
      {dlg === "link" ? <LinkDialog onClose={() => setDlg(null)} onAdd={(s) => { setDlg(null); const next = withSkinAdded(look, s); save(choose(next, key, s.id) ?? next, `Added ${s.name}`, look); }} /> : null}
    </>
  );
}

function MakeDialog({ onClose, onSave }: { onClose(): void; onSave(s: CustomSkin): void }): ReactElement {
  const [name, setName] = useState("");
  const [base, setBase] = useState<"light" | "dark">("light");
  const [accent, setAccent] = useState<string>(ACCENTS[0]!);
  const [contrast, setContrast] = useState<Contrast>("standard");
  const sk = buildSkin(name, base, accent, contrast);
  return (
    <Overlay label="Make your own skin" onClose={onClose} testID="make-dialog">
      <View style={t.dlg}>
        <Text style={t.dlgTitle}>Make your own skin</Text>
        <Text style={t.dlgText}>Pick a base, an accent and the contrast. The preview updates as you go.</Text>
        <View style={{ alignItems: "center", marginVertical: 12 }}><Thumb palette={paletteOf(sk)} big /></View>
        <Text style={t.lab}>Name</Text>
        <TextInput accessibilityLabel="Skin name" testID="make-name" value={name} onChangeText={setName} placeholder="My skin" placeholderTextColor="var(--ink-4)" style={t.input} />
        <Text style={t.lab}>Base</Text>
        <Segmented value={base} label="Base" testID="make-base" onChange={(v) => setBase(v as "light" | "dark")} options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
        <Text style={t.lab}>Accent</Text>
        {/* ui-rows-lint: not a list (a row of colour swatches, one choice) */}
        <View style={t.swatches}>{ACCENTS.map((c) => <Pressable key={c} accessibilityRole="button" accessibilityLabel={`Accent ${c}`} testID={`make-accent-${c}`} onPress={() => setAccent(c)} style={[t.swatch, { backgroundColor: c }, accent === c && t.swatchOn, pointer]} />)}</View>
        <Text style={t.lab}>Contrast</Text>
        <Segmented value={contrast} label="Contrast" testID="make-contrast" onChange={(v) => setContrast(v as Contrast)} options={[{ value: "soft", label: "Soft" }, { value: "standard", label: "Standard" }, { value: "high", label: "High" }]} />
        <View style={t.acts}><SmallButton label="Cancel" onPress={onClose} /><SmallButton label="Save skin" primary testID="make-save" onPress={() => onSave(sk)} /></View>
      </View>
    </Overlay>
  );
}

function LinkDialog({ onClose, onAdd }: { onClose(): void; onAdd(s: CustomSkin): void }): ReactElement {
  const [text, setText] = useState("");
  const [found, setFound] = useState<CustomSkin | null>(null);
  const [error, setError] = useState("");
  const find = (): void => { const r = parseSkinLink(text); if (r.ok) { setFound(r.skin); setError(""); } else { setFound(null); setError(r.error); } };
  return (
    <Overlay label="Get a skin from a link" onClose={onClose} testID="link-dialog">
      <View style={t.dlg}>
        <Text style={t.dlgTitle}>Get a skin from a link</Text>
        <Text style={t.dlgText}>Paste the link someone sent you. Skins are only colours, so they are safe to add.</Text>
        <TextInput accessibilityLabel="Skin link" testID="link-text" value={text} onChangeText={(v) => { setText(v); setError(""); setFound(null); }} placeholder="vyre.run/skin/..." placeholderTextColor="var(--ink-4)" style={t.input} onSubmitEditing={find} />
        {error ? <Text accessibilityRole="alert" testID="link-error" style={t.err}>{error}</Text> : null}
        {found ? <View style={{ alignItems: "center", marginTop: 14 }}><Thumb palette={paletteOf(found)} big /><Text style={t.name}>{found.name}</Text><Text style={t.slotName}>{found.note}</Text></View> : null}
        <View style={t.acts}><SmallButton label="Cancel" onPress={onClose} />{found ? <SmallButton label="Add and use" primary testID="link-add" onPress={() => onAdd(found)} /> : <SmallButton label="Find skin" primary testID="link-find" onPress={find} />}</View>
      </View>
    </Overlay>
  );
}

const t = StyleSheet.create({
  pad: { padding: 12 },
  slots: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 },
  slot: { flex: 1, minWidth: 200, flexDirection: "row", alignItems: "center", gap: 12, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: "var(--line)" as string },
  slotOn: { borderColor: "var(--accent)" as string, borderWidth: 2 },
  slotLabel: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  slotName: { fontSize: 12, color: "var(--ink-3)" as string },
  foot: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-3)" as string, marginTop: 10, paddingHorizontal: 2 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 26, marginBottom: 10, paddingHorizontal: 2 },
  heading: { fontSize: 12.5, fontWeight: "600", color: "var(--ink-2)" as string },
  link: { fontSize: 12.5, color: "var(--accent)" as string },
  sub: { fontSize: 12.5, color: "var(--ink-3)" as string, marginTop: 14, marginBottom: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  tile: { width: "23%" as unknown as number, minWidth: 130, flexGrow: 1, padding: 8, borderRadius: 12, borderWidth: 1, borderColor: "var(--line)" as string, gap: 8 },
  tileOn: { borderColor: "var(--accent)" as string, borderWidth: 2 },
  tileName: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 },
  name: { fontSize: 12.5, fontWeight: "500", color: "var(--ink)" as string },
  found: { backgroundColor: "var(--accent-wash)" as string },
  thumb: { height: 62, flexDirection: "row", borderRadius: 8, borderWidth: 1, overflow: "hidden", width: 100 },
  thumbBig: { height: 120, width: 200 },
  side: { width: 26, padding: 5, gap: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  bar: { height: 4, borderRadius: 2 },
  main: { flex: 1, padding: 6, gap: 4, justifyContent: "flex-start" },
  msg: { height: 10, width: "55%", alignSelf: "flex-end", borderRadius: 4 },
  line: { height: 4, borderRadius: 2, width: "85%" },
  field: { marginTop: "auto" as unknown as number, height: 12, borderRadius: 4, borderWidth: 1, alignItems: "flex-end", justifyContent: "center", paddingRight: 3 },
  send: { width: 8, height: 6, borderRadius: 3 },
  dlg: { width: 360, maxWidth: "100%", borderRadius: 16, padding: 20, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line)" as string },
  dlgTitle: { fontSize: 16, fontWeight: "600", color: "var(--ink)" as string },
  dlgText: { fontSize: 13, lineHeight: 18, color: "var(--ink-3)" as string, marginTop: 4 },
  lab: { fontSize: 12, color: "var(--ink-3)" as string, marginTop: 14, marginBottom: 6 },
  input: { height: 34, borderRadius: 9, paddingHorizontal: 10, fontSize: 13.5, color: "var(--ink)" as string, backgroundColor: "var(--field)" as string, marginTop: 12 },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  swatch: { width: 24, height: 24, borderRadius: 12 },
  swatchOn: { borderWidth: 3, borderColor: "var(--ink)" as string },
  acts: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 18 },
  err: { fontSize: 12.5, color: "var(--danger)" as string, marginTop: 8 },
});
void effectiveSkin;
