// Live Event Explorer: the newest events in this Space, read from the event log. Pick one to see who did it, what it touched and its payload.
// A sealed event shows that it happened and nothing inside it. The list refreshes by itself every few seconds while the view is open.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { useAutomationsData } from "../canvas/data.tsx";
import { TextButton } from "../canvas/parts.tsx";
import { EMPTY_EVENTS_NEXT, EVENTS_LINE, LISTENING } from "../chrome.ts";
import { countBy, eventItems } from "./read.ts";
import type { EventItem } from "./read.ts";
import { filterLabel, filterMenu } from "./menus.ts";
import { Empty, Frame, MenuButton, Row, Status, useCall, useRowMenu, v } from "./parts.tsx";

export const REFRESH_MS = 5000;
export const EVENT_LIMIT = 100;

/** The events a filter lets through. Nothing picked shows all of them. */
export function shownEvents(rows: readonly EventItem[], types: ReadonlySet<string>): EventItem[] {
  return types.size === 0 ? [...rows] : rows.filter((r) => types.has(r.type));
}

export function clockWords(at: number): string {
  const d = new Date(at);
  return Number.isFinite(d.getTime()) ? d.toISOString().replace("T", " ").slice(0, 19) + " UTC" : "";
}

/** Who did it, in words: the person's or agent's name when the Space lists them, else what kind of doer it was. An id is never the answer (the Console's pages show no raw id). */
export function whoWords(actor: string, names: ReadonlyMap<string, string> = new Map()): string {
  const n = names.get(actor);
  if (n) return n;
  if (actor.startsWith("usr_")) return "a person";
  if (actor.startsWith("agt_")) return "an agent";
  return "the system";
}

/** What an event is about, as its kind ("automation", "claim"); its id stays in the details and in Copy the event id. */
export function subjectWords(s: { type: string } | undefined): string {
  return s ? s.type.replace(/[._]+/g, " ").trim() : "";
}

/** id -> name from access.principals.list, for the "by" of each row. */
export function namesOf(out: unknown): Map<string, string> | null {
  const list = (out as { principals?: unknown } | null)?.principals;
  if (!Array.isArray(list)) return null;
  const m = new Map<string, string>();
  for (const r of list as Array<{ id?: unknown; name?: unknown }>)
    if (typeof r?.id === "string" && typeof r?.name === "string" && r.name !== "") m.set(r.id, r.name);
  return m;
}

export function payloadText(e: EventItem): string {
  if (e.sealed) return "Sealed. The event happened; what is inside it is not shown.";
  try {
    return JSON.stringify(e.payload, null, 2) ?? "null";
  } catch {
    return "The payload could not be shown.";
  }
}

export function eventMenu(
  e: EventItem,
  on: {
    isOpen: boolean;
    toggle(): void;
    onlyType(type: string): void;
    openRun(id: string): void;
    openAutomation(id: string): void;
    copy(text: string): void;
  },
): MenuEntry[] {
  return [
    { label: on.isOpen ? "Hide details" : "Show details", onSelect: on.toggle },
    { label: `Only ${e.type}`, onSelect: () => on.onlyType(e.type) },
    ...(e.runId ? [{ label: "Open the run", onSelect: () => on.openRun(e.runId!) } as MenuEntry] : []),
    ...(e.subject?.type === "automation"
      ? [{ label: "Open the automation", onSelect: () => on.openAutomation(e.subject!.id) } as MenuEntry]
      : []),
    { separator: true },
    { label: "Copy the event id", onSelect: () => on.copy(e.id) },
    ...(e.sealed ? [] : [{ label: "Copy the payload", onSelect: () => on.copy(payloadText(e)) } as MenuEntry]),
  ];
}

export function EventList({
  rows,
  onOpenRun,
  onOpenAutomation,
  copy,
  initialPicked = null,
  names,
}: {
  names?: ReadonlyMap<string, string> | undefined;
  rows: readonly EventItem[];
  onOpenRun(id: string): void;
  onOpenAutomation(id: string): void;
  copy(text: string): void;
  initialPicked?: string | null;
}): ReactElement {
  const [types, setTypes] = useState<ReadonlySet<string>>(new Set());
  const [picked, setPicked] = useState<string | null>(initialPicked);
  const rm = useRowMenu();
  const toggle = (t: string): void =>
    setTypes((cur) => {
      const n = new Set(cur);
      if (n.has(t)) n.delete(t);
      else n.add(t);
      return n;
    });
  const shown = shownEvents(rows, types);
  const entries = filterMenu(
    "All events",
    countBy(rows, (r) => r.type).map((c) => ({ value: c.value, count: c.count })),
    types,
    toggle,
    () => setTypes(new Set()),
  );
  return (
    <View testID="event-list" style={v.stack}>
      {rm.element}
      <View style={v.actions}>
        <MenuButton testID="events-type" label={filterLabel("Event type", types)} entries={entries} />
      </View>
      {shown.length === 0 ? <Text style={v.dim}>No event of that type in the latest {rows.length}.</Text> : null}
      <View style={v.list}>
        {shown.flatMap((e) => {
          const row = (
            <Row
              key={e.id}
              id={`event-${e.id}`}
              title={e.type}
              selected={picked === e.id}
              note={[subjectWords(e.subject), e.runId ? "in a run" : "", `by ${whoWords(e.actor, names)}`]
                .filter(Boolean)
                .join(" · ")}
              trailing={
                <View style={v.actions}>
                  {e.sealed ? <Text style={v.right}>Sealed</Text> : null}
                  <Text style={v.right}>{clockWords(e.at).slice(11, 19)}</Text>
                </View>
              }
              onPress={() => setPicked(picked === e.id ? null : e.id)}
              domProps={{
                "aria-label": `${e.type} at ${clockWords(e.at)}${e.sealed ? ", sealed" : ""}`,
                ...rm.rowDom(e.type, () =>
                  eventMenu(e, {
                    isOpen: picked === e.id,
                    toggle: () => setPicked(picked === e.id ? null : e.id),
                    onlyType: (t) => setTypes(new Set([t])),
                    openRun: onOpenRun,
                    openAutomation: onOpenAutomation,
                    copy,
                  }),
                ),
              }}
            />
          );
          if (picked !== e.id) return [row];
          return [
            row,
            <View key={`detail-${e.id}`} testID={`event-detail-${e.id}`} style={[v.detail, { marginLeft: 12 }]}>
              <Text style={v.dim}>{`${clockWords(e.at)} · by ${whoWords(e.actor, names)}`}</Text>
              <Text selectable style={v.mono}>
                {payloadText(e)}
              </Text>
              <View style={v.actions}>
                {e.runId ? (
                  <TextButton label="Open the run" onPress={() => onOpenRun(e.runId!)} testID={`event-run-${e.id}`} />
                ) : null}
                {e.subject?.type === "automation" ? (
                  <TextButton
                    label="Open the automation"
                    onPress={() => onOpenAutomation(e.subject!.id)}
                    testID={`event-auto-${e.id}`}
                  />
                ) : null}
              </View>
            </View>,
          ];
        })}
      </View>
    </View>
  );
}

export function LiveEvents(): ReactElement {
  const data = useAutomationsData();
  const [again, setAgain] = useState(0);
  const state = useCall("events.list", { limit: EVENT_LIMIT }, eventItems, again);
  useEffect(() => {
    const t = setInterval(() => setAgain((n) => n + 1), REFRESH_MS);
    return () => clearInterval(t);
  }, []);
  const copy = (text: string): void => {
    void (globalThis as { navigator?: { clipboard?: { writeText(s: string): Promise<void> } } }).navigator?.clipboard
      ?.writeText(text)
      .catch(() => undefined);
  };
  const rows = state.phase === "ready" ? state.value : null;
  const who = useCall("access.principals.list", {}, namesOf);
  const names = who.phase === "ready" ? who.value : undefined;
  return (
    <Frame
      testID="live-events"
      title="Event log"
      line={EVENTS_LINE}
      actions={
        <TextButton label="Refresh" icon="loop" onPress={() => setAgain((n) => n + 1)} testID="events-refresh" />
      }
    >
      {rows ? (
        <Text testID="events-listening" style={v.dim}>{`${LISTENING}. ${rows.length} latest events.`}</Text>
      ) : null}
      {state.phase === "error" ? <Status state={state} /> : null}
      {state.phase === "loading" ? <Status state={state} /> : null}
      {rows && rows.length === 0 ? (
        <Empty testID="events-empty" title="No events yet" next={EMPTY_EVENTS_NEXT} />
      ) : null}
      {rows && rows.length > 0 ? (
        <EventList
          rows={rows}
          names={names}
          onOpenRun={data.nav.openRun}
          onOpenAutomation={data.nav.openAutomation}
          copy={copy}
        />
      ) : null}
    </Frame>
  );
}
