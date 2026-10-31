// ActionShape at run time (see syncspec.ts): a list answer becomes the engine's { rows, next }, a create answer becomes { id }, and flat values become a nested body.
// An item with no id is refused with the item's place in the answer, so a wrong pointer in a spec shows up as a clear failure and never as silently missing records.
import { pointerGet } from "../projections.ts";
import type { ActionShape } from "../projections.ts";
import { coerceValue, readPage } from "../syncspec.ts";
import type { SpecCursor, SpecFieldType } from "../syncspec.ts";

export interface ShapedRow { id: string; data: Record<string, unknown>; updatedAt?: string | number }

export function shapeList(body: unknown, link: string | undefined, shape: ActionShape, after: string | undefined): { rows: ShapedRow[]; next?: string } {
  const cursor = (shape.cursor ?? { kind: "none" }) as SpecCursor;
  const page = readPage(body, link, { itemsAt: shape.items ?? "", id: shape.id ?? "", ...(shape.updatedAt ? { updatedAt: shape.updatedAt } : {}) }, cursor, after);
  if (!page) throw new ShapeError(`The answer has no list at ${shape.items === "" ? "the top" : shape.items}.`);
  const rows = page.items.map((item, i): ShapedRow => {
    const raw = pointerGet(item, shape.id ?? "");
    if (typeof raw !== "string" && typeof raw !== "number") throw new ShapeError(`Item ${i} has no id at ${shape.id}.`);
    const data: Record<string, unknown> = {};
    for (const p of shape.fields ?? []) {
      const c = coerceValue(pointerGet(item, p), (shape.types?.[p] ?? "text") as SpecFieldType, shape.choices?.[p]);
      data[p] = c.ok ? c.value : null;
    }
    const stamp = shape.updatedAt ? pointerGet(item, shape.updatedAt) : undefined;
    // an epoch number is seconds or milliseconds; the engine reads a date string or milliseconds
    const at = typeof stamp === "number" ? (stamp > 1e11 ? stamp : stamp * 1000) : stamp;
    return { id: String(raw), data, ...(typeof at === "string" || typeof at === "number" ? { updatedAt: at } : {}) };
  });
  return { rows, ...(page.next !== undefined ? { next: page.next } : {}) };
}

export class ShapeError extends Error {}

/** The id of a record the app just made, by the action's pointer into the answer. */
export function shapeCreated(body: unknown, shape: ActionShape): { id: string } | undefined {
  if (shape.idAt === undefined) return undefined;
  const v = pointerGet(body, shape.idAt);
  return typeof v === "string" || typeof v === "number" ? { id: String(v) } : undefined;
}
