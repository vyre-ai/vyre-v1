// @ts-check
// Notices a sign-in or sign-up that the person submitted, and tells the service worker the username and the password so it can
// offer to save. It only reacts to trusted events (a real person's click or Enter, never a script), and the message never carries an
// address: the worker takes the page's origin from the browser (sender), not from us. Nothing is stored here.
(function () {
  /** @type {any} */
  const g = globalThis;
  const ns = (g.__vyreExt = g.__vyreExt || {});
  if (ns.captureInstalled) return;
  ns.captureInstalled = true;

  /** Pull what a submit carries out of a form, or null when it is not a login. @param {any} form */
  function read(form) {
    const f = ns.finder.findLoginFields(form);
    if (!f.password || !f.password.value) return null;
    const signup = ns.finder.looksLikeSignup(f);
    // On a sign-up the password is the first field; on a change-password form the new one is the last.
    const password = String(f.password.value);
    const username = f.username ? String(f.username.value || "") : "";
    return { username, password, kind: signup ? "signup" : "signin" };
  }

  /** @param {any} form */
  function report(form) {
    const got = read(form);
    if (!got) return;
    try {
      g.chrome.runtime.sendMessage({ type: "vyre.submit", username: got.username, password: got.password, kind: got.kind });
    } catch { /* the extension was reloaded; nothing to do */ }
  }

  g.document.addEventListener("submit", (/** @type {any} */ e) => {
    if (!e.isTrusted) return;
    report(e.target);
  }, true);

  // Sign-in screens that never submit a form (a button with a script): the Enter key in the password field, or a click on a button.
  g.document.addEventListener("keydown", (/** @type {any} */ e) => {
    if (!e.isTrusted || e.key !== "Enter") return;
    const el = e.target;
    if (!el || !ns.finder || ns.finder.classify(el) !== "password" || el.form) return;
    report(g.document);
  }, true);
  g.document.addEventListener("click", (/** @type {any} */ e) => {
    if (!e.isTrusted) return;
    const b = e.target && e.target.closest ? e.target.closest("button, [role=button], input[type=submit]") : null;
    if (!b || (b.form && typeof b.form.requestSubmit === "function")) return;
    report(g.document);
  }, true);

  ns.capture = { read };
})();
