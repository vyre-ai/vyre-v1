// Watching (Vyre for Chrome): the pages, and the parts of pages, that an agent or the person's own Chrome checks on a rhythm. A row shows the page, how often and when it last changed;
// opening it shows what it was and what it is now, who checks it and where. Check now, Pause and Remove are real calls (automations.watches.*). A watch can feed a goal as its progress.
import { useState } from "react";
import { Pressable, StyleSheet, useWindowDimensions } from "react-native";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { useAutomationsData } from "../canvas/data.tsx";
import { Glyph } from "../canvas/icons.tsx";
import { IconButton, pointer } from "../canvas/parts.tsx";
import { EMPTY_WATCHING_NEXT, WATCHING_LINE } from "../chrome.ts";
import { everyWords, lastWords, tellWords, watchItems, watchNote } from "./read.ts";
import type { WatchItem } from "./read.ts";
import { Empty, Frame, Status, useCall, useRowMenu, v } from "./parts.tsx";

/** The menu a watch's row opens. */
export function watchMenu(w: WatchItem, on: { toggle(): void; check(): void; remove(): void; open(): void; page(): void }, open: boolean): MenuEntry[] {
  return [
    { label: open ? "Hide details" : "Show details", onSelect: on.open },
    { label: "Check now", onSelect: on.check, ...(w.state === "paused" ? { disabled: true } : {}) },
    { label: w.state === "paused" ? "Resume" : "Pause", onSelect: on.toggle },
    { label: "Open the page", onSelect: on.page },
    { separator: true },
    { label: "Remove", danger: true, onSelect: on.remove },
  ];
}

/** What a watch shows when it is opened. */
export function WatchDetail({ w, agent, goal = "" }: { w: WatchItem; agent: string; goal?: string }): ReactElement {
  return (
    <View testID={`watch-detail-${w.id}`} style={[v.detail, { marginLeft: 12 }]}>
      <Text style={v.dim}>{w.mode === "region" && w.region ? `Checks ${w.region.toLowerCase()} on ${w.host}.` : `Checks any change on ${w.host}.`}</Text>
      <Text style={v.dim}>{w.runsOn === "computer" ? `${agent} checks it on their computer, signed in with the Vault.` : "Your Chrome checks it in the background while it is open."}</Text>
      <Text style={v.dim}>{w.changes === 0 ? "It has not changed yet." : `It has changed ${w.changes} ${w.changes === 1 ? "time" : "times"}.`}</Text>
      {w.lastChange ? (
        <View testID={`watch-change-${w.id}`} style={v.stack}>
          <Text style={v.section}>Before</Text>
          <Text style={v.row}>{w.lastChange.before || "(nothing)"}</Text>
          <Text style={v.section}>Now</Text>
          <Text style={v.row}>{w.lastChange.after || "(nothing)"}</Text>
        </View>
      ) : <Text style={v.dim}>{w.value ? `It reads: ${w.value.slice(0, 160)}` : "It has not read the page yet."}</Text>}
      {goal ? <Text testID={`watch-goal-${w.id}`} style={v.dim}>{`Feeds the goal "${goal}": the number it reads is the goal's progress.`}</Text> : null}
      {w.error ? <Text style={v.err}>{w.error}</Text> : null}
    </View>
  );
}

/** `initialOpen`: the watch that starts opened (the proof mount shows one open). */
export function Watching({ initialOpen = null }: { initialOpen?: string | null } = {}): ReactElement {
  const data = useAutomationsData();
  const [again, setAgain] = useState(0);
  const [picked, setPicked] = useState<string | null>(initialOpen);
  const [note, setNote] = useState<string | null>(null);
  const rm = useRowMenu();
  const list = useCall("automations.watches.list", {}, watchItems, again);
  const rows = list.phase === "ready" ? list.value : [];
  const agent = (id: string): string => (id ? data.name(id) : "An agent");
  const refresh = (): void => setAgain((n) => n + 1);
  const run = async (what: () => Promise<unknown>, done?: string): Promise<void> => {
    try { await what(); setNote(done ?? null); } catch (e) { setNote(e instanceof Error ? e.message : "That did not work."); }
    refresh();
  };
  const now = data.clock().now;
  const wide = useWindowDimensions().width >= 760;
  const goals = useCall("goals.list", { scope: "mine" }, (out) => { const o = out as { goals?: { id: string; title: string }[] } | null; return o && Array.isArray(o.goals) ? o.goals : null; });
  const goalTitle = (id: string): string => (goals.phase === "ready" ? goals.value.find((g) => g.id === id)?.title : undefined) ?? "a goal";
  return (
    <Frame testID="watching" title="Watching" line={WATCHING_LINE}>
      <Status state={list} />
      {note ? <Text testID="watching-note" style={v.dim} accessibilityLiveRegion="polite">{note}</Text> : null}
      {list.phase === "ready" && rows.length === 0 ? <Empty testID="watching-empty" title="Nothing is being watched" next={EMPTY_WATCHING_NEXT} icon="search" /> : null}
      {rm.element}
      {rows.length > 0 ? (
        <View testID="watch-table" accessibilityRole="table" style={w2.table}>
          {wide ? (
            <View style={w2.head} accessibilityRole="row">
              <Text style={[w2.th, w2.cName]}>Watch</Text><Text style={[w2.th, w2.cRun]}>Runs on</Text><Text style={[w2.th, w2.cEvery]}>Every</Text><Text style={[w2.th, w2.cLast]}>Last</Text><Text style={[w2.th, w2.cTell]}>Tells</Text><View style={w2.cAct} />
            </View>
          ) : null}
          {/* ui-rows-lint: not a list (a table: one row per watch, a column each for where it runs, how often, when it last changed and who hears of it) */}
          {rows.flatMap((w) => {
            const isOpen = picked === w.id;
            const on = w.state === "on";
            const where = w.runsOn === "computer" ? `${agent(w.agentId)}'s computer` : "My Chrome";
            const menu = (): MenuEntry[] => watchMenu(w, {
              open: () => setPicked(isOpen ? null : w.id),
              check: () => void run(() => data.call("automations.watches.check", { watchId: w.id }), w.runsOn === "computer" ? `${agent(w.agentId)} will check it now.` : "Your Chrome will check it within a minute."),
              toggle: () => void run(() => data.call("automations.watches.remove", { watchId: w.id, op: w.state === "paused" ? "resume" : "pause" })),
              remove: () => void run(() => data.call("automations.watches.remove", { watchId: w.id, op: "remove" }), "Removed."),
              page: () => { const g = globalThis as { open?: (u: string) => unknown }; if (/^https?:/i.test(w.url)) g.open?.(w.url); },
            }, isOpen);
            const row = (
              <Pressable
                key={w.id} testID={`watch-${w.id}`} accessibilityRole="button" accessibilityState={{ selected: isOpen }} accessibilityLabel={`${w.title}. ${watchNote(w, now)}. ${isOpen ? "Hide" : "Show"} details`}
                onPress={() => setPicked(isOpen ? null : w.id)} style={[w2.row, isOpen && w2.rowOn, pointer]} {...rm.rowDom(w.title, menu)}
              >
                <View style={[w2.cName, w2.name]}>
                  <Glyph name="eye" size={15} color="var(--ink-3)" />
                  <View style={w2.nameText}>
                    <Text style={[v.row, !on && w2.off]} numberOfLines={1}>{w.title}</Text>
                    <Text style={v.dim} numberOfLines={1}>{wide ? (w.mode === "region" && w.region ? w.region : "Any change") : watchNote(w, now)}</Text>
                  </View>
                </View>
                {wide ? (
                  <>
                    <View style={[w2.cRun, w2.name]}><Glyph name={w.runsOn === "computer" ? "server" : "monitor"} size={13} color="var(--ink-3)" /><Text style={v.dim} numberOfLines={1}>{where}</Text></View>
                    <Text style={[v.dim, w2.cEvery]} numberOfLines={1}>{on ? everyWords(w.everyMinutes).replace("Every ", "") : "Paused"}</Text>
                    <Text style={[v.dim, w2.cLast]} numberOfLines={1}>{lastWords(w, now)}</Text>
                    <Text style={[v.dim, w2.cTell]} numberOfLines={1}>{tellWords(w, agent)}</Text>
                  </>
                ) : <Text style={[v.dim, w2.phoneRun]} numberOfLines={1}>{where}</Text>}
                <View style={w2.cAct}>
                  <IconButton icon={on ? "pause" : "play"} label={on ? `Pause ${w.title}` : `Resume ${w.title}`} size={24} onPress={() => void run(() => data.call("automations.watches.remove", { watchId: w.id, op: on ? "pause" : "resume" }))} />
                </View>
              </Pressable>
            );
            return isOpen ? [row, <WatchDetail key={`detail-${w.id}`} w={w} agent={agent(w.agentId)} goal={w.goalId ? goalTitle(w.goalId) : ""} />] : [row];
          })}
        </View>
      ) : null}
    </Frame>
  );
}

const w2 = StyleSheet.create({
  table: { gap: 0 },
  head: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  th: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string },
  row: { flexDirection: "row", alignItems: "center", minHeight: 52, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, gap: 8 },
  rowOn: { backgroundColor: "var(--accent-wash)" as string },
  cName: { flex: 3, minWidth: 0 }, cRun: { flex: 2, minWidth: 0 }, cEvery: { flex: 1, minWidth: 0 }, cLast: { flex: 1.6, minWidth: 0 }, cTell: { flex: 2, minWidth: 0 }, cAct: { width: 34, alignItems: "flex-end" },
  name: { flexDirection: "row", alignItems: "center", gap: 8 },
  nameText: { flex: 1, minWidth: 0, gap: 1 },
  off: { color: "var(--ink-3)" as string },
  phoneRun: { maxWidth: 110 },
});
