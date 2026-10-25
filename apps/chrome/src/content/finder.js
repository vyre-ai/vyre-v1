// @ts-check
// Finds the sign-in fields on a page. A classic content script: it adds `finder` to the extension's own isolated-world namespace
// (globalThis.__vyreExt), which autofill.js, capture.js and the service worker's scripting calls share. It never reads a value.
// There is no passkey code here or anywhere in the extension: navigator.credentials and WebAuthn are the browser's own (owner, 24 Oct).
(function () {
  /** @type {any} */
  const g = globalThis;
  const ns = (g.__vyreExt = g.__vyreExt || {});

  const OTP_HINT = /(^|[^a-z])(otp|totp|2fa|mfa|one[-_ ]?time|verification|authenticator|security[-_ ]?code|passcode|auth[-_ ]?code)([^a-z]|$)/i;
  const USER_HINT = /(user|login|email|e-mail|account|identifier|member|signin|sign-in)/i;
  const SEARCH_HINT = /(search|query|\bq\b|coupon|promo|zip|postal|captcha)/i;
  const TEXTY = new Set(["", "text", "email", "tel", "number", "url"]);

  /** @param {any} el */
  function attrs(el) {
    const a = (/** @type {string} */ n) => String((el.getAttribute ? el.getAttribute(n) : el[n]) ?? "");
    return { type: a("type").toLowerCase(), name: a("name"), id: a("id"), auto: a("autocomplete").toLowerCase(), placeholder: a("placeholder"), label: a("aria-label"), maxlength: Number(a("maxlength")) || 0, role: a("role").toLowerCase() };
  }

  /** @param {any} el */
  function isVisible(el) {
    if (!el || el.disabled || el.readOnly) return false;
    if (attrs(el).type === "hidden") return false;
    if (typeof el.getClientRects === "function") return el.getClientRects().length > 0;
    return true;
  }

  /**
   * What a field is for: "password", "otp", "username" or null.
   * @param {any} el
   */
  function classify(el) {
    const a = attrs(el);
    if (a.type === "password") return "password";
    if (!TEXTY.has(a.type)) return null;
    if (a.role === "searchbox" || a.type === "search") return null;
    const words = `${a.name} ${a.id} ${a.placeholder} ${a.label}`;
    if (a.auto === "one-time-code") return "otp";
    if (OTP_HINT.test(words) && (a.maxlength === 0 || a.maxlength <= 10)) return "otp";
    if (SEARCH_HINT.test(words) && !USER_HINT.test(words)) return null;
    if (a.auto === "username" || a.auto === "email" || a.auto === "webauthn" || a.type === "email") return "username";
    if (USER_HINT.test(words)) return "username";
    return null;
  }

  /**
   * The login fields in a document or form: the password (or a one-time-code field) and the username before it.
   * @param {any} root document or form
   * @returns {{ username: any | null, password: any | null, otp: any | null, extraPassword: any | null, form: any | null }}
   */
  function findLoginFields(root) {
    const inputs = Array.from(root.querySelectorAll("input")).filter(isVisible);
    const passwords = inputs.filter((i) => classify(i) === "password");
    const password = passwords[0] ?? null;
    const extraPassword = passwords[1] ?? null;
    const otp = inputs.find((i) => classify(i) === "otp") ?? null;
    let username = null;
    const anchor = password ?? otp;
    if (anchor) {
      const at = inputs.indexOf(anchor);
      for (let i = at - 1; i >= 0; i--) {
        if (classify(inputs[i]) === "username") { username = inputs[i]; break; }
      }
      if (!username) username = inputs.slice(0, Math.max(at, 0)).reverse().find((i) => TEXTY.has(attrs(i).type) && classify(i) !== "otp" && classify(i) !== null) ?? null;
    } else {
      // A username-only first step (many sites ask for the address, then show the password).
      username = inputs.find((i) => classify(i) === "username") ?? null;
    }
    return { username, password, otp, extraPassword, form: (password ?? otp ?? username)?.form ?? null };
  }

  /** True when the form is a sign-up or change-password form: two password fields, or autocomplete new-password. @param {any} fields */
  function looksLikeSignup(fields) {
    if (!fields.password) return false;
    if (fields.extraPassword) return true;
    return attrs(fields.password).auto === "new-password";
  }

  ns.finder = { classify, isVisible, findLoginFields, looksLikeSignup };
})();
