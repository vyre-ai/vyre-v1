// What the automations name: other automations, connections, mailboxes, forms and more. The server reads the saved definitions; this draws the answer.
// Pick a row to see which automations and steps use it, so a change is checked before it is made.
import { useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { useAutomationsData } from "../canvas/data.tsx";
import { DEPS_LINE, EMPTY_DEPENDENCIES_NEXT } from "../chrome.ts";
import { Dot } from "../canvas/parts.tsx";
import { ConnectorTrust } from "./ConnectorTrust.tsx";
import { depsOf, countBy } from "./read.ts";
import type { DepItem } from "./read.ts";
import { filterLabel, filterMenu } from "./menus.ts";
import { Empty, Frame, ListRow, MenuButton, Status, useCall, v } from "./parts.tsx";

const KIND_WORD: Record<string, string> = {
  automation: "Automations", journey: "Journeys", connection: "Connections", mailbox: "Mailboxes", number: "Numbers", form: "Forms", channel: "Channels", record: "Records",
  file: "Files", folder: "Folders", project: "Projects", site: "Sites", kit: "Kits", campaign: "Campaigns", person: "People", group: "Groups", agent: "Agents",
};
export const kindWord = (kind: string): string => KIND_WORD[kind] ?? kind;
const problemWords = (p: DepItem["problem"]): string | null => (p === "missing" ? "Missing" : p === "off" ? "Off" : null);

/** What the list shows once the filters are applied. */
export function shownItems(items: readonly DepItem[], kinds: ReadonlySet<string>, onlyProblems: boolean): DepItem[] {
  return items.filter((i) => (kinds.size === 0 || kinds.has(i.kind)) && (!onlyProblems || i.problem !== null));
}

export function depMenu(item: DepItem, on: { show(ref: string): void; open(id: string): void; copy(text: string): void; onlyKind(kind: string): void }): MenuEntry[] {
  return [
    { label: "Show who uses this", onSelect: () => on.show(item.ref) },
    ...(item.kind === "automation" && item.problem !== "missing" ? [{ label: "Open this automation", onSelect: () => on.open(item.ref) } as MenuEntry] : []),
    ...item.usedBy.slice(0, 5).map((u): MenuEntry => ({ label: `Open ${u.name}`, onSelect: () => on.open(u.automationId) })),
    { separator: true },
    { label: "Copy the id", onSelect: () => on.copy(item.ref) },
    { label: `Only ${kindWord(item.kind).toLowerCase()}`, onSelect: () => on.onlyKind(item.kind) },
  ];
}

export function DependencyList({ items, onOpen, copy, initialPicked = null }: { items: readonly DepItem[]; onOpen(id: string): void; copy(text: string): void; initialPicked?: string | null }): ReactElement {
  const [kinds, setKinds] = useState<ReadonlySet<string>>(new Set());
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [picked, setPicked] = useState<string | null>(initialPicked);
  const toggle = (k: string): void => setKinds((cur) => { const n = new Set(cur); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const problems = items.filter((i) => i.problem !== null).length;
  const shown = shownItems(items, kinds, onlyProblems);
  const kindEntries = filterMenu("All kinds", countBy(items, (i) => i.kind).map((c) => ({ value: c.value, label: kindWord(c.value), count: c.count })), kinds, toggle, () => setKinds(new Set()));
  const showEntries: MenuEntry[] = [
    { label: "Everything", checked: !onlyProblems, count: items.length, onSelect: () => setOnlyProblems(false) },
    { label: "Only missing or off", checked: onlyProblems, count: problems, onSelect: () => setOnlyProblems(true) },
  ];
  return (
    <View testID="dependency-list" style={v.stack}>
      <View style={v.actions}>
        <MenuButton testID="deps-kind" label={filterLabel("Kind", kinds, kindWord)} entries={kindEntries} />
        <MenuButton testID="deps-show" label={onlyProblems ? "Only missing or off" : "Everything"} entries={showEntries} />
      </View>
      {shown.length === 0 ? <Text style={v.dim}>{onlyProblems ? "Nothing is missing or off." : "Nothing of that kind."}</Text> : null}
      <View style={v.list}>
        {/* ui-rows-lint: ListRow is the row */}
        {shown.map((item) => {
          const open = picked === item.ref;
          const bad = problemWords(item.problem);
          return (
            <View key={`${item.kind}:${item.ref}`}>
              <ListRow testID={`dep-${item.ref}`} selected={open} label={`${kindWord(item.kind)} ${item.ref}, used by ${item.usedBy.length}${bad ? `, ${bad.toLowerCase()}` : ""}`}
                onPress={() => setPicked(open ? null : item.ref)} menu={() => depMenu(item, { show: setPicked, open: onOpen, copy, onlyKind: (k) => setKinds(new Set([k])) })}>
                <Dot tone={item.problem === "missing" ? "danger" : item.problem === "off" ? "warn" : "ok"} />
                <View style={v.lineMain}>
                  <Text style={v.row} numberOfLines={1}>{item.ref}</Text>
                  <Text style={v.dim}>{item.kind}</Text>
                </View>
                {bad ? <Text style={item.problem === "missing" ? v.tag : v.tagWarn}>{bad}</Text> : null}
                <Text style={v.right}>{`${item.usedBy.length} ${item.usedBy.length === 1 ? "use" : "uses"}`}</Text>
              </ListRow>
              {open ? (
                <View testID={`dep-used-${item.ref}`} style={[v.detail, { marginLeft: 28 }]}>
                  <Text style={v.section}>Used by</Text>
                  {/* ui-rows-lint: ListRow is the row */}
                  {item.usedBy.map((u) => (
                    <ListRow key={u.automationId} testID={`dep-user-${u.automationId}`} label={`Open ${u.name}`} onPress={() => onOpen(u.automationId)}>
                      <View style={v.lineMain}>
                        <Text style={v.row} numberOfLines={1}>{u.name}</Text>
                        <Text style={v.dim}>{u.stepIds.length > 0 ? `Step ${u.stepIds.join(", ")}` : "Its trigger"}</Text>
                      </View>
                      <Text style={v.right}>{u.status}</Text>
                    </ListRow>
                  ))}
                  {item.problem === "missing" ? <Text style={v.dim}>This is not there any more. Open the automations listed above and choose another one in the step.</Text> : null}
                  {item.problem === "off" ? <Text style={v.dim}>This automation is not on, so anything that calls it waits or fails.</Text> : null}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

export function Dependencies(): ReactElement {
  const data = useAutomationsData();
  const state = useCall("automations.dependencies", {}, depsOf);
  const copy = (text: string): void => { void (globalThis as { navigator?: { clipboard?: { writeText(s: string): Promise<void> } } }).navigator?.clipboard?.writeText(text).catch(() => undefined); };
  return (
    <Frame testID="dependencies" title="Dependencies" line={DEPS_LINE}>
      <Status state={state} />
      {state.phase === "ready" && state.value.items.length === 0 ? (
        <Empty testID="deps-empty" title={state.value.automations === 0 ? "No automations yet" : "Nothing is named yet"} next={EMPTY_DEPENDENCIES_NEXT} />
      ) : null}
      {state.phase === "ready" && state.value.items.length > 0 ? <DependencyList items={state.value.items} onOpen={data.nav.openAutomation} copy={copy} /> : null}
      <ConnectorTrust />
    </Frame>
  );
}
