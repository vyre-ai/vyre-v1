// The menu of a task row (list, board card, timeline bar): open and select, the moves, then the changes, then copy and delete last (team/v1/CONTEXT-MENUS.md). Pure: the page gives what each item does. When
// the row is part of a selection every change acts on the whole selection (the page passes the ids), and Open and Select are about the row alone.
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";

export interface TaskRowFacts { done: boolean; selected: boolean }
export interface TaskRowDo {
  open(): void;
  toggleSelect(): void;
  markDone(): void;
  reopen(): void;
  status(): void;
  assign(): void;
  due(): void;
  priority(): void;
  labels(): void;
  moveToProject(): void;
  snooze(): void;
  /** Follow the task's thread (threads.follow); left out where the task has none to read. */
  follow?(): void;
  copyLink?(): void;
  duplicate(): void;
  remove(): void;
}

export function taskRowEntries(f: TaskRowFacts, d: TaskRowDo): MenuEntry[] {
  return [
    { label: "Open", onSelect: d.open },
    { label: f.selected ? "Deselect" : "Select", onSelect: d.toggleSelect },
    { separator: true },
    // the one move people make most, and the one that undoes it, without the Status list
    f.done ? { label: "Reopen", onSelect: d.reopen } : { label: "Mark Done", onSelect: d.markDone },
    { label: "Status…", onSelect: d.status },
    { label: "Assign…", onSelect: d.assign },
    { label: "Due…", onSelect: d.due },
    { label: "Priority…", onSelect: d.priority },
    { label: "Labels…", onSelect: d.labels },
    { label: "Move to a project…", onSelect: d.moveToProject },
    // a task nobody should see for a while: it leaves the list and comes back on the day (tasks.snooze)
    { label: "Snooze…", onSelect: d.snooze },
    ...(d.follow ? [{ label: "Follow", onSelect: d.follow }] : []),
    { separator: true },
    ...(d.copyLink ? [{ label: "Copy link", onSelect: d.copyLink }] : []),
    { label: "Duplicate", onSelect: d.duplicate },
    { label: "Delete", danger: true, onSelect: d.remove },
  ];
}
