// The editable source of a form, beside its generated one. HTML is a template in a strict, small grammar: the author's own markup (headings, paragraphs, links, images, lists, tables, simple containers) and
// <vyre-field name="..."></vyre-field> where a record-bound input goes. The inputs themselves are never written by the author: they are made from the form's fields, so they stay bound to record fields
// whatever the markup around them says, and Build (which edits the fields) never touches the author's markup. Anything outside the grammar is REFUSED with where and why, never silently cleaned, so a
// saved source is exactly what the page serves. JavaScript is bounded text that cannot close its own script tag. Pure, no I/O: the module checks on save, the page checks again before it serves.

export const HTML_MAX = 100_000;
export const JS_MAX = 64_000;
const MAX_TAGS = 2000;
const MAX_DEPTH = 24;

const TAGS: Readonly<Record<string, readonly string[]>> = {
  a: ["href", "title", "target", "class", "aria-label"], abbr: ["title", "class"], b: ["class"], blockquote: ["class"], br: [], caption: ["class"], code: ["class"], div: ["class", "aria-label", "role", "lang", "dir"],
  em: ["class"], figure: ["class"], figcaption: ["class"], h1: ["class"], h2: ["class"], h3: ["class"], h4: ["class"], h5: ["class"], h6: ["class"], hr: ["class"], i: ["class"],
  img: ["src", "alt", "width", "height", "class", "title"], li: ["class"], ol: ["class"], p: ["class"], pre: ["class"], section: ["class", "aria-label", "role", "lang", "dir"], small: ["class"], span: ["class", "title", "lang", "dir"],
  strong: ["class"], sub: ["class"], sup: ["class"], table: ["class"], tbody: ["class"], td: ["class", "colspan", "rowspan"], tfoot: ["class"], th: ["class", "colspan", "rowspan", "scope"], thead: ["class"], tr: ["class"], u: ["class"], ul: ["class"],
};
const VOID = new Set(["br", "hr", "img"]);
const FIELD_TAG = "vyre-field";
const FIELD_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const OPEN = /^<([a-z][a-z0-9-]*)((?:\s+[a-z][a-z0-9:-]*(?:="[^"<>]*")?)*)\s*(\/?)>/;
const CLOSE = /^<\/([a-z][a-z0-9-]*)\s*>/;
const ATTR = /\s+([a-z][a-z0-9:-]*)(?:="([^"<>]*)")?/g;

export type SourcePiece = { type: "html"; html: string } | { type: "field"; name: string };
export type SourceCheck = { ok: true; pieces: SourcePiece[]; fields: string[] } | { ok: false; reason: string; at: number };

const line = (s: string, at: number): number => s.slice(0, at).split("\n").length;
const refuse = (s: string, at: number, reason: string): SourceCheck => ({ ok: false, reason: `line ${line(s, at)}: ${reason}`, at });

const urlOk = (name: string, v: string): boolean => {
  if (/&#|&colon;|&tab;|&newline;/i.test(v) || /[\u0000-\u001f\u007f]/.test(v)) return false;
  if (name === "src") return /^https:\/\/[^\s]+$/i.test(v);
  return /^(https:\/\/[^\s]+|mailto:[^\s]+|tel:[+0-9 ()-]+|#[A-Za-z0-9_-]*)$/i.test(v);
};

/** The one check every save and every page view goes through. Returns the template split into the author's markup and the fields it places. */
export function checkFormHtml(html: string): SourceCheck {
  if (html.length > HTML_MAX) return { ok: false, reason: "The HTML is too large.", at: 0 };
  const pieces: SourcePiece[] = [], fields: string[] = [], stack: string[] = [];
  let buf = "", tags = 0, i = 0;
  const flush = (): void => { if (buf !== "") { pieces.push({ type: "html", html: buf }); buf = ""; } };
  while (i < html.length) {
    const c = html[i]!;
    if (c !== "<") { buf += c; i++; continue; }
    const rest = html.slice(i);
    if (rest.startsWith("<!") || rest.startsWith("<?")) return refuse(html, i, "comments, doctypes and processing instructions are not allowed.");
    const close = CLOSE.exec(rest);
    if (close) {
      const name = close[1]!;
      if (name === FIELD_TAG) return refuse(html, i, `</${FIELD_TAG}> has no matching opening tag.`);
      if (!(name in TAGS) || VOID.has(name)) return refuse(html, i, `</${name}> is not an allowed closing tag.`);
      if (stack.at(-1) !== name) return refuse(html, i, `</${name}> does not match the tag that is open${stack.length ? ` (<${stack.at(-1)}>)` : ""}.`);
      stack.pop(); buf += close[0]; i += close[0].length; continue;
    }
    const open = OPEN.exec(rest);
    if (!open) return refuse(html, i, "this is not a tag the form allows. Tags use lowercase names and double-quoted attributes.");
    const name = open[1]!, self = open[3] === "/";
    if (++tags > MAX_TAGS) return { ok: false, reason: "The HTML has too many tags.", at: i };
    const attrs: [string, string][] = [];
    for (const m of (open[2] ?? "").matchAll(ATTR)) attrs.push([m[1]!, m[2] ?? ""]);
    if (new Set(attrs.map(([k]) => k)).size !== attrs.length) return refuse(html, i, `<${name}> repeats an attribute.`);
    if (name === FIELD_TAG) {
      if (attrs.length !== 1 || attrs[0]![0] !== "name" || !FIELD_NAME.test(attrs[0]![1])) return refuse(html, i, `<${FIELD_TAG}> takes exactly one attribute, name="a_field_key".`);
      if (fields.includes(attrs[0]![1])) return refuse(html, i, `the field ${attrs[0]![1]} is placed twice.`);
      // a placed field has no content of its own: it is written <vyre-field name="x"></vyre-field> or <vyre-field name="x"/>
      let length = open[0].length;
      if (!self) { const end = `</${FIELD_TAG}>`; if (!rest.slice(length).startsWith(end)) return refuse(html, i, `<${FIELD_TAG}> has no content: close it straight away with </${FIELD_TAG}>.`); length += end.length; }
      fields.push(attrs[0]![1]); flush(); pieces.push({ type: "field", name: attrs[0]![1] });
      i += length; continue;
    }
    const allowed = TAGS[name];
    if (!allowed) return refuse(html, i, `<${name}> is not allowed. Inputs come from the form's fields (<${FIELD_TAG}>), and code goes in the JavaScript source.`);
    for (const [k, v] of attrs) {
      if (!allowed.includes(k)) return refuse(html, i, `<${name} ${k}> is not allowed.`);
      if (k === "href" || k === "src") { if (!urlOk(k, v)) return refuse(html, i, `${k} must be ${k === "src" ? "an https address" : "an https, mailto or tel address, or a #link"}.`); }
      else if (k === "target") { if (v !== "_blank") return refuse(html, i, 'target can only be "_blank".'); }
      else if (k === "class") { if (!/^[A-Za-z0-9_ -]{0,200}$/.test(v)) return refuse(html, i, "class names use letters, digits, dashes and underscores."); }
      else if (k === "width" || k === "height" || k === "colspan" || k === "rowspan") { if (!/^\d{1,4}$/.test(v)) return refuse(html, i, `${k} is a whole number.`); }
      else if (k === "dir") { if (v !== "ltr" && v !== "rtl") return refuse(html, i, 'dir is "ltr" or "rtl".'); }
      else if (k === "scope") { if (!["row", "col", "rowgroup", "colgroup"].includes(v)) return refuse(html, i, "scope is row, col, rowgroup or colgroup."); }
      else if (k === "role") { if (!["group", "region", "note", "presentation", "list", "listitem", "heading"].includes(v)) return refuse(html, i, "that role is not allowed."); }
      else if (v.length > 300) return refuse(html, i, `${k} is too long.`);
    }
    buf += open[0]; i += open[0].length;
    if (!VOID.has(name) && !self) { stack.push(name); if (stack.length > MAX_DEPTH) return { ok: false, reason: "The HTML is nested too deeply.", at: i }; }
    else if (self && !VOID.has(name)) return refuse(html, i - open[0].length, `<${name}/> must be written <${name}></${name}>.`);
  }
  if (stack.length) return { ok: false, reason: `<${stack.at(-1)}> is never closed.`, at: html.length };
  flush();
  return { ok: true, pieces, fields };
}

/** The author's JavaScript: bounded text that cannot end its own script element or hide behind a comment opener. */
export function checkFormJs(js: string): { ok: true } | { ok: false; reason: string } {
  if (js.length > JS_MAX) return { ok: false, reason: "The JavaScript is too large." };
  if (/<\/script|<!--/i.test(js)) return { ok: false, reason: "The JavaScript may not contain </script or <!--." };
  if (/[\u0000]/.test(js)) return { ok: false, reason: "The JavaScript has a control character it cannot carry." };
  return { ok: true };
}

/** A starting template from the form's questions, in order: the Build-to-Code direction of the roundtrip. */
export function generateFormHtml(fields: readonly { key: string; title: string }[]): string {
  return fields.map((f) => `<${FIELD_TAG} name="${f.key}"></${FIELD_TAG}>`).join("\n") + (fields.length ? "\n" : "");
}
