import { injectCss } from "../../../../../ui/src/theme/css.ts";
// Names and key order for the builder. Screens import these. An empty list stays empty.

/** Skin token already used for focus. Not a new colour. */
export const FOCUS_TOKEN = "var(--accent-line)";
export const FOCUS_VISIBLE = "outline:2px solid var(--accent-line);outline-offset:2px";

export function focusRingCss(): string {
  return `[data-vyre-focus]:focus-visible,[data-vyre-focus] :focus-visible{${FOCUS_VISIBLE}}`;
}

/** One stylesheet for the builder. No animation. */
export function installFocusRing(): void {
  const doc = (globalThis as { document?: { getElementById(id: string): unknown; head?: { appendChild(node: unknown): void }; createElement(tag: string): { id: string; textContent: string } } }).document;
  if (!doc?.head || !doc.createElement || doc.getElementById("vyre-auto-focus")) return;
  injectCss(doc as never, "vyre-auto-focus", focusRingCss());
}

export function cardLabel(input: { title: string; sub: string; issues: number; chip?: string | null; state?: string | null }): string {
  let label = `${input.title}. ${input.sub}`;
  if (input.chip) label += `. ${input.chip}`;
  const run = runStateText(input.chip, input.state);
  if (run) label += `. ${run}`;
  if (input.issues > 0) label += `. ${input.issues} to fix`;
  return label;
}

/** A run word when the border colour would be the only cue. error, waiting, and tested stay on their chips. */
export function runStateText(chip: string | null | undefined, state: string | null | undefined): string | null {
  if (!state) return null;
  if (chip === state) return null;
  if (chip === "error" && state === "failed") return null;
  if (chip === "waiting" && state === "waiting") return null;
  return state;
}

export function tabLabel(label: string, selected: boolean): string {
  return selected ? `${label}, selected` : label;
}

export function insertLabel(after: string | null | undefined): string {
  const name = after?.trim();
  return name ? `Add a step after ${name}` : "Add the first step";
}

export function triggerLabel(count: number, selected: boolean): string {
  const head = selected ? "Trigger, selected" : "Trigger";
  if (count <= 0) return `${head}. Add a trigger.`;
  const many = count === 1 ? "1 trigger" : `${count} triggers`;
  return `${head}. ${many}. Any one starts a run.`;
}

export function moreLabel(target: string): string {
  const name = target.trim();
  return name ? `More actions for ${name}` : "More actions";
}

/** A shelf row names the field, where it came from, and its type or absence. */
export function mappingLabel(row: { name: string; source: string; typeName: string; presence: string }): string {
  const state = row.presence === "value" ? row.typeName : `${row.typeName}, ${row.presence}`;
  return `Map ${row.name} from ${row.source}, ${state}`;
}

/** Next key for arrows, Home, and End. Same key or an unknown key stays put. */
export function keyNeighbour(keys: readonly string[], current: string, key: string): string | null {
  const i = keys.indexOf(current);
  if (i < 0) return null;
  if (key === "ArrowRight" || key === "ArrowDown") return i + 1 < keys.length ? keys[i + 1]! : null;
  if (key === "ArrowLeft" || key === "ArrowUp") return i > 0 ? keys[i - 1]! : null;
  if (key === "Home") return i === 0 ? null : (keys[0] ?? null);
  if (key === "End") {
    const last = keys[keys.length - 1];
    return last === undefined || last === current ? null : last;
  }
  return null;
}
