// @ts-check
// from vyre 0.6.9 modules/hands-chrome/snapshot.js@dbd2dfbab
// A page read as an accessibility tree with element refs (chrome_snapshot). The page script is page.js `collectPage`; this turns its answer into the text an agent
// reads and the refs it names. Secret fields never show a value, only that they hold one and how long it is; filled Vault handles are masked the same way.

import { MASK, maskText, maskUrl } from "./mask.js";
import * as selector from "./selector.js";

/**
 * @typedef {{ k: "c", idx: number, depth: number, role: string, path: string, enabled: boolean, name?: string, nameless?: boolean, identifier?: string, container?: string, checked?: boolean, secret?: boolean,
 *   submit?: boolean, formSubmit?: string, href?: string, focused?: boolean, value?: string, length?: number, offscreen?: boolean, frame: { x: number, y: number, w: number, h: number } }} Control
 * @typedef {Control | { k: "g", role: string, name: string, depth: number } | { k: "h", level: number, name: string, depth: number }} Node
 * @typedef {{ title: string, url: string, text: string, viewport: { w: number, h: number }, nodes: Node[], controls: Control[], truncated: boolean }} Snapshot
 */

/** @param {any} raw what collectPage returned @returns {Snapshot} */
export function toSnapshot(raw) {
  const nodes = /** @type {Node[]} */ (Array.isArray(raw && raw.nodes) ? raw.nodes : []);
  return {
    title: String((raw && raw.title) || ""), url: String((raw && raw.url) || ""), text: String((raw && raw.text) || ""),
    viewport: (raw && raw.viewport) || { w: 0, h: 0 }, nodes, controls: /** @type {Control[]} */ (nodes.filter((n) => n.k === "c")), truncated: Boolean(raw && raw.truncated),
  };
}

/** The ref an agent names a control by: its position in the snapshot it was read from. @param {{ idx: number }} c */
export const refOf = (c) => `e${c.idx + 1}`;

/** What binds each ref again later. @param {Snapshot} snap @returns {Map<string, selector.Selector>} */
export function refMap(snap) {
  return new Map(snap.controls.map((c) => [refOf(c), selector.of(c)]));
}

/**
 * The tree as text. `limit` cuts it at a line boundary and says so.
 * @param {Snapshot} snap @param {number} [limit]
 */
export function renderTree(snap, limit = 60_000) {
  const lines = [`page ${JSON.stringify(maskText(snap.title))} ${maskUrl(snap.url)}`];
  for (const n of snap.nodes) {
    const pad = "  ".repeat(n.depth + 1);
    if (n.k === "g") lines.push(`${pad}${n.role}${n.name ? ` ${JSON.stringify(maskText(n.name))}` : ""}`);
    else if (n.k === "h") lines.push(`${pad}heading ${JSON.stringify(maskText(n.name))} (h${n.level})`);
    else {
      let line = `${pad}${n.role}${n.name ? ` ${JSON.stringify(maskText(n.name))}` : ""} [ref=${refOf(n)}]`;
      if (!n.enabled) line += " (disabled)";
      if (n.checked !== undefined) line += n.checked ? " (checked)" : " (unchecked)";
      if (n.focused) line += " (focused)";
      if (n.secret) line += n.length ? ` value=${MASK} (${n.length} characters)` : " (secret, empty)";
      else if (n.value !== undefined) line += ` value=${JSON.stringify(maskText(n.value))}`;
      if (n.href) line += ` -> ${maskUrl(n.href)}`;
      if (n.submit) line += " (submits a form)";
      if (n.offscreen) line += " (off screen)";
      lines.push(line);
    }
  }
  if (snap.truncated) lines.push("  (more controls below the limit; scope with a selector)");
  let out = "";
  let cut = false;
  for (const l of lines) {
    if (out.length + l.length + 1 > limit) { cut = true; break; }
    out += `${out ? "\n" : ""}${l}`;
  }
  return { tree: cut ? `${out}\n(cut here)` : out, truncated: cut || snap.truncated };
}
