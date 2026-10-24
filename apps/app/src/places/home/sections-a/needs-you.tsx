// Needs you, top 3 (spec 3.1, 2.8). Order is overdue, blocking, due today, ready.

import { RowPlaceholder } from "../../../../../../ui/src/Row/Placeholder.tsx";
import type { RowProps } from "../../../../../../ui/src/Row/props.ts";
import { StatesPlaceholder } from "../../../../../../ui/src/States/Placeholder.tsx";
import { esc, section, skeleton } from "./html.ts";
import { REASON_LABEL, needsItems, rankNeedsYou } from "./read.ts";
import type { NeedsItem } from "./read.ts";
import type { HomeSession } from "./session.ts";

const SCREEN = "home.needs-you-top3";
const QUERY = { limit: 50 };

export function needsYouTop3(session: HomeSession): NeedsItem[] {
  const snap = session.hooks.query(SCREEN, "items", QUERY).getSnapshot();
  if (snap.status !== "ready") return [];
  return rankNeedsYou(needsItems(snap.data).items);
}

export function renderNeedsYou(session: HomeSession): string {
  const snap = session.hooks.query(SCREEN, "items", QUERY).getSnapshot();
  if (snap.status !== "ready") return section("needs-you", "Needs you", skeleton("needs-you", 3));
  const top = rankNeedsYou(needsItems(snap.data).items);
  if (top.length === 0) {
    return section("needs-you", "Needs you", StatesPlaceholder({ kind: "empty", title: "Nothing needs you", icon: "done" }));
  }
  const rows = top.map((item, index) => {
    const label = item.handledBy ? `${REASON_LABEL[item.reason]}. Handled by ${item.handledBy}` : REASON_LABEL[item.reason];
    const props: RowProps = { id: item.task.id, title: item.task.title, note: label, selected: false, hovered: false };
    const act = item.task.actionKey && item.task.actionLabel
      ? `<button type="button" data-action="act" data-task="${esc(item.task.id)}" data-key="${esc(item.task.actionKey)}" data-kbd="Enter" data-hover="control">${esc(item.task.actionLabel)}</button>`
      : "";
    return `<div data-rank="${index + 1}" data-reason="${esc(item.reason)}" data-kbd="Enter" data-hover="row">${RowPlaceholder(props)}${act}</div>`;
  }).join("");
  return section("needs-you", "Needs you", rows);
}
