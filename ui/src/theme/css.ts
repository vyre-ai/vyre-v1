// Style rules put in through the sheet (insertRule), not as the text of a <style> tag. A page whose CSP carries a style nonce (the packaged desktop app) drops the text of a <style> that
// script made, and the rules in it never apply; rules inserted into the element's own sheet are not subject to that, so a list that relied on one injected stylesheet still lays out.

type StyleEl = { id: string; textContent: string | null; sheet?: { cssRules: { length: number }; insertRule(rule: string, index?: number): number } | null };
export interface CssDoc { head?: { appendChild(n: unknown): unknown } | null; getElementById?(id: string): unknown; createElement?(tag: string): unknown }

/** The top-level rules of a stylesheet text: split where a block closes back to depth 0, so @media and @font-face stay whole. */
export function splitRules(css: string): string[] {
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { out.push(css.slice(start, i + 1).trim()); start = i + 1; } }
  }
  const rest = css.slice(start).trim();
  if (rest) out.push(rest);
  return out.filter(Boolean);
}

/** Adds one stylesheet to the document head once (by id). False when there is no document or it was already there. */
export function injectCss(doc: CssDoc | undefined, id: string, css: string): boolean {
  if (!doc || !doc.head || !doc.createElement || !doc.getElementById || doc.getElementById(id)) return false;
  const el = doc.createElement("style") as StyleEl;
  el.id = id;
  doc.head.appendChild(el);
  const sheet = el.sheet;
  if (!sheet) { el.textContent = css; return true; }
  for (const rule of splitRules(css)) {
    try { sheet.insertRule(rule, sheet.cssRules.length); } catch { /* a rule this engine does not know is left out */ }
  }
  return true;
}
