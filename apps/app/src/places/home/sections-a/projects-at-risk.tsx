// Projects at risk. The section menu shows the counting rule returned by home.at_risk.

import { MenuPlaceholder } from "../../../../../../ui/src/Menu/Placeholder.tsx";
import { RowPlaceholder } from "../../../../../../ui/src/Row/Placeholder.tsx";
import type { RowProps } from "../../../../../../ui/src/Row/props.ts";
import { StatesPlaceholder } from "../../../../../../ui/src/States/Placeholder.tsx";
import { esc, section, skeleton } from "./html.ts";
import { atRiskOf } from "./read.ts";
import type { HomeSession } from "./session.ts";

const SCREEN = "home.projects-at-risk";

function riskMenu(rule: string): string {
  return MenuPlaceholder({
    source: "context",
    items: [
      { head: rule },
      { label: "Overdue", icon: "clock" },
      { label: "Blocked", icon: "ban" },
      { label: "Slipped", icon: "alert" },
    ],
  });
}

export function atRiskRule(session: HomeSession): string {
  const snap = session.hooks.query(SCREEN, "projects", {}).getSnapshot();
  if (snap.status !== "ready") return "";
  return atRiskOf(snap.data).rule;
}

export function renderProjects(session: HomeSession): string {
  const snap = session.hooks.query(SCREEN, "projects", {}).getSnapshot();
  const title = "Projects at risk";
  if (snap.status !== "ready") return section("projects-at-risk", title, skeleton("projects-at-risk", 3));
  const view = atRiskOf(snap.data);
  const attrs = view.rule ? ` data-rule="${esc(view.rule)}"` : "";
  const menu = view.rule ? `<div data-menu="at-risk">${riskMenu(view.rule)}</div>` : "";
  if (view.projects.length === 0) {
    const empty = StatesPlaceholder({ kind: "empty", title: "No projects at risk", icon: "done" });
    return section("projects-at-risk", title, `${menu}${empty}`, attrs);
  }
  const rows = view.projects.map((project) => {
    const props: RowProps = { id: project.recordId, title: project.title, selected: false, hovered: false };
    const note = project.reasons.join(", ");
    if (note) props.note = note;
    return `<div data-project="${esc(project.recordId)}" data-kbd="Enter" data-hover="row">${RowPlaceholder(props)}</div>`;
  }).join("");
  return section("projects-at-risk", title, `${menu}${rows}`, attrs);
}
