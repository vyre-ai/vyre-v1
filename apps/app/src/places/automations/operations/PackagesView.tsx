// Packages: a saved copy of an automation's definition, with no secrets, Vault values or run data in it.
// Export saves one. Import makes a Personal draft; the connections it needs are chosen from the importer's own, and what is left is listed.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { useAutomationsData } from "../canvas/data.tsx";
import type { AutomationsData } from "../canvas/data.tsx";
import { pointer } from "../canvas/parts.tsx";
import { EMPTY_PACKAGES_NEXT, PACKAGES_LINE } from "../chrome.ts";
import { packageItems } from "./read.ts";
import type { PackageItem } from "./read.ts";
import { Empty, Frame, ListRow, MenuButton, Status, useCall, v } from "./parts.tsx";

export interface Own { connectionId: string; title: string; connector: string }
export interface Source { id: string; name: string }

export function ownConnections(out: unknown): Own[] | null {
  const list = out && typeof out === "object" ? (out as { connections?: unknown }).connections : null;
  if (!Array.isArray(list)) return null;
  return list.flatMap((c) => {
    const x = c as { connectionId?: unknown; title?: unknown; connector?: unknown; state?: unknown };
    return typeof x?.connectionId === "string" && typeof x.title === "string" && x.state !== "paused"
      ? [{ connectionId: x.connectionId, title: x.title, connector: typeof x.connector === "string" ? x.connector : "" }] : [];
  });
}

export function sourcesOf(out: unknown): Source[] | null {
  const list = out && typeof out === "object" ? (out as { automations?: unknown }).automations : null;
  if (!Array.isArray(list)) return null;
  return list.flatMap((a) => { const x = a as { id?: unknown; name?: unknown }; return typeof x?.id === "string" && typeof x.name === "string" ? [{ id: x.id, name: x.name }] : []; });
}

/** The input an import sends: only slots the person has picked. */
export function importInput(pkg: PackageItem, picks: Readonly<Record<string, string>>): { packageId: string; connections?: Record<string, string> } {
  const chosen = Object.fromEntries(Object.entries(picks).filter(([slot]) => pkg.requires.connections.some((c) => c.slot === slot)));
  return { packageId: pkg.id, ...(Object.keys(chosen).length > 0 ? { connections: chosen } : {}) };
}

export function needsLines(needs: { connections: { label: string }[]; vault: string[]; keys: string[] }): string[] {
  return [
    ...needs.connections.map((c) => `${c.label}: choose one of your connections`),
    ...needs.vault.map((n) => `Vault item ${n}: add it to your Vault`),
    ...needs.keys.map((s) => `Step ${s}: choose your own AI key`),
  ];
}

export interface ImportNote { text: string; open?: string; left?: string[] }

/** Import a package with the connections the person chose, and say what is left for them to connect. */
export async function importPackageNow(data: Pick<AutomationsData, "call">, pkg: PackageItem, picks: Readonly<Record<string, string>>): Promise<ImportNote> {
  const out = await data.call("automations.packages.import", importInput(pkg, picks)) as { automation?: { id?: string; name?: string }; needs?: { connections: { label: string }[]; vault: string[]; keys: string[] } };
  const id = out.automation?.id;
  return { text: `Draft ${out.automation?.name ?? pkg.name} is in your Personal automations.`, ...(id ? { open: id } : {}), ...(out.needs ? { left: needsLines(out.needs) } : {}) };
}

export async function exportPackageNow(data: Pick<AutomationsData, "call">, source: Source): Promise<string> {
  await data.call("automations.packages.export", { automationId: source.id });
  return `Saved a package of ${source.name}. It holds the steps only, with no secrets.`;
}

export function PackageDetail({ pkg, own, picks, onPick, onImport, busy }: {
  pkg: PackageItem; own: readonly Own[]; picks: Readonly<Record<string, string>>; onPick(slot: string, id: string | null): void; onImport(): void; busy: boolean;
}): ReactElement {
  const lines = needsLines({ connections: pkg.requires.connections.filter((c) => !picks[c.slot]), vault: pkg.requires.vault, keys: pkg.requires.keys });
  return (
    <View testID={`package-detail-${pkg.id}`} style={[v.detail, { marginLeft: 12 }]}>
      <Text style={v.section}>Connections</Text>
      {pkg.requires.connections.length === 0 ? <Text style={v.dim}>This package needs none.</Text> : null}
      {pkg.requires.connections.map((c) => {
        const chosen = own.find((o) => o.connectionId === picks[c.slot]);
        const entries: MenuEntry[] = [
          ...own.map((o): MenuEntry => ({ label: `${o.title}${o.connector ? ` (${o.connector})` : ""}`, checked: o.connectionId === picks[c.slot], onSelect: () => onPick(c.slot, o.connectionId) })),
          ...(own.length === 0 ? [{ head: "You have no connections yet" } as MenuEntry] : []),
          ...(picks[c.slot] ? [{ separator: true } as MenuEntry, { label: "Choose later", onSelect: () => onPick(c.slot, null) } as MenuEntry] : []),
        ];
        return (
          <View key={c.slot} style={v.actions}>
            <Text style={v.row}>{`${c.label}${c.stepIds.length ? `, used by step ${c.stepIds.join(", ")}` : ""}`}</Text>
            <MenuButton testID={`slot-${c.slot}`} label={chosen ? chosen.title : "Choose a connection"} entries={entries} />
          </View>
        );
      })}
      {pkg.requires.vault.length > 0 ? <Text style={v.dim}>{`Vault names it reads: ${pkg.requires.vault.join(", ")}. Add them to your Vault after importing.`}</Text> : null}
      {pkg.requires.keys.length > 0 ? <Text style={v.dim}>{`Steps that need your own AI key: ${pkg.requires.keys.join(", ")}.`}</Text> : null}
      {lines.length > 0 ? <Text testID={`package-left-${pkg.id}`} style={v.dim}>{`Still to do after importing: ${lines.length}`}</Text> : <Text style={v.dim}>Everything is connected.</Text>}
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} testID={`import-${pkg.id}`} onPress={onImport} style={[v.btnPrimary, pointer]}>
        <Text style={v.btnPrimaryText}>Import as a draft</Text>
      </Pressable>
    </View>
  );
}

export function Packages(): ReactElement {
  const data = useAutomationsData();
  const [again, setAgain] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<ImportNote | null>(null);
  const packages = useCall("automations.packages.list", {}, packageItems, again);
  const sources = useCall("automations.list", { limit: 100 }, sourcesOf, again);
  const mine = useCall("connections.list", { whose: "all", limit: 200 }, ownConnections);
  const own = mine.phase === "ready" ? mine.value : [];
  const fail = (e: unknown, fallback: string): void => setNote({ text: e instanceof Error ? e.message : fallback });

  async function exportOne(s: Source): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      setNote({ text: await exportPackageNow(data, s) });
      setAgain((n) => n + 1);
    } catch (e) { fail(e, "That automation was not exported."); } finally { setBusy(false); }
  }
  async function importOne(pkg: PackageItem): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      setNote(await importPackageNow(data, pkg, picks[pkg.id] ?? {}));
    } catch (e) { fail(e, "That package was not imported."); } finally { setBusy(false); }
  }

  const exportEntries: MenuEntry[] = sources.phase === "ready" && sources.value.length > 0
    ? sources.value.map((s): MenuEntry => ({ label: s.name, onSelect: () => void exportOne(s) }))
    : [{ head: "No automations to export yet" }];
  const rows = packages.phase === "ready" ? packages.value : [];
  return (
    <Frame testID="packages" title="Packages" line={PACKAGES_LINE} actions={<MenuButton testID="package-export" label="Export an automation" entries={exportEntries} icon="plus" />}>
      <Status state={packages} />
      {note ? (
        <View testID="package-note" style={v.stack} accessibilityLiveRegion="polite">
          <Text style={v.row}>{note.text}</Text>
          {note.left && note.left.length > 0 ? note.left.map((l) => <Text key={l} style={v.dim}>{l}</Text>) : null}
          {note.open ? <Pressable accessibilityRole="button" testID="package-open-draft" onPress={() => data.nav.openAutomation(note.open!)} style={[v.btn, pointer]}><Text style={v.row}>Open the draft</Text></Pressable> : null}
        </View>
      ) : null}
      {packages.phase === "ready" && rows.length === 0 ? <Empty testID="packages-empty" title="No packages yet" next={EMPTY_PACKAGES_NEXT} /> : null}
      <View style={v.list}>
        {/* ui-rows-lint: ListRow is the row */}
        {rows.map((p) => (
          <View key={p.id}>
            <ListRow testID={`package-${p.id}`} selected={picked === p.id} label={`${p.name}, saved ${new Date(p.createdAt).toISOString().slice(0, 10)}. ${picked === p.id ? "Hide" : "Show"} what it needs`}
              onPress={() => setPicked(picked === p.id ? null : p.id)}
              menu={() => [
                { label: picked === p.id ? "Hide what it needs" : "Show what it needs", onSelect: () => setPicked(picked === p.id ? null : p.id) },
                { label: "Import as a draft", onSelect: () => void importOne(p) },
              ]}>
              <View style={v.lineMain}>
                <Text style={v.row} numberOfLines={1}>{p.name}</Text>
                <Text style={v.dim}>{p.requires.connections.length === 0 ? "No connections needed" : `${p.requires.connections.length} ${p.requires.connections.length === 1 ? "connection" : "connections"} to choose`}</Text>
              </View>
              <Text style={v.right}>{new Date(p.createdAt).toISOString().slice(0, 10)}</Text>
            </ListRow>
            {picked === p.id ? (
              <PackageDetail pkg={p} own={own} picks={picks[p.id] ?? {}} busy={busy} onImport={() => void importOne(p)}
                onPick={(slot, id) => setPicks((cur) => {
                  const next = { ...(cur[p.id] ?? {}) };
                  if (id) next[slot] = id; else delete next[slot];
                  return { ...cur, [p.id]: next };
                })} />
            ) : null}
          </View>
        ))}
      </View>
    </Frame>
  );
}
