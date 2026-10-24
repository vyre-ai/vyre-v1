// Today's routines, one line each (spec 3.1).

import { RowPlaceholder } from "../../../../../../ui/src/Row/Placeholder.tsx";
import type { RowProps } from "../../../../../../ui/src/Row/props.ts";
import { StatesPlaceholder } from "../../../../../../ui/src/States/Placeholder.tsx";
import { faceName } from "./faces.ts";
import { esc, section, skeleton } from "./html.ts";
import { routinesOf } from "./read.ts";
import type { HomeSession } from "./session.ts";

const SCREEN = "home.routines-today";
const TITLE = "Today's routines";

export function renderRoutines(session: HomeSession): string {
  const snap = session.hooks.query(SCREEN, "routines", {}).getSnapshot();
  if (snap.status !== "ready") return section("routines-today", TITLE, skeleton("routines-today", 3));
  const routines = routinesOf(snap.data);
  if (routines.length === 0) {
    return section("routines-today", TITLE, StatesPlaceholder({ kind: "empty", title: "No routines today", icon: "done" }));
  }
  const rows = routines.map((routine) => {
    const who = faceName(session.faces, routine.agentId);
    const detail = routine.resultLine ? `${routine.state}: ${routine.resultLine}` : routine.state;
    const props: RowProps = {
      id: routine.routineId,
      title: routine.title,
      note: `${who}. ${detail}`,
      selected: false,
      hovered: false,
    };
    return `<div data-routine="${esc(routine.routineId)}" data-state="${esc(routine.state)}" data-kbd="Enter" data-hover="row">${RowPlaceholder(props)}</div>`;
  }).join("");
  return section("routines-today", TITLE, rows);
}
