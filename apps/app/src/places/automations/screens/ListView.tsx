// The left side as one list (design 2.6), from listView(): the head returns to the first page and carries the count of what needs him; one search; one list of shared ui/Row.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { menuTrigger } from "../../../../../../ui/src/Menu/index.tsx";
import { listView } from "../list/model.ts";
import type { ListRowIn } from "../list/model.ts";

const DOT = { amber: "var(--warn)", green: "var(--ok)", grey: "var(--ink-4)" } as const;

export function ListView({
  rows,
  onOpen,
  onHome,
  onNew,
  query,
  selectedId,
  onMenu,
  onFix,
}: {
  rows: readonly ListRowIn[];
  onOpen(id: string): void;
  onHome(): void;
  onNew?(): void;
  /** The shell sidebar supplies the one search and its own head: then this draws only the rows. */
  query?: string;
  selectedId?: string | null;
  /** The row's own menu: right-click, the keyboard's menu key, a long press on a phone. */
  onMenu?(id: string, x: number, y: number): void;
  /** The one button of a row that is missing something (Connect, Fix). */
  onFix?(id: string): void;
}): ReactElement {
  const [own, setOwn] = useState("");
  const q = query ?? own;
  const setQ = setOwn;
  const v = listView(rows, q);
  const row = (r: (typeof v.rows)[number]): ReactElement => (
    // ui-rows-lint: not a list (each item is a ui/Row; the View only carries the row's menu trigger)
    <View key={r.id} {...(onMenu ? menuTrigger((x, y) => onMenu(r.id, x, y)) : {})}>
      <Row
        id={`auto-${r.id}`}
        {...(selectedId === r.id ? { selected: true } : {})}
        title={r.name}
        leading={<View style={[s.dot, { backgroundColor: DOT[r.dot] as string }]} />}
        domProps={{ style: { minHeight: 34, ...(r.sentence ? { paddingTop: 6, paddingBottom: 6 } : {}) } }}
        // what it does, in one sentence, under its name; what it is missing leads that line in the warning colour
        {...(r.sentence ? { tall: true, note: r.sentence } : r.blocked ? { note: r.blocked.short } : {})}
        {...(r.blocked && r.sentence ? { noteLead: r.blocked.short, noteLeadTone: "warning" as const } : {})}
        {...(r.blocked && onFix
          ? {
              trailing: (
                <Pressable
                  testID={`al-fix-${r.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${r.blocked.button}: ${r.blocked.short}`}
                  onPress={(e) => {
                    (e as { stopPropagation?: () => void } | undefined)?.stopPropagation?.();
                    onFix(r.id);
                  }}
                  style={s.fix}
                >
                  <Text style={s.fixText}>{r.blocked.button}</Text>
                </Pressable>
              ),
            }
          : r.scope && r.scope !== "Journey"
            ? { trailing: <Text style={s.quiet}>{r.scope}</Text> }
            : {})}
        onPress={() => onOpen(r.id)}
      />
    </View>
  );
  const journeys = v.rows.filter((r) => r.scope === "Journey");
  return (
    <View style={s.col} testID="auto-list">
      {query !== undefined ? null : (
        <>
          <Pressable testID="al-home" accessibilityRole="button" onPress={onHome} style={s.head}>
            <Text style={s.title}>{v.head.title}</Text>
            {v.head.count > 0 ? <Text style={s.count}>{`${v.head.count} need you`}</Text> : null}
            <View style={{ flex: 1 }} />
            {onNew ? (
              <Pressable testID="al-new" accessibilityRole="button" accessibilityLabel="New automation" onPress={onNew}>
                <Text style={s.plus}>+</Text>
              </Pressable>
            ) : null}
          </Pressable>

          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search"
            placeholderTextColor="var(--ink-3)"
            accessibilityLabel="Search automations"
            testID="al-search"
            style={s.search}
          />
        </>
      )}
      {journeys.length > 0 ? (
        <View style={s.group} testID="al-journeys">
          <Text style={s.groupCap}>Journeys</Text>
          {journeys.map(row)}
        </View>
      ) : null}
      {v.rows.filter((r) => r.scope !== "Journey").map(row)}
      {/* the empty line sits under the list's own heading, never beside the page's Needs you block */}
      {v.empty && query !== undefined ? <Text style={s.title}>Automations</Text> : null}
      {v.empty ? <Text style={s.quiet}>{v.empty}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  group: { gap: 2, paddingBottom: 6 },
  groupCap: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: "var(--ink-3)" as string,
    paddingHorizontal: 8,
    paddingTop: 2,
    paddingBottom: 4,
  },
  col: { gap: 2, padding: 8 },
  head: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, height: 40 },
  title: { fontSize: 17, fontWeight: "600", color: "var(--ink)" as string },
  count: {
    fontSize: 12,
    fontWeight: "600",
    color: "var(--accent)" as string,
    backgroundColor: "var(--accent-wash)" as string,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 1,
    overflow: "hidden",
  },
  plus: { fontSize: 22, color: "var(--ink-2)" as string, paddingHorizontal: 6 },
  search: {
    height: 30,
    paddingHorizontal: 10,
    fontSize: 13,
    color: "var(--ink)" as string,
    borderRadius: 12,
    backgroundColor: "var(--sunk)" as string,
    marginBottom: 4,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  fix: {
    height: 24,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "var(--line)" as string,
    alignItems: "center",
    justifyContent: "center",
  },
  fixText: { fontSize: 12, fontWeight: "600", color: "var(--ink)" as string },
  quiet: { fontSize: 12, color: "var(--ink-3)" as string, paddingHorizontal: 8 },
});
