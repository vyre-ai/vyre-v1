// @ts-check
// Fills page fields on the worker's command. Three calls, made by the service worker through chrome.scripting in this same
// isolated world: `prepare` names the fields it would fill (refs, never values), `apply` puts one value into one ref, `submit` presses sign in.
// The value arrives as an argument, goes into the field and is not kept: no variable, storage or log holds it after the call.
(function () {
  /** @type {any} */
  const g = globalThis;
  const ns = (g.__vyreExt = g.__vyreExt || {});
  /** @type {Map<string, any>} */
  const refs = new Map();
  let counter = 0;

  /** @param {number} n */
  function makeRef(n) {
    const bytes = new Uint8Array(8);
    (g.crypto || { getRandomValues: (/** @type {Uint8Array} */ b) => b.fill(n % 251) }).getRandomValues(bytes);
    return "f" + n + "-" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  /**
   * Which of the wanted roles ("username", "password", "otp") this frame has a field for, as refs.
   * @param {{ roles: string[] }} want
   * @returns {{ fields: { ref: string, role: string }[], signup: boolean }}
   */
  function prepare(want) {
    const found = ns.finder.findLoginFields(g.document);
    /** @type {{ ref: string, role: string }[]} */
    const fields = [];
    refs.clear();
    for (const role of want.roles) {
      const el = role === "username" ? found.username : role === "password" ? found.password : role === "otp" ? found.otp : null;
      if (!el) continue;
      const ref = makeRef(++counter);
      refs.set(ref, el);
      fields.push({ ref, role });
    }
    return { fields, signup: ns.finder.looksLikeSignup(found) };
  }

  /**
   * Put one value in the field a ref names, the way a person typing would: focus, set through the native setter so frameworks see it, then input and change.
   * @param {string} ref @param {string} value
   */
  function apply(ref, value) {
    const el = refs.get(ref);
    refs.delete(ref);
    if (!el) return false;
    try {
      if (typeof el.focus === "function") el.focus();
      const proto = Object.getPrototypeOf(el);
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, value); else el.value = value;
      const Ev = g.Event;
      el.dispatchEvent(new Ev("input", { bubbles: true, composed: true }));
      el.dispatchEvent(new Ev("change", { bubbles: true }));
      return true;
    } catch {
      return false;
    }
  }

  /** Submit the form the password (or code, or username) field belongs to: requestSubmit, else the submit button, else Enter. */
  function submit() {
    const found = ns.finder.findLoginFields(g.document);
    const target = found.password ?? found.otp ?? found.username;
    const form = target && target.form;
    if (form && typeof form.requestSubmit === "function") { form.requestSubmit(); return true; }
    const button = form && form.querySelector && form.querySelector("button[type=submit], input[type=submit], button:not([type])");
    if (button && typeof button.click === "function") { button.click(); return true; }
    if (target && typeof target.dispatchEvent === "function") {
      const Ke = g.KeyboardEvent;
      target.dispatchEvent(new Ke("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      return true;
    }
    return false;
  }

  /** Forget every ref (the worker calls this when a fill finishes or is abandoned). */
  function forget() { refs.clear(); }

  ns.autofill = { prepare, apply, submit, forget };
})();
