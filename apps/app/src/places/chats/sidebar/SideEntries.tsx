// The new Chats sidebar's entries drawn (design 13 Nov, 2.3 and 2.4): a row says who or what it is by its shape, wears one mark, and a cut name is readable in full. Every entry is one of the layout's typed entries
// (layout.ts) at its fixed height, drawn on the shared ui/Row; no second row, group, tooltip or "N more" is made here. Presentational: the list around it (SidebarList) owns menus, keys and state.
import type { ReactElement, ReactNode } from "react";
import { createElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { avatarOf } from "../../../../../../ui/src/Avatar/assistant.ts";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { LoadFailed } from "../../../../../../ui/src/States/Loads.tsx";
import { MoreRow } from "../../../../../../ui/src/MoreRow/index.tsx";
import { Tooltip } from "../../../../../../ui/src/Tooltip/index.tsx";
import { Glyph } from "./parts.tsx";
import { injectCss } from "../../../../../../ui/src/theme/css.ts";
import { aggMarks } from "./layout.ts";
import type { Item, LayoutEntry, Mark, Shape } from "./layout.ts";

type Entry<T extends LayoutEntry["type"]> = Extract<LayoutEntry, { type: T }>;

/** What a row says about itself in words, for the tooltip, the screen reader and a cut name: who or what it is. */
export const SHAPE_WORDS: Record<Shape, string> = {
  person: "Person",
  agent: "Agent",
  assistant: "Your Assistant",
  group: "Group chat",
  channel: "Channel",
  project: "Project",
  goal: "Goal",
  task: "Needs you",
};
/** The words under a name on hover: what it is, then what is going on with it. */
export function tipOf(x: Item): { title: string; who: string } {
  const bits: string[] = [x.private === true ? "Private channel" : SHAPE_WORDS[x.shape]];
  if (x.progress) bits.push(`${x.progress.done} of ${x.progress.total}`);
  if (x.failed !== undefined) bits.push(x.failed === "" ? "Failed" : x.failed);
  else if (x.muted) bits.push("Muted");
  else if (x.mentions > 0) bits.push(`${x.mentions} mention${x.mentions === 1 ? "" : "s"}`);
  else if (x.unread > 0) bits.push("Unread");
  else if (x.draft) bits.push("Draft");
  else if (x.working && x.sub) bits.push(x.sub);
  return { title: x.title, who: bits.join(" · ") };
}
/** The one string a hover shows: the full name, then who it is. */
export const tipText = (x: Item): string => {
  const t = tipOf(x);
  return `${t.title}\n${t.who}`;
};

// ---------------------------------------------------------------- the lead: shape

const BOX = 20;
function Tile({ children, filled = false }: { children: ReactNode; filled?: boolean }): ReactElement {
  return (
    <View aria-hidden style={[s.tile, filled ? s.tileFilled : s.tileOutline] as never}>
      {children}
    </View>
  );
}

/** The progress ring of a goal: an accent arc round its lead's face (green when done, dim when it ended), and the ring is the count so no "0/7" is drawn. */
export function GoalRing({ item }: { item: Item }): ReactElement | null {
  if (Platform.OS !== "web") return null;
  const p = item.progress ?? { done: 0, total: 0 };
  const frac = p.total > 0 ? Math.min(1, p.done / p.total) : 0;
  const R = 9;
  const C = 2 * Math.PI * R;
  const tone = item.ended ? (frac >= 1 ? "var(--ok)" : "var(--ink-4)") : "var(--accent)";
  const face = item.faces[0];
  return (
    <View testID="goal-ring" aria-hidden style={s.ring as never}>
      {createElement(
        "svg",
        { viewBox: "0 0 20 20", width: BOX, height: BOX, style: { position: "absolute", left: 0, top: 0 } },
        createElement("circle", { cx: 10, cy: 10, r: R, fill: "none", stroke: "var(--line-2)", strokeWidth: 2 }),
        createElement("circle", {
          cx: 10,
          cy: 10,
          r: R,
          fill: "none",
          stroke: tone,
          strokeWidth: 2,
          strokeLinecap: "round",
          strokeDasharray: C,
          strokeDashoffset: C * (1 - frac),
          transform: "rotate(-90 10 10)",
          "data-progress": String(Math.round(frac * 100)),
        }),
      )}
      {face ? <Avatar {...avatarOf({ id: face.id, name: face.name, kind: "agent" })} size={12} /> : null}
      {item.working && !item.ended ? <View testID="goal-live" style={s.live as never} /> : null}
    </View>
  );
}

/** One avatar per actor: the same call everywhere (the Assistant is the Vyre tile in Pinned, Chats, Team and Needs you), a round marble for a person, a rounded square for an agent. */
export function LeadFace({ item, size = BOX }: { item: Item; size?: number }): ReactElement {
  const f = item.faces[0] ?? { id: item.key, name: item.title };
  const kind = item.shape === "person" ? "person" : item.shape === "assistant" ? "assistant" : "agent";
  const state = item.kind === "task" ? "waiting" : item.working ? "working" : undefined;
  return (
    <View aria-hidden testID={`face-${f.name}`} style={{ width: size, height: size, flexShrink: 0 }}>
      <Avatar {...avatarOf({ id: f.id, name: f.name, kind })} size={size} state={state} />
      {item.presence === "online" ? <View testID="presence" style={s.presence as never} /> : null}
      {item.presence === "away" ? <View testID="presence-away" style={s.away as never} /> : null}
    </View>
  );
}

/** Two overlapping faces: more than one. */
function GroupFaces({ item }: { item: Item }): ReactElement {
  const two = item.faces.slice(0, 2);
  return (
    <View testID="face-stack" aria-hidden style={{ width: BOX, height: BOX, justifyContent: "center" }}>
      {/* ui-rows-lint: not a list (overlapping avatars drawn as one group face) */}
      {two.map((f, i) => (
        <View
          key={f.id}
          style={
            {
              position: "absolute",
              left: i * 7,
              top: i * 3 + 1,
              zIndex: 2 - i,
              borderRadius: 5,
              boxShadow: "0 0 0 1.5px var(--side)",
            } as never
          }
        >
          <Avatar {...avatarOf({ id: f.id, name: f.name, kind: "agent" })} size={14} />
        </View>
      ))}
    </View>
  );
}

/** The leading look of a row by its shape (design 2.3), with the gap before the title. */
export function Lead({ item }: { item: Item }): ReactElement {
  return <View style={s.leadGap as never}>{leadOf(item)}</View>;
}
function leadOf(item: Item): ReactElement {
  switch (item.shape) {
    case "goal":
      return <GoalRing item={item} />;
    case "group":
      return <GroupFaces item={item} />;
    case "channel":
      return (
        <Tile>
          <Glyph name={item.private === true ? "lock" : "hash"} size={12} />
        </Tile>
      );
    case "project":
      return (
        <Tile filled>
          <Glyph name="project" size={13} color="var(--accent)" />
        </Tile>
      );
    case "task":
    case "person":
    case "agent":
    case "assistant":
      return <LeadFace item={item} />;
  }
}

// ---------------------------------------------------------------- the one mark

const MARK_LABEL: Record<Mark["kind"], string> = {
  failed: "Failed",
  muted: "Muted",
  mention: "Mentions",
  unread: "Unread",
  draft: "Draft",
  working: "Working",
};
/** One mark, each a different shape and tone: a red outlined circle, a grey bell with a slash, an accent count, an accent dot, a grey pencil. Working is the face's moving ring, so it draws nothing here
 * (on a folded head it is a coral dot). */
export function MarkView({ mark, onHead = false }: { mark: Mark; onHead?: boolean }): ReactElement | null {
  switch (mark.kind) {
    case "failed":
      return (
        <View
          testID="mark-failed"
          accessibilityLabel={mark.why ? `Failed: ${mark.why}` : "Failed"}
          style={s.markBox as never}
        >
          <Glyph name="alert" size={15} color="var(--danger)" />
        </View>
      );
    case "muted":
      return (
        <View testID="mark-muted" accessibilityLabel="Muted" style={s.markBox as never}>
          <Glyph name="bellOff" size={14} color="var(--ink-4)" />
        </View>
      );
    case "mention":
      return (
        <View
          testID="mark-mention"
          accessibilityLabel={`${mark.count} mention${mark.count === 1 ? "" : "s"}`}
          style={s.badge as never}
        >
          <Text style={s.badgeText as never}>{mark.count > 99 ? "99+" : mark.count}</Text>
        </View>
      );
    case "unread":
      return <View testID="mark-unread" accessibilityLabel="Unread" style={s.dot as never} />;
    case "draft":
      return (
        <View testID="mark-draft" accessibilityLabel="Draft" style={s.markBox as never}>
          <Glyph name="compose" size={14} color="var(--ink-4)" />
        </View>
      );
    case "working":
      return onHead ? (
        <View testID="mark-working" accessibilityLabel="Working" style={[s.dot, s.dotWork] as never} />
      ) : null;
  }
}
const marksOf = (marks: readonly Mark[], onHead = false): ReactElement => (
  <View style={s.marks as never}>
    {/* ui-rows-lint: not a list (the marks of one head or one "N more") */}
    {marks.map((m) => (
      <MarkView key={m.kind} mark={m} onHead={onHead} />
    ))}
  </View>
);

// ---------------------------------------------------------------- the entries

// A row at rest shows its name and at most its one mark; the "..." comes with the pointer or the keyboard (and always on a touch screen, where there is no hover). Class on a plain element, because the sheet is what can say :hover.
let hoverCss = false;
function ensureHoverCss(): void {
  if (hoverCss) return;
  const d = (globalThis as { document?: Parameters<typeof injectCss>[0] }).document;
  if (!d || !d.head) return;
  injectCss(
    d,
    "vyre-side-hover",
    ".vyre-hm{display:none}.vyre-row:hover .vyre-hm,.vyre-row:focus-within .vyre-hm,.vyre-hm[data-on]{display:flex}@media (hover:none){.vyre-hm{display:flex}}",
  );
  hoverCss = true;
}
ensureHoverCss();
/** The wrapper of a row's "...": hidden at rest, shown on hover, on focus, when the keyboard cursor is on the row (`on`) and on touch. */
function HoverSlot({ on = false, children }: { on?: boolean; children: ReactNode }): ReactElement {
  ensureHoverCss();
  return createElement(
    "div",
    { className: "vyre-hm", style: { alignItems: "center" }, ...(on ? { "data-on": "1" } : {}) },
    children,
  );
}

export interface EntryState {
  /** The row the middle shows. */
  selected: boolean;
  /** The keyboard cursor is on it (drawn as a hover, never as the selection). */
  cursor: boolean;
  /** Cmd (or Ctrl) is held: a pinned row shows its digit. */
  digits?: boolean;
}
export interface EntryHandlers {
  press(): void;
  /** The Tasks chevron: fold or unfold (the name opens the place). */
  fold?: () => void;
  /** The "..." button: the row's menu at a point. */
  more?: (x: number, y: number) => void;
  /** Spread on the row's element: right-click, the Menu key, a long press and the hint keys (useContextMenu.on). */
  dom?: Record<string, unknown>;
}

const wrap = (e: LayoutEntry, child: ReactElement): ReactElement => <View style={{ height: e.h }}>{child}</View>;

function MoreButton({
  label,
  onPress,
}: {
  label: string;
  onPress?: (x: number, y: number) => void;
}): ReactElement | null {
  if (!onPress) return null;
  return (
    <Tooltip text={`More for ${label}`}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`More for ${label}`}
        testID="row-more"
        onPress={(ev) => {
          const x = ev as unknown as {
            currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } };
            stopPropagation?: () => void;
          };
          x.stopPropagation?.();
          const b = x.currentTarget?.getBoundingClientRect?.();
          onPress(b?.left ?? 0, (b?.bottom ?? 0) + 4);
        }}
        style={s.moreBtn as never}
      >
        <Glyph name="more" size={15} />
      </Pressable>
    </Tooltip>
  );
}

/** A row of a block: Needs you and Goals rows are two lines (the title, then what is waiting or what it is doing), the rest one. The title stays one line; the full name and who it is show on hover. */
export function ItemRow({
  entry,
  state,
  on,
}: {
  entry: Entry<"row">;
  state: EntryState;
  on: EntryHandlers;
}): ReactElement {
  const x = entry.item;
  const two = entry.h === 44;
  const un = !x.muted && (x.unread > 0 || x.mentions > 0);
  const trailing: ReactElement = x.verb ? (
    <Text testID="row-verb" style={[s.verb, x.verb.tone === "warn" && s.verbWarn] as never}>
      {x.verb.label}
    </Text>
  ) : (
    <View style={s.trail as never}>
      {entry.digit !== undefined && state.digits === true ? (
        <Text testID={`digit-${entry.digit}`} style={s.digit as never}>{`⌘${entry.digit}`}</Text>
      ) : null}
      {entry.mark ? <MarkView mark={entry.mark} /> : null}
      <HoverSlot on={state.cursor}>
        <MoreButton label={x.title} {...(on.more ? { onPress: on.more } : {})} />
      </HoverSlot>
    </View>
  );
  return wrap(
    entry,
    <Tooltip text={tipText(x)}>
      <Row
        id={entry.key}
        title={x.title}
        {...(two && x.sub ? { note: x.sub } : {})}
        {...(x.verb?.tone === "warn" && x.sub ? { noteLeadTone: "warning" as const } : {})}
        selected={state.selected}
        hovered={state.cursor && !state.selected}
        emphasis={un}
        quiet={!un && !state.selected}
        onPress={on.press}
        leading={<Lead item={x} />}
        trailing={trailing}
        domProps={{
          ...(on.dom ?? {}),
          "aria-label": `${x.title}, ${tipOf(x).who}`,
          "data-kind": x.kind,
          "data-mark": entry.mark?.kind ?? "",
        }}
      />
    </Tooltip>,
  );
}

/** The fixed row at the top: Tasks. Its chevron folds the waiting items under it, its name opens the Tasks place, and the count stays in the accent needs-you tone folded or not. */
export function TasksRow({
  entry,
  state,
  on,
}: {
  entry: Entry<"tasks">;
  state: EntryState;
  on: EntryHandlers;
}): ReactElement {
  return wrap(
    entry,
    <Row
      id="tasks"
      title="Tasks"
      selected={state.selected}
      hovered={state.cursor && !state.selected}
      onPress={on.press}
      leading={
        <View style={s.tasksLead as never}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={entry.folded ? "Unfold Tasks" : "Fold Tasks"}
            accessibilityState={{ expanded: !entry.folded }}
            testID="toggle-needs"
            onPress={(ev) => {
              (ev as unknown as { stopPropagation?: () => void }).stopPropagation?.();
              on.fold?.();
            }}
            style={s.chevHit as never}
          >
            <Glyph name={entry.folded ? "arrow" : "chev"} size={10} color="var(--ink-4)" />
          </Pressable>
          <Glyph name="task" size={16} color="var(--ink-2)" />
        </View>
      }
      trailing={
        <View style={s.trail as never}>
          {entry.count > 0 ? <MarkView mark={{ kind: "mention", count: entry.count }} /> : null}
          <HoverSlot on={state.cursor}>
            <MoreButton label="Tasks" {...(on.more ? { onPress: on.more } : {})} />
          </HoverSlot>
        </View>
      }
      domProps={{
        ...(on.dom ?? {}),
        "aria-label": entry.count > 0 ? `Tasks, ${entry.count} need you` : "Tasks",
        "data-folded": String(entry.folded),
      }}
    />,
  );
}

/** One quiet line in a section with nothing in it: "No goals yet" and its one action. */
export function HintView({ entry, onPress }: { entry: Entry<"hint">; onPress(): void }): ReactElement {
  return wrap(
    entry,
    <View testID={`hint-${entry.section}`} style={s.err as never}>
      <Text style={s.errText as never}>{entry.text}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={entry.action}
        testID={`hint-${entry.section}-action`}
        onPress={onPress}
        style={s.retry as never}
      >
        <Text style={s.retryText as never}>{entry.action}</Text>
      </Pressable>
    </View>,
  );
}

/** A section head: its label, a chevron, and when folded its count and the sum of its marks, so a folded Chats still says there is a mention in it. Sticky heads are the list's job. */
export function HeadView({
  entry,
  state,
  on,
  children,
}: {
  entry: Entry<"head">;
  state: EntryState;
  on: EntryHandlers;
  children?: ReactNode;
}): ReactElement {
  const h = entry;
  return wrap(
    entry,
    <View testID={`head-${h.section}`} style={s.head as never} {...(on.dom ?? {})}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${h.label}${h.folded ? `, ${h.count}, folded` : ""}`}
        accessibilityState={{ expanded: !h.folded }}
        testID={`toggle-${h.section}`}
        onPress={on.press}
        style={[s.headLabel, state.cursor && s.headCursor] as never}
      >
        <Glyph name="chev" size={10} color="var(--ink-4)" />
        <Text style={s.headText as never}>{h.label}</Text>
        {h.folded ? (
          <>
            <Text testID={`count-${h.section}`} style={s.headCount as never}>
              {h.count}
            </Text>
            {marksOf(h.marks, true)}
          </>
        ) : null}
      </Pressable>
      <View style={s.grow as never} />
      <View style={s.tools as never}>{children}</View>
    </View>,
  );
}

/** "N more": the shared MoreRow, with the marks of what it hides; opened, it reads Show less. Under Needs you it opens the Tasks place instead (the list decides). */
export function MoreView({
  entry,
  state,
  on,
}: {
  entry: Entry<"more">;
  state: EntryState;
  on: EntryHandlers;
}): ReactElement {
  return wrap(
    entry,
    <MoreRow
      count={entry.hidden}
      open={false}
      onToggle={on.press}
      what={entry.section}
      cursor={state.cursor}
      testID={`more-${entry.section}`}
      marks={marksOf(aggMarks(entry.agg), true)}
      {...(on.dom ? { domProps: on.dom } : {})}
    />,
  );
}

export function LessView({
  entry,
  state,
  on,
}: {
  entry: Entry<"less">;
  state: EntryState;
  on: EntryHandlers;
}): ReactElement {
  return wrap(
    entry,
    <MoreRow
      count={0}
      open
      onToggle={on.press}
      what={entry.section}
      cursor={state.cursor}
      testID={`less-${entry.section}`}
      {...(on.dom ? { domProps: on.dom } : {})}
    />,
  );
}

/** One section failing: the shared LoadFailed in its row-height form (the words and Retry). The other sections keep drawing. */
export function ErrorView({ entry, onRetry }: { entry: Entry<"error">; onRetry(): void }): ReactElement {
  return wrap(
    entry,
    <LoadFailed
      compact
      what={entry.what}
      failure={{ message: "" }}
      onRetry={onRetry}
      testID={`section-error-${entry.section}`}
    />,
  );
}

export function NoneView({ entry, onShowAll }: { entry: Entry<"none">; onShowAll(): void }): ReactElement {
  return wrap(
    entry,
    <View testID="filter-none" style={s.err as never}>
      <Text style={s.errText as never}>Nothing matches</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Show all" onPress={onShowAll} style={s.retry as never}>
        <Text style={s.retryText as never}>Show all</Text>
      </Pressable>
    </View>,
  );
}

const s = StyleSheet.create({
  tile: { width: BOX, height: BOX, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  tileOutline: { borderWidth: 1.5, borderColor: "var(--line-2)" as string },
  tileFilled: { backgroundColor: "var(--accent-wash)" as string },
  ring: { width: BOX, height: BOX, alignItems: "center", justifyContent: "center" },
  live: {
    position: "absolute",
    right: -1,
    bottom: -1,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "var(--beacon)" as string,
  },
  presence: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "var(--ok)" as string,
    borderWidth: 1.5,
    borderColor: "var(--side)" as string,
  },
  away: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "var(--side)" as string,
    borderWidth: 2,
    borderColor: "var(--warn)" as string,
  },
  tasksLead: { flexDirection: "row", alignItems: "center", gap: 4, marginRight: 8 },
  leadGap: { marginRight: 8 },
  chevHit: { width: 16, height: 22, alignItems: "center", justifyContent: "center" },
  lead: { width: BOX, height: BOX, alignItems: "center", justifyContent: "center" },
  marks: { flexDirection: "row", alignItems: "center", gap: 4 },
  markBox: { width: 18, height: 18, alignItems: "center", justifyContent: "center" },
  badge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: "var(--accent)" as string,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "600",
    color: "var(--accent-ink)" as string,
    fontVariant: ["tabular-nums"],
  } as object,
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "var(--accent)" as string },
  dotWork: { backgroundColor: "var(--beacon)" as string },
  trail: { flexDirection: "row", alignItems: "center", gap: 6 },
  digit: { fontSize: 11, color: "var(--ink-4)" as string },
  hoverMore: { flexDirection: "row", alignItems: "center" },
  moreBtn: { width: 22, height: 22, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  verb: { fontSize: 12, fontWeight: "600", color: "var(--accent)" as string },
  verbWarn: { color: "var(--warn)" as string },
  head: { height: 34, flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 8, paddingBottom: 6 },
  headLabel: { flexDirection: "row", alignItems: "center", gap: 6, height: 22, paddingHorizontal: 2, borderRadius: 6 },
  headCursor: { backgroundColor: "var(--hover)" as string },
  headText: { fontSize: 12, fontWeight: "600", color: "var(--ink-3)" as string },
  headCount: { fontSize: 12, color: "var(--ink-4)" as string, fontVariant: ["tabular-nums"] } as object,
  grow: { flex: 1, minWidth: 0 },
  tools: { flexDirection: "row", alignItems: "center", gap: 2 },
  more: {
    height: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 38,
    paddingRight: 8,
    borderRadius: 8,
  },
  moreText: { fontSize: 12, color: "var(--ink-3)" as string },
  err: { height: 32, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8 },
  errText: { flex: 1, minWidth: 0, fontSize: 12.5, color: "var(--ink-3)" as string },
  retry: { paddingHorizontal: 8, height: 22, borderRadius: 6, justifyContent: "center" },
  retryText: { fontSize: 12, fontWeight: "600", color: "var(--accent)" as string },
  sk: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, height: "100%" },
  skDot: { width: 18, height: 18, borderRadius: 6, backgroundColor: "var(--hover)" as string },
  skBar: { height: 8, borderRadius: 4, backgroundColor: "var(--hover)" as string },
});
