// While you were away. The digest is a synced row, so the section still renders when the device is offline.

import { RowPlaceholder } from "../../../../../../ui/src/Row/Placeholder.tsx";
import type { RowProps } from "../../../../../../ui/src/Row/props.ts";
import { StatesPlaceholder } from "../../../../../../ui/src/States/Placeholder.tsx";
import { faceName } from "./faces.ts";
import { esc, section, skeleton } from "./html.ts";
import { digestOf } from "./read.ts";
import type { HomeSession } from "./session.ts";

const SCREEN = "home.away-digest";
const TITLE = "While you were away";
const EMPTY = "Nothing happened while you were away";

export function renderDigest(session: HomeSession): string {
  const snap = session.hooks.query(SCREEN, "digest", {}).getSnapshot();
  const offline = session.online ? "" : ` data-offline="open"`;
  if (snap.status !== "ready") {
    if (!session.online) {
      const saved = StatesPlaceholder({ kind: "offline", title: "While you were away is saved on this device", icon: "offline" });
      return section("away-digest", TITLE, saved, offline);
    }
    return section("away-digest", TITLE, skeleton("away-digest", 4));
  }
  const digest = digestOf(snap.data);
  if (!digest || digest.seenAt !== undefined) {
    return section("away-digest", TITLE, StatesPlaceholder({ kind: "empty", title: EMPTY, icon: "done" }), offline);
  }
  const by = `<p data-built-by="${esc(digest.builtBy)}">Written by ${esc(faceName(session.faces, digest.builtBy))}</p>`;
  const lines = digest.headline.map((line) => `<p data-headline="true">${esc(line)}</p>`).join("");
  const items = digest.items.map((item) => {
    const props: RowProps = { title: item.title, note: item.line, selected: false, hovered: false };
    const undo = item.kind === "decision" && item.runId
      ? `<button type="button" data-action="undo" data-run="${esc(item.runId)}" data-kbd="Enter" data-hover="control">Undo</button>`
      : "";
    return `<div data-digest-kind="${esc(item.kind)}" data-kbd="Enter" data-hover="row">${RowPlaceholder(props)}${undo}</div>`;
  }).join("");
  const seeAll = `<button type="button" data-action="see-all" data-since="${digest.periodStart}" data-kbd="Enter" data-hover="control">See all</button>`;
  return section("away-digest", TITLE, `${by}${lines}${items}${seeAll}`, offline);
}
