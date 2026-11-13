// The new Chats sidebar's list: the layout's entries in one window (fixed heights, nothing measured), each drawn by SideEntries, every one with a defined click and a menu (right-click, the Menu key, a long press and the "..."
// button reach the same items), and the keyboard of design 2.6 (arrows, Home and End, Enter, Left and Right on heads, Space, F, Option-Shift-arrows, Cmd-1..9, a letter into the command bar). It draws what it is
// given and does what it is told through callbacks; it reads nothing and keeps nothing but the cursor. Switched in at one place by the Chats sidebar (step 3).
import { useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { View } from "react-native";
import { VirtualList } from "../../../../../../ui/src/VirtualList/index.tsx";
import type { VirtualWindow } from "../../../../../../ui/src/VirtualList/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { useContextMenu } from "../../../../../../ui/src/Menu/context.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/props.ts";
import { detectPlatform } from "../../../shell/keyboard/useShellKeys.ts";
import {
  ErrorView,
  HeadView,
  HintView,
  ItemRow,
  LessView,
  MoreView,
  NoneView,
  SkeletonView,
  TasksRow,
} from "./SideEntries.tsx";
import { LANDS_ON, headOf, listKey, moveKey } from "./side-keys.ts";
import { headMenu, rowMenu, tasksMenu } from "./side-menus.ts";
import type { FixedDo, HeadDo, RowCan, RowDo } from "./side-menus.ts";
import type { Item, Layout, LayoutEntry, SectionId } from "./layout.ts";

export interface SidebarListProps {
  layout: Layout;
  /** The key of the entry the middle shows. */
  selected: string | null;
  /** What each row's menu can do; items it leaves out are not in the menu. */
  rowDo(x: Item): RowDo;
  can?: RowCan;
  headDo(section: SectionId): HeadDo;
  tasksDo: FixedDo;
  /** A press on a row, Enter on it, or Cmd-Enter (`tab`): open it. */
  open(x: Item, how: "here" | "tab"): void;
  openTasks(): void;
  fold(section: SectionId): void;
  /** "N more" and "Show less" under a section: open or close it in place. */
  toggleMore(section: SectionId): void;
  retry(section: SectionId): void;
  showAll(): void;
  /** Cmd-1..9: the nth pinned row was asked for. */
  openPinned(n: number): void;
  /** Option-Shift-Down and Up: the next or previous unread row. */
  nextUnread(dir: 1 | -1): void;
  openFilter(): void;
  /** "New goal" on the quiet "No goals yet" line. */
  newGoal(): void;
  copyLink(x: Item): void;
  /** A letter typed on the list: the command bar opens with it. */
  search(text: string): void;
  /** Escape: back to the composer. */
  leave(): void;
  window?: VirtualWindow;
}

/** The menu of an entry, or null where there is none: an error row has Retry on its face, a skeleton and the empty line have nothing. "N more" has its head's menu. */
export function entryMenu(
  e: LayoutEntry,
  p: Pick<SidebarListProps, "rowDo" | "can" | "headDo" | "tasksDo" | "open" | "openTasks" | "fold">,
  pinned: ReadonlySet<string>,
): readonly MenuEntry[] | null {
  switch (e.type) {
    case "row":
      return rowMenu(
        e.item,
        pinned.has(e.key),
        { ...p.rowDo(e.item), open: () => p.open(e.item, "here"), openTab: () => p.open(e.item, "tab") },
        p.can ?? {},
      );
    case "tasks":
      return tasksMenu(
        { ...p.tasksDo, open: p.openTasks, fold: () => p.fold("needs"), unfold: () => p.fold("needs") },
        undefined,
        e.folded,
      );
    case "head":
    case "more":
    case "less": {
      const folded = e.type === "head" ? e.folded : false;
      return headMenu(e.section, folded, {
        ...p.headDo(e.section),
        fold: () => p.fold(e.section),
        unfold: () => p.fold(e.section),
      });
    }
    default:
      return null;
  }
}

const mac = (): boolean => detectPlatform() === "mac";

export function SidebarList(p: SidebarListProps): ReactElement {
  const menu = useMenu();
  const ctx = useContextMenu(menu);
  const [cursor, setCursor] = useState<string | null>(null);
  const entries = p.layout.entries;
  const byKey = useMemo(() => new Map(entries.map((e) => [e.key, e])), [entries]);
  const order = useMemo(() => entries.filter((e) => LANDS_ON.includes(e.type)).map((e) => e.key), [entries]);
  const pinnedKeys = useMemo(
    () => new Set(entries.flatMap((e) => (e.type === "row" && e.section === "pinned" ? [e.key] : []))),
    [entries],
  );
  const cur = useRef(cursor);
  cur.current = cursor;

  const menuFor = (e: LayoutEntry): readonly MenuEntry[] | null => entryMenu(e, p, pinnedKeys);
  const press = (e: LayoutEntry): void => {
    setCursor(e.key);
    switch (e.type) {
      case "row":
        return p.open(e.item, "here");
      case "tasks":
        return p.openTasks();
      case "head":
        return p.fold(e.section);
      case "more":
        return e.opens === "tasks" ? p.openTasks() : p.toggleMore(e.section);
      case "less":
        return p.toggleMore(e.section);
      case "hint":
        return p.newGoal();
      case "error":
        return p.retry(e.section);
    }
  };
  const handlersOf = (e: LayoutEntry) => {
    const hasMenu = menuFor(e) !== null;
    return {
      press: () => press(e),
      ...(hasMenu ? { more: (x: number, y: number) => ctx.open(() => menuFor(e), x, y, { label: labelOf(e) }) } : {}),
      ...(hasMenu ? { dom: ctx.on(() => menuFor(e), { label: labelOf(e) }) } : {}),
    };
  };

  const onKeyDown = (ev: {
    key: string;
    code?: string;
    metaKey?: boolean;
    ctrlKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
    defaultPrevented?: boolean;
    preventDefault?: () => void;
    target?: { tagName?: string; isContentEditable?: boolean };
  }): void => {
    if (ev.defaultPrevented === true) return;
    const t = ev.target;
    if (t !== undefined && (t.isContentEditable === true || /^(input|textarea|select)$/i.test(t.tagName ?? ""))) return;
    const at = cursor ? byKey.get(cursor) : undefined;
    // the row's own menu runs its keys first: the Menu key and Shift-F10 open it, and P, U, M, E, F2, Cmd-Enter, Cmd-Backspace and Cmd-I do its item on the cursor's row
    if (at) {
      const h = handlersOf(at).dom as { onKeyDown?: (e: unknown) => void } | undefined;
      h?.onKeyDown?.(ev);
      if ((ev as { defaultPrevented?: boolean }).defaultPrevented === true) return;
    }
    const a = listKey(
      ev,
      at ? { type: at.type, ...(at.type === "head" || at.type === "tasks" ? { folded: at.folded } : {}) } : null,
      mac(),
    );
    if (!a) return;
    ev.preventDefault?.();
    switch (a.do) {
      case "move":
        return setCursor(moveKey(order, cursor, a.to));
      case "enter":
        return at ? press(at) : undefined;
      case "openTab":
        return at?.type === "row" ? p.open(at.item, "tab") : undefined;
      case "fold":
      case "unfold":
        return at?.type === "head" ? p.fold(at.section) : at?.type === "tasks" ? p.fold("needs") : undefined;
      case "toHead":
        return at ? setCursor(headOf(entries, at.key) ?? cursor) : undefined;
      case "escape":
        return p.leave();
      case "filter":
        return p.openFilter();
      case "copyLink":
        return at?.type === "row" ? p.copyLink(at.item) : undefined;
      case "pinned":
        return p.openPinned(a.n);
      case "unread":
        return p.nextUnread(a.dir);
      case "search":
        return p.search(a.text);
    }
  };

  const render = (e: LayoutEntry): ReactElement => {
    const state = { selected: p.selected === e.key, cursor: cursor === e.key };
    const on = handlersOf(e);
    switch (e.type) {
      case "tasks":
        return <TasksRow entry={e} state={state} on={{ ...on, fold: () => p.fold("needs") }} />;
      case "hint":
        return <HintView entry={e} onPress={p.newGoal} />;
      case "row":
        return <ItemRow entry={e} state={state} on={on} />;
      case "head":
        return <HeadView entry={e} state={state} on={on} />;
      case "more":
        return <MoreView entry={e} state={state} on={on} />;
      case "less":
        return <LessView entry={e} state={state} on={on} />;
      case "error":
        return <ErrorView entry={e} onRetry={() => p.retry(e.section)} />;
      case "none":
        return <NoneView entry={e} onShowAll={p.showAll} />;
      case "skeleton":
        return <SkeletonView entry={e} />;
    }
  };

  return (
    <View
      testID="sidebar-list"
      accessibilityRole="listbox"
      accessibilityLabel="Chats"
      style={{ flex: 1, minHeight: 0 }}
      {...({
        tabIndex: 0,
        onKeyDown,
        ...(cursor
          ? { "aria-activedescendant": cursor.startsWith("h:") ? `toggle-${cursor.slice(2)}` : `row-${cursor}` }
          : {}),
      } as Record<string, unknown>)}
    >
      <VirtualList
        data={entries}
        rowHeight={32}
        heightOf={(e) => e.h}
        keyOf={(e) => e.key}
        renderItem={(e) => render(e)}
        {...(p.window ? { window: p.window } : {})}
      />
      {ctx.element}
    </View>
  );
}

function labelOf(e: LayoutEntry): string {
  return e.type === "row" ? e.item.title : e.type === "head" ? e.label : e.type === "tasks" ? "Tasks" : e.key;
}
