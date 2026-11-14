// The guard for "an id is never shown to a person" (owner, 13 Nov 2026). Call it on a rendered tree (component tests) or on the text of a page (real-app walks: apps/app/tests/crash-guard.ts runs it after
// every step). It fails with the ids it found and the text around the first one.
import assert from "node:assert/strict";
import { rawIdsIn } from "../../../lib/id-shapes.ts";
import { textOf } from "./dom.ts";
import type { Node } from "./dom.ts";

/** What a person (or a screen reader) is given by rendered markup: the text between tags and the words in aria-label, title, placeholder and alt. Test ids and class names are not shown to anyone. */
export function shownText(html: string): string {
  const words = [...html.matchAll(/\s(?:aria-label|title|placeholder|alt)="([^"]*)"/g)].map((m) => m[1]!).join(" ");
  return `${html
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")} ${words}`;
}

/** Ids inside shown text; empty when the screen is clean. */
export const idsShown = (text: string): string[] => rawIdsIn(text);

/** Fails when the rendered tree (or a text) shows an id as content. `where` names the screen in the message. */
export function assertNoRawIds(tree: Node | string | null, where: string): void {
  const text = typeof tree === "string" ? (tree.includes("<") ? shownText(tree) : tree) : textOf(tree);
  const ids = idsShown(text);
  const at = ids[0] === undefined ? 0 : text.indexOf(ids[0]);
  assert.deepEqual(
    ids,
    [],
    `${where}: an id is shown to the person (${ids.join(", ")}) near "${text.slice(Math.max(0, at - 40), at + 60).replace(/\s+/g, " ")}"`,
  );
}
