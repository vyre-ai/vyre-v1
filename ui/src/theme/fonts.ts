// One root font (P-UI_08). The document sets the skin's sans (--ui) and mono (--mono) stacks on the app root, the overlay roots
// (menus, popovers, dialogs, tooltips, toasts, anything portalled to body) and the canvas label hosts (SVG text, canvas label layers),
// so no screen falls back to the browser serif. Components never set a sans family themselves; only mono-by-meaning (code, keys, ids).
import { typeTokens } from "../tokens/skins.ts";

export const SANS = typeTokens["--ui"];
export const MONO = typeTokens["--mono"];
export const SANS_VAR = `var(--ui, ${SANS})`;
export const MONO_VAR = `var(--mono, ${MONO})`;

/** Hosts that get the sans stack: the document, the app root, every overlay root and the canvas label hosts. */
export const SANS_HOSTS = [
  "html", "body", "#root", "#__next", "[data-vyre-root]",
  "[data-overlay-root]", "[role=menu]", "[role=menubar]", "[role=listbox]", "[role=dialog]", "[role=alertdialog]", "[role=tooltip]", "[role=status]", "[data-portal]",
  "svg text", "svg foreignObject", "[data-canvas-labels]", "[data-canvas-labels] *",
] as const;

/** Hosts that get the mono stack: code and keys by meaning. */
export const MONO_HOSTS = ["code", "pre", "kbd", "samp", "tt", "[data-mono]"] as const;

/** Form controls do not inherit the family by default (the Find input in a map or graph); they take the root's. */
export const INHERIT_HOSTS = ["input", "textarea", "select", "button"] as const;

/** The stylesheet text: three rules, no per-component patches. */
export function rootFontCss(): string {
  return `${SANS_HOSTS.join(",")}{font-family:${SANS_VAR}}` +
    `${INHERIT_HOSTS.join(",")}{font-family:inherit}` +
    `${MONO_HOSTS.join(",")},${MONO_HOSTS.map((h) => `${h} *`).join(",")}{font-family:${MONO_VAR}}`;
}

/** Adds the rule to a document head once (id vyre-root-font); returns false when it was already there or there is no document. */
export function installRootFont(doc: { head?: { appendChild(n: unknown): unknown } | null; getElementById?(id: string): unknown; createElement?(t: string): { id: string; textContent: string | null } } | undefined): boolean {
  if (!doc || !doc.head || !doc.createElement || !doc.getElementById) return false;
  if (doc.getElementById("vyre-root-font")) return false;
  const el = doc.createElement("style");
  el.id = "vyre-root-font";
  el.textContent = rootFontCss();
  doc.head.appendChild(el);
  return true;
}
