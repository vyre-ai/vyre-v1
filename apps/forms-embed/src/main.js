// @ts-check
// The browser glue (spec 2.11): reads the definition the host put in the page, draws the form, turns events into controller calls and draws again. No dependencies. A draw
// replaces the form's markup, so the focused control is put back by its id and caret position, and after a step or a failed send focus goes where the person needs it.
// A captcha widget on the page calls window.vyreFormCaptcha(token) with its token; file uploads are passed by the host with window.vyreFormUpload.

import { parseDefinition } from "./definition.js";
import { createController } from "./controller.js";

/** @param {HTMLElement} root @param {ReturnType<typeof createController>} c */
function mount(root, c) {
  const draw = () => {
    const active = /** @type {HTMLElement | null} */ (document.activeElement);
    const keep = active && root.contains(active) ? { id: active.id, start: /** @type {HTMLInputElement} */ (active).selectionStart, end: /** @type {HTMLInputElement} */ (active).selectionEnd } : null;
    root.innerHTML = c.html();
    const want = c.focus;
    /** @type {HTMLElement | null} */
    let target = null;
    if (want === "thanks") target = root.querySelector("#vf-thanks");
    else if (want === "step") target = root.querySelector(".vf-form input, .vf-form select, .vf-form textarea, .vf-form button");
    else if (want && want.startsWith("error:")) target = root.querySelector(`[data-field="${CSS.escape(want.slice(6))}"] input, [data-field="${CSS.escape(want.slice(6))}"] select, [data-field="${CSS.escape(want.slice(6))}"] textarea, #vf-consent`);
    if (!target && keep && keep.id) {
      target = root.querySelector(`#${CSS.escape(keep.id)}`);
      if (target && keep.start !== null && "setSelectionRange" in target) try { /** @type {HTMLInputElement} */ (target).setSelectionRange(keep.start, keep.end); } catch { /* not a text control */ }
    }
    target?.focus({ preventScroll: false });
  };

  /** @param {HTMLElement} el */
  const read = el => {
    const input = /** @type {HTMLInputElement} */ (el);
    const name = input.name;
    if (!name) return;
    if (name === "consent") { c.setConsent(input.checked); return; }
    if (input.type === "checkbox" && root.querySelectorAll(`input[name="${CSS.escape(name)}"]`).length > 1) {
      c.set(name, [...root.querySelectorAll(`input[name="${CSS.escape(name)}"]:checked`)].map(x => /** @type {HTMLInputElement} */ (x).value));
    } else if (input.type === "checkbox") c.set(name, input.checked);
    else if (input.type === "file") c.set(name, [...(input.files ?? [])].map(f => Object.assign(f, { fileId: undefined })));
    else c.set(name, input.value);
  };

  root.addEventListener("input", e => { const t = /** @type {HTMLElement} */ (e.target); if (t.matches("input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea")) read(t); });
  root.addEventListener("change", e => { read(/** @type {HTMLElement} */ (e.target)); c.html(); draw(); });
  root.addEventListener("click", async e => {
    const t = /** @type {HTMLElement} */ (e.target).closest("[data-action=back]");
    if (t) { c.back(); draw(); }
  });
  root.addEventListener("submit", async e => {
    e.preventDefault();
    const action = /** @type {HTMLElement | null} */ (root.querySelector("[data-primary]"))?.getAttribute("data-action");
    if (action === "submit") { const p = c.submit(); draw(); await p; draw(); }
    else { await c.next(); draw(); }
  });
  /** @type {any} */ (window).vyreFormCaptcha = (/** @type {string} */ token) => { c.setCaptcha(String(token)); draw(); };
  draw();
}

const el = document.getElementById("vyre-form");
const root = document.getElementById("vyre-form-root");
if (el && root) {
  /** @type {unknown} */
  let raw = null;
  try { raw = JSON.parse(el.textContent ?? "null"); } catch { raw = null; }
  const parsed = parseDefinition(raw);
  if (parsed.def) {
    const w = /** @type {any} */ (window);
    mount(root, createController({
      def: parsed.def, search: location.search, referrer: document.referrer, href: location.href, userAgent: navigator.userAgent,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, fetch: (url, init) => fetch(url, init),
      ...(typeof w.vyreFormUpload === "function" ? { upload: w.vyreFormUpload } : {}), assign: url => location.assign(url),
    }));
  } else {
    root.textContent = "This form is not available.";
  }
}
