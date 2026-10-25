// @ts-check
// The functions the worker runs inside a page through chrome.scripting.executeScript. Each is self-contained (the browser serializes
// it, so it cannot see this module) and only reaches the extension's content scripts through globalThis.__vyreExt.

/** @param {{ roles: string[] }} want */
export function prepareInPage(want) {
  const x = /** @type {any} */ (globalThis).__vyreExt;
  return x && x.autofill ? x.autofill.prepare(want) : { fields: [], signup: false };
}

/** @param {string} ref @param {string} value */
export function applyInPage(ref, value) {
  const x = /** @type {any} */ (globalThis).__vyreExt;
  return Boolean(x && x.autofill && x.autofill.apply(ref, value));
}

export function submitInPage() {
  const x = /** @type {any} */ (globalThis).__vyreExt;
  return Boolean(x && x.autofill && x.autofill.submit());
}

export function forgetInPage() {
  const x = /** @type {any} */ (globalThis).__vyreExt;
  if (x && x.autofill) x.autofill.forget();
  return true;
}

/** @param {any} card */
export function showPromptInPage(card) {
  const x = /** @type {any} */ (globalThis).__vyreExt;
  return Boolean(x && x.prompt && x.prompt.show(card));
}
