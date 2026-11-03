// Watching (Vyre for Chrome): the pages, and the parts of pages, that an agent or the person's own Chrome checks on a rhythm. A row shows the page, how often and when it last changed;
// opening it shows what it was and what it is now, who checks it and where. Check now, Pause and Remove are real calls (browser.watches.*). A watch can feed a goal as its progress.
import { useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { useAutomationsData } from "../canvas/data.tsx";
import { Glyph } from "../canvas/icons.tsx";
import { EMPTY_WATCHING_NEXT, WATCHING_LINE } from "../chrome.ts";
import { watchItems, watchNote } from "./read.ts";
import type { WatchItem } from "./read.ts";
import { Empty, Frame, Row, Status, useCall, useRowMenu, v } from "./parts.tsx";

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
export function WatchDetail({ w, agent }: { w: WatchItem; agent: string }): ReactElement {
  return (
    <View testID={`watch-detail-${w.id}`} style={[v.detail, { marginLeft: 12 }]}>
      <Text style={v.dim}>{w.mode === "region" && w.region ? `Checks ${w.region.toLowerCase()} on ${w.host}.` : `Checks any change on ${w.host}.`}</Text>
      <Text style={v.dim}>{w.runsOn === "computer" ? `${agent} checks it on their computer, signed in with the Vault.` : "Your Chrome checks it in the background while it is open."}</Text>
      {w.lastChange ? (
        <View testID={`watch-change-${w.id}`} style={v.stack}>
          <Text style={v.section}>Before</Text>
          <Text style={v.row}>{w.lastChange.before || "(nothing)"}</Text>
          <Text style={v.section}>Now</Text>
          <Text style={v.row}>{w.lastChange.after || "(nothing)"}</Text>
        </View>
      ) : <Text style={v.dim}>{w.value ? `It reads: ${w.value.slice(0, 160)}` : "It has not read the page yet."}</Text>}
      {w.error ? <Text style={v.err}>{w.error}</Text> : null}
    </View>
  );
}

export function Watching(): ReactElement {
  const data = useAutomationsData();
  const [again, setAgain] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const rm = useRowMenu();
  const list = useCall("browser.watches.list", {}, watchItems, again);
  const rows = list.phase === "ready" ? list.value : [];
  const agent = (id: string): string => (id ? data.name(id) : "An agent");
  const refresh = (): void => setAgain((n) => n + 1);
  const run = async (what: () => Promise<unknown>, done?: string): Promise<void> => {
    try { await what(); setNote(done ?? null); } catch (e) { setNote(e instanceof Error ? e.message : "That did not work."); }
    refresh();
  };
  const now = data.clock().now;
  return (
    <Frame testID="watching" title="Watching" line={WATCHING_LINE}>
      <Status state={list} />
      {note ? <Text testID="watching-note" style={v.dim} accessibilityLiveRegion="polite">{note}</Text> : null}
      {list.phase === "ready" && rows.length === 0 ? <Empty testID="watching-empty" title="Nothing is being watched" next={EMPTY_WATCHING_NEXT} icon="search" /> : null}
      {rm.element}
      <View style={v.list}>
        {rows.flatMap((w) => {
          const isOpen = picked === w.id;
          const row = (
            <Row
              key={w.id} id={`watch-${w.id}`} title={w.title} note={watchNote(w, now)} selected={isOpen} tall
              leading={<View style={{ width: 22, alignItems: "center", justifyContent: "center" }}><Glyph name={w.runsOn === "computer" ? "panel" : "record"} size={15} color="var(--ink-3)" /></View>}
              trailing={w.changes > 0 ? <Text style={v.right}>{`${w.changes} ${w.changes === 1 ? "change" : "changes"}`}</Text> : undefined}
              onPress={() => setPicked(isOpen ? null : w.id)}
              domProps={{
                "aria-label": `${w.title}. ${watchNote(w, now)}. ${isOpen ? "Hide" : "Show"} details`,
                ...rm.rowDom(w.title, () => watchMenu(w, {
                  open: () => setPicked(isOpen ? null : w.id),
                  check: () => void run(() => data.call("browser.watches.check", { watchId: w.id }), w.runsOn === "computer" ? `${agent(w.agentId)} will check it now.` : "Your Chrome will check it within a minute."),
                  toggle: () => void run(() => data.call("browser.watches.remove", { watchId: w.id, op: w.state === "paused" ? "resume" : "pause" })),
                  remove: () => void run(() => data.call("browser.watches.remove", { watchId: w.id, op: "remove" }), "Removed."),
                  page: () => { const g = globalThis as { open?: (u: string) => unknown }; if (/^https?:/i.test(w.url)) g.open?.(w.url); },
                }, isOpen)),
              }}
            />
          );
          return isOpen ? [row, <WatchDetail key={`detail-${w.id}`} w={w} agent={agent(w.agentId)} />] : [row];
        })}
      </View>
    </Frame>
  );
}
