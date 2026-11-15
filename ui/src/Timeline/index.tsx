// ui/Timeline: the one Activity list. A story, newest first: a marker on a hairline rail (a face for what a person or agent did, a mark for what happened), one line in words, the time at the right (ui/Time), a
// chevron when there is more. Pressing a line with more opens it in place: the whole text and, when it leads somewhere, one quiet button. A small system line is one quiet line and does nothing. There are no day
// headings (the time is the date), no pills and no filters. The entries are made by lib/words/timeline.ts; this draws them, for a goal, a task, a project and a record alike.
import { createElement, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { TimelineEntry, TimelineIcon } from "../../../lib/words/timeline.ts";
import { Avatar } from "../Avatar/index.tsx";
import { dateIn } from "../../../lib/zones.ts";
import { When, useZones } from "../Time/index.tsx";

export type { TimelineEntry } from "../../../lib/words/timeline.ts";

const PATHS: Readonly<Record<TimelineIcon, readonly string[]>> = {
  flag: ["M4 14V2.5", "M4 3h8l-1.6 2.6L12 8.2H4"],
  play: ["M5.5 3.8l6.5 4.2-6.5 4.2z"],
  ask: ["M8 14a6 6 0 100-12 6 6 0 000 12z", "M6.4 6.4a1.7 1.7 0 113 .9c-.5.5-1.4.8-1.4 1.7", "M8 11.3v.01"],
  check: ["M3 8.5l3 3 7-7"],
  pulse: ["M2 8.5h2.4l1.6-4 2.6 8 1.8-4H14"],
  warn: ["M8 2.5l6 10.5H2z", "M8 6.5v3M8 11.3v.01"],
  edit: ["M10.8 2.7l2.5 2.5L6.5 12 3.5 12.5 4 9.5z"],
  plan: ["M3 4.5h10M3 8h10M3 11.5h6"],
  file: ["M4 2.5h5l3 3v8H4z", "M9 2.5v3h3"],
  money: ["M8 14a6 6 0 100-12 6 6 0 000 12z", "M8 4.8v6.4M9.8 6.3H7.4a1 1 0 000 2h1.2a1 1 0 010 2H6.2"],
  dot: ["M8 8h.01"],
};

function Mark({ icon, color, size = 13 }: { icon: TimelineIcon; color: string; size?: number }): ReactElement | null {
  if (Platform.OS !== "web") return null;
  return createElement(
    "svg",
    {
      viewBox: "0 0 16 16",
      width: size,
      height: size,
      "aria-hidden": true,
      style: {
        display: "block",
        flex: "none",
        fill: "none",
        stroke: color,
        strokeWidth: 1.5,
        strokeLinecap: "round",
        strokeLinejoin: "round",
      },
    },
    ...PATHS[icon].map((d) => createElement("path", { key: d, d })),
  );
}

const TONE: Record<TimelineEntry["tier"], string> = {
  milestone: "var(--accent)",
  checkin: "var(--ink-2)",
  action: "var(--ink-2)",
  problem: "var(--warn)",
  beat: "var(--ink-3)",
  quiet: "var(--ink-4)",
};

export interface TimelineProps {
  entries: readonly TimelineEntry[];
  /** a name for any id: the reader's directory */
  nameOf(id: string): string;
  now: number;
  /** a line that leads somewhere (a task, a message) was pressed */
  onGo?(ref: string, entry: TimelineEntry): void;
  /** the label of that button, per entry; none and the button is not drawn */
  goLabel?(entry: TimelineEntry): string | undefined;
  empty?: string;
  /** the foot: "Show earlier activity" when there is more to read */
  onEarlier?: (() => void) | undefined;
  testID?: string;
}

/** A detail longer than this is two lines and more: it is cut and opens in place. */
const LONG = 100;

const kindOf = (id: string): "person" | "agent" => (id.startsWith("agt_") ? "agent" : "person");

export function Timeline({
  entries,
  nameOf,
  now,
  onGo,
  goLabel,
  empty = "Nothing has happened yet.",
  onEarlier,
  testID = "timeline",
}: TimelineProps): ReactElement {
  const [open, setOpen] = useState<string | null>(null);
  const zones = useZones();
  if (entries.length === 0)
    return (
      <Text style={s.empty} testID={`${testID}-empty`}>
        {empty}
      </Text>
    );
  return (
    <View testID={testID} style={s.list} accessibilityRole={"list" as never}>
      {entries.map((e, i) => {
        const quiet = e.tier === "quiet";
        const more = e.detail !== undefined && e.detail.length > LONG;
        const detail = e.detail !== undefined && e.detail !== "";
        const label = goLabel?.(e);
        const leads = e.ref !== undefined && label !== undefined && onGo !== undefined;
        const isOpen = open === e.id;
        const tone = TONE[e.tier];
        const body = (
          <View style={s.line}>
            <View style={s.rail}>
              {quiet ? (
                <View style={s.dotWrap}>
                  <View style={s.dot} />
                </View>
              ) : e.by !== undefined && e.tier !== "milestone" ? (
                <Avatar name={nameOf(e.by)} seedId={e.by} kind={kindOf(e.by)} size={22} />
              ) : (
                <View style={[s.disc, { backgroundColor: `color-mix(in srgb, ${tone} 14%, var(--side))` as string }]}>
                  <Mark icon={e.icon} color={tone} />
                </View>
              )}
            </View>
            <View style={s.main}>
              <View style={s.head}>
                <Text
                  testID={`${testID}-title`}
                  style={[s.title, quiet && s.titleQuiet, e.tier === "milestone" && s.titleBold]}
                  numberOfLines={isOpen ? undefined : 2}
                >
                  {e.title}
                </Text>
                <View style={s.when}>
                  {e.span && e.span.from !== e.span.to ? (
                    <Text style={s.whenText}>{spanWords(e.span.from, e.span.to, zones.space)}</Text>
                  ) : (
                    <When at={e.at} now={now} style={s.whenText} />
                  )}
                </View>
              </View>
              {detail ? (
                <Text style={s.detail} numberOfLines={isOpen ? undefined : 2} testID={`${testID}-detail`}>
                  {e.detail}
                </Text>
              ) : null}
              {more && !isOpen ? <Text style={s.moreWord}>more</Text> : null}
              {isOpen && leads ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  onPress={() => onGo!(e.ref!, e)}
                  style={s.go}
                  testID={`${testID}-go`}
                >
                  <Text style={s.goText}>{label}</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        );
        if (quiet || (!more && !leads))
          return (
            <View
              // ui-rows-lint: not a list (the one Timeline: an entry is a marker on a rail, a sentence and a time, and Row cannot draw its folded detail)
              key={e.id}
              testID={`${testID}-entry`}
              style={s.entry}
            >
              {body}
            </View>
          );
        return (
          <Pressable
            // ui-rows-lint: not a list (the one Timeline: an entry is a marker on a rail, a sentence and a time, and Row cannot draw its folded detail)
            key={e.id}
            accessibilityRole="button"
            accessibilityState={{ expanded: isOpen }}
            testID={`${testID}-entry`}
            onPress={() => (more ? setOpen(isOpen ? null : e.id) : onGo!(e.ref!, e))}
            style={({ hovered }: { hovered?: boolean }) => [
              s.entry,
              hovered === true && { backgroundColor: "var(--hover)" as string },
            ]}
          >
            {body}
          </Pressable>
        );
      })}
      {onEarlier ? (
        <Pressable accessibilityRole="button" onPress={onEarlier} style={s.earlier} testID={`${testID}-earlier`}>
          <Text style={s.goText}>Show earlier activity</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** "4 to 10 Nov" for a folded run, in the Space's zone, so a week reads as a week. */
function spanWords(from: number, to: number, zone: string): string {
  const f = dateIn(from, zone).split(" ");
  const t = dateIn(to, zone).split(" ");
  return f[2] === t[2] ? `${f[1]} to ${t[1]} ${t[2]}` : `${f[1]} ${f[2]} to ${t[1]} ${t[2]}`;
}

const s = StyleSheet.create({
  list: { paddingHorizontal: 6, paddingVertical: 6 },
  entry: { borderRadius: 8, paddingHorizontal: 8 },
  line: { flexDirection: "row", gap: 10, paddingVertical: 7 },
  rail: { width: 22, alignItems: "center" },
  disc: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  dotWrap: { width: 22, height: 22, alignItems: "center", justifyContent: "center" },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "var(--ink-4)" as string },
  main: { flex: 1, minWidth: 0 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  title: { flex: 1, minWidth: 0, color: "var(--ink)" as string, fontSize: 13.5, lineHeight: 20, fontWeight: "500" },
  titleBold: { fontWeight: "600" },
  titleQuiet: { color: "var(--ink-3)" as string, fontSize: 12.5, fontWeight: "400" },
  when: { flex: "none" as never, paddingTop: 2 },
  whenText: { color: "var(--ink-3)" as string, fontSize: 11.5, lineHeight: 16 },
  detail: { color: "var(--ink-2)" as string, fontSize: 12.5, lineHeight: 18, marginTop: 1 },
  moreWord: { color: "var(--ink-3)" as string, fontSize: 12, marginTop: 1 },
  go: { alignSelf: "flex-start", marginTop: 6, paddingVertical: 3 },
  goText: { color: "var(--accent)" as string, fontSize: 12.5, fontWeight: "500" },
  earlier: { paddingVertical: 12, paddingHorizontal: 8, alignItems: "flex-start" },
  empty: { color: "var(--ink-3)" as string, fontSize: 13, padding: 16, lineHeight: 19 },
});
