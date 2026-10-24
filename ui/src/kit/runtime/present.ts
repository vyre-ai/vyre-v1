// What one list row of a declarative layout shows in a ui/Row: the first text or field is the title, the rest make the note,
// and the first button's action is what pressing the row does. Layouts with more structure than this belong in a builtin.
import type { LayoutNode } from "../types.ts";
import { evalExpr, interpolate, resolvePointer, type Scope } from "./pointer.ts";

export interface RowPresentation {
  title: string;
  note?: string;
  action?: string;
}

function leaves(node: LayoutNode, scope: Scope, out: string[]): void {
  switch (node.t) {
    case "text": { const v = interpolate(node.value, scope).trim(); if (v) out.push(v); return; }
    case "field": {
      const base = resolvePointer(scope, node.bind);
      const v = base && typeof base === "object" ? (base as Record<string, unknown>)[node.field] : undefined;
      if (v !== undefined && v !== null && typeof v !== "object" && String(v) !== "") out.push(String(v));
      return;
    }
    case "stack": case "row": for (const c of node.children) leaves(c, scope, out); return;
    case "when": if (evalExpr(node.expr, scope)) leaves(node.then, scope, out); else if (node.else) leaves(node.else, scope, out); return;
    default: return;
  }
}

/** The first button's action under a node: what pressing a whole row does. */
export function firstAction(node: LayoutNode): string | undefined {
  switch (node.t) {
    case "button": return node.action;
    case "stack": case "row":
      for (const child of node.children) { const a = firstAction(child); if (a) return a; }
      return undefined;
    case "when": return firstAction(node.then) ?? (node.else ? firstAction(node.else) : undefined);
    default: return undefined;
  }
}

export function presentRow(row: LayoutNode, scope: Scope): RowPresentation {
  const text: string[] = [];
  leaves(row, scope, text);
  const action = firstAction(row);
  const out: RowPresentation = { title: text[0] ?? "" };
  if (text.length > 1) out.note = text.slice(1).join("  ");
  if (action) out.action = action;
  return out;
}
