// Import into the Vault (spec 2.17): choose where the export came from, choose the file, read it, see what would happen, then import. Nothing changes until the last button. A duplicate is
// skipped, replaced or kept as you choose, and the result says how many of each. Choosing a file is the shell's job (`pickFile`); without it the sheet says so rather than guessing.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { VirtualList } from "../../../../../../ui/src/VirtualList/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { useVaultData } from "../layout/data.tsx";
import type { Folder } from "../layout/model.ts";
import { Btn, Glyph, LogoTile } from "../layout/parts.tsx";
import { Sheet } from "../layout/Sheet.tsx";
import { DEDUPE, SOURCES, planWords, previewLine, resultWords } from "./model.ts";
import type { Dedupe, Parsed, Source } from "./model.ts";

export interface ImportSheetProps {
  /** Folders the person can add to; the first is where the items go until they choose another. */
  folders: readonly Folder[];
  onClose(): void;
  /** The import finished; the place says so in its quiet line. */
  onDone(text: string): void;
  /** The source chosen at first render (the screenshot mounts and tests). */
  initialSource?: Source;
}

const PREVIEW_ROW = 44;
type Read = { fileId: string; items: readonly Parsed[] };

export function ImportSheet({ folders, onClose, onDone, initialSource }: ImportSheetProps): ReactElement {
  const data = useVaultData();
  const { element, show } = useMenu();
  const [source, setSource] = useState<Source | null>(initialSource ?? null);
  const [read, setRead] = useState<Read | null>(null);
  const [dedupe, setDedupe] = useState<Dedupe>("skip");
  const [folderId, setFolderId] = useState<string | undefined>(folders[0]?.id);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const def = SOURCES.find((x) => x.key === source) ?? null;
  const folder = folders.find((f) => f.id === folderId);
  const run = async (f: () => Promise<void>): Promise<void> => {
    setBusy(true); setLine(null);
    try { await f(); } catch (e) { setLine(e instanceof Error ? e.message : "That did not work."); }
    setBusy(false);
  };

  const choose = (): Promise<void> => run(async () => {
    if (!data.pickFile || !def) { setLine("Choosing a file is not available in this window."); return; }
    const fileId = await data.pickFile(def.accept);
    if (!fileId) return;
    const out = (await data.call("vault.import_parse", { source: def.key, fileId })) as { items: Parsed[] };
    setRead({ fileId, items: out.items });
  });
  const doImport = (): Promise<void> => run(async () => {
    if (!def || !read || !folderId) return;
    const out = (await data.call("vault.import", { source: def.key, fileId: read.fileId, folderId, dedupe, idempotencyKey: `import-${read.fileId}-${dedupe}-${folderId}` })) as { created: number; updated: number; skipped: number };
    onDone(`${def.name}: ${resultWords(out)}`);
    onClose();
  });
  const dedupeLabel = DEDUPE.find((d) => d.key === dedupe)?.label ?? "";
  const dedupeMenu = (e: unknown): void => {
    const ev = e as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } } };
    const r = ev.currentTarget?.getBoundingClientRect?.();
    const entries: MenuEntry[] = [{ head: "If it is already there" }];
    for (const d of DEDUPE) entries.push({ label: d.label, checked: d.key === dedupe, onSelect: () => setDedupe(d.key) });
    show(entries, r?.left ?? 0, (r?.bottom ?? 0) + 4, "other");
  };
  const folderMenu = (e: unknown): void => {
    const ev = e as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } } };
    const r = ev.currentTarget?.getBoundingClientRect?.();
    const entries: MenuEntry[] = [{ head: "Add to" }];
    for (const f of folders) entries.push({ label: f.name, checked: f.id === folderId, onSelect: () => setFolderId(f.id) });
    show(entries, r?.left ?? 0, (r?.bottom ?? 0) + 4, "other");
  };

  const footer = (
    <>
      {source ? <Btn label="Back" onPress={() => { setSource(null); setRead(null); setLine(null); }} testID="import-back" /> : null}
      <View style={{ flex: 1 }} />
      <Btn label="Cancel" onPress={onClose} testID="import-cancel" />
      {read ? <Btn label={busy ? "Importing" : "Import"} primary disabled={busy || read.items.length === 0 || !folderId} onPress={() => void doImport()} testID="import-go" /> : null}
    </>
  );

  return (
    <Sheet title={def ? `Import from ${def.name}` : "Import into the Vault"} onClose={onClose} footer={footer} testID="import-sheet">
      {!def ? (
        <View testID="import-sources" accessibilityLabel="Where the items are now">
          {SOURCES.map((x) => <Row key={x.key} id={`src:${x.key}`} title={x.name} note={x.file} leading={<View style={s.logo}><LogoTile name={x.name} size={30} /></View>} trailing={<Glyph name="chevron" size={11} />} onPress={() => setSource(x.key)} />)}
        </View>
      ) : !read ? (
        <View style={s.stack} testID="import-file">
          <Text style={s.lead}>{`${def.file}. It is read here, on this computer, and nothing is added until you press Import.`}</Text>
          <View style={s.left}><Btn label={busy ? "Reading" : "Choose the file"} icon="file" primary disabled={busy} onPress={() => void choose()} testID="import-choose" /></View>
        </View>
      ) : (
        <View style={s.stack} testID="import-preview">
          <Text style={s.lead} testID="import-plan">{planWords(read.items, dedupe)}</Text>
          <View style={s.row}>
            <Text style={s.k}>If it is already there</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`If it is already there: ${dedupeLabel}. Change`} testID="import-dedupe" onPress={dedupeMenu} style={s.chip}>
              <Text style={s.chipText}>{dedupeLabel}</Text><Glyph name="chevron" size={10} />
            </Pressable>
          </View>
          <View style={s.row}>
            <Text style={s.k}>Add to</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`Add to ${folder?.name ?? "a folder"}. Change`} testID="import-folder" onPress={folderMenu} style={s.chip}>
              <Text style={s.chipText}>{folder?.name ?? "Choose a folder"}</Text><Glyph name="chevron" size={10} />
            </Pressable>
          </View>
          <View style={s.list} accessibilityLabel="What the file holds">
            <VirtualList data={[...read.items]} rowHeight={PREVIEW_ROW} keyOf={(it) => `${(it as Parsed).name}:${(it as Parsed).kind}`} renderItem={(raw) => {
              const p = raw as Parsed;
              return <Row id={`imp:${p.name}`} title={p.name} note={previewLine(p)} leading={<View style={s.logo}><LogoTile name={p.name} size={28} /></View>} />;
            }} />
          </View>
        </View>
      )}
      {line ? <Text style={s.error} accessibilityLiveRegion="polite" testID="import-line">{line}</Text> : null}
      {element}
    </Sheet>
  );
}

const s = StyleSheet.create({
  stack: { gap: 12 },
  logo: { marginRight: 10 },
  lead: { fontSize: 13, lineHeight: 19, color: "var(--ink-2)" as string },
  left: { alignSelf: "flex-start", marginLeft: -4 },
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  k: { fontSize: 12, color: "var(--ink-3)" as string, marginRight: 4 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, height: 26, paddingHorizontal: 10, borderRadius: 7, backgroundColor: "var(--sel)" as string },
  chipText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  list: { height: 220, marginHorizontal: -8 },
  error: { fontSize: 12.5, color: "var(--danger)" as string },
});
