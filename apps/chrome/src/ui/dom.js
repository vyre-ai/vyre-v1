// @ts-check
// Building the extension's own pages node by node. Nothing a page, a person or the app wrote is ever parsed as markup: text goes in as text nodes. The only markup
// parsed is the static icon set (icons.js), as SVG, once.

/**
 * h("button.btn.q", { onclick, title, data: { a: "x" } }, "Label", child) -> an element. Class names ride on the tag after dots. Falsy children are skipped; strings are text.
 * @param {string} tag @param {Record<string, any> | null} [props] @param {...any} children @returns {HTMLElement}
 */
export function h(tag, props, ...children) {
  const [name, ...classes] = tag.split(".");
  const el = document.createElement(name || "div");
  if (classes.length) el.className = classes.join(" ");
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "data") { for (const [dk, dv] of Object.entries(v)) if (dv !== undefined && dv !== null) el.dataset[dk] = String(dv); }
      else if (k === "css") Object.assign(el.style, v);
      else if (k === "class") el.className = [el.className, v].filter(Boolean).join(" ");
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "value") /** @type {any} */ (el).value = v;
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, String(v));
    }
  }
  add(el, children);
  return el;
}

/** @param {Node} el @param {any[]} children */
function add(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false || c === "") continue;
    if (Array.isArray(c)) add(el, c);
    else el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
}

/** Replace an element's children. @param {Element} el @param {...any} children */
export function mount(el, ...children) {
  el.replaceChildren();
  add(el, children);
}
