// My work is the full list (spec 4.2). Assign by clicking a face, then a person, agent, group, or role.

import { MenuPlaceholder } from "../../../../../../ui/src/Menu/Placeholder.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/props.ts";
import { RowPlaceholder } from "../../../../../../ui/src/Row/Placeholder.tsx";
import type { RowProps } from "../../../../../../ui/src/Row/props.ts";
import { StatesPlaceholder } from "../../../../../../ui/src/States/Placeholder.tsx";
import { FACE_ICON, faceFor } from "./faces.ts";
import type { Face, FaceKind } from "./faces.ts";
import { esc, section, skeleton } from "./html.ts";
import { workCounts, workTasks } from "./read.ts";
import type { TaskView } from "./read.ts";
import type { HomeSession } from "./session.ts";

const SCREEN = "tasks.my-work";

const FACE_GROUPS: readonly { head: string; kind: FaceKind }[] = [
  { head: "People", kind: "person" },
  { head: "Agents", kind: "agent" },
  { head: "Groups", kind: "group" },
  { head: "Roles", kind: "role" },
  { head: "Automations", kind: "automation" },
];

export function assignMenu(faces: readonly Face[]): string {
  const items: MenuEntry[] = [];
  for (const group of FACE_GROUPS) {
    const matching = faces.filter((face) => face.kind === group.kind);
    if (matching.length === 0) continue;
    items.push({ head: group.head });
    for (const face of matching) items.push({ label: face.name, icon: FACE_ICON[face.kind] });
  }
  return MenuPlaceholder({ items, source: "context" });
}

function faceButton(taskId: string, face: Face): string {
  return `<button type="button" data-face="${esc(face.id)}" data-face-kind="${esc(face.kind)}" data-task="${esc(taskId)}" data-action="assign" data-kbd="Enter" data-hover="face">${esc(face.name)}</button>`;
}

function taskBlock(task: TaskView, faces: readonly Face[], picker: boolean): string {
  const who = faceFor(faces, task.assigned);
  const props: RowProps = {
    id: task.id,
    title: task.title,
    note: task.summary ?? who.name,
    selected: false,
    hovered: false,
  };
  const controls = picker
    ? `<div data-assign="${esc(task.id)}">${faces.map((face) => faceButton(task.id, face)).join("")}</div>`
    : `<span data-assigned="${esc(who.id)}">${esc(who.name)}</span>`;
  return `<div data-task-row="${esc(task.id)}" data-kbd="Enter" data-hover="row">${RowPlaceholder(props)}${controls}</div>`;
}

function readList(session: HomeSession, sectionName: "open" | "assigned_by_me" | "done"): { ready: false } | { ready: true; tasks: TaskView[]; counts: ReturnType<typeof workCounts> } {
  const snap = session.hooks.query(SCREEN, "list", { section: sectionName }).getSnapshot();
  if (snap.status !== "ready") return { ready: false };
  return { ready: true, tasks: workTasks(snap.data), counts: workCounts(snap.data) };
}

export function renderMyWork(session: HomeSession): string {
  const open = readList(session, "open");
  const assigned = readList(session, "assigned_by_me");
  const done = readList(session, "done");
  if (!open.ready || !assigned.ready || !done.ready) return section("my-work", "My work", skeleton("my-work", 4));
  const counts = open.counts;
  if (open.tasks.length === 0 && assigned.tasks.length === 0 && done.tasks.length === 0) {
    return section("my-work", "My work", StatesPlaceholder({ kind: "empty", title: "No tasks yet", icon: "done" }));
  }
  const block = (id: "open" | "assigned_by_me" | "done", label: string, count: number, tasks: TaskView[], picker: boolean) => {
    const rows = tasks.map((task) => taskBlock(task, session.faces, picker)).join("");
    return `<div data-work="${id}"><h3 data-count="${count}">${esc(label)}</h3>${rows}</div>`;
  };
  const body = [
    `<div data-menu="assign">${assignMenu(session.faces)}</div>`,
    block("open", "Open", counts.open, open.tasks, true),
    block("assigned_by_me", "Assigned by you", counts.assignedByMe, assigned.tasks, false),
    block("done", "Done", counts.done, done.tasks, false),
  ].join("");
  return section("my-work", "My work", body);
}
