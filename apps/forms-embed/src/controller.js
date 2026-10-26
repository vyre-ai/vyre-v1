// @ts-check
// The form's behaviour without a page (spec 2.11): answers, steps, validation, partial save for a link, submit, the thank-you and every way a submit can fail. The browser glue
// (main.js) only turns events into calls on this and draws what renderForm gives for its state, so everything that matters is tested here without a browser.

import { captureAttribution, readUrlKeys } from "./attribution.js";
import { renderForm } from "./html.js";
import { resolve } from "./logic.js";
import { fieldsOfStep, nextStep, prevStep, stepList, submission, validate } from "./steps.js";

/** @typedef {import("./definition.js").FormDefinition} FormDefinition @typedef {import("./html.js").State} State */
/**
 * @typedef {{ status: number, json(): Promise<unknown> }} Reply
 * @typedef {(url: string, init: { method: string, headers: Record<string, string>, body: string }) => Promise<Reply>} Fetch
 * @typedef {{
 *   def: FormDefinition, fetch: Fetch, search?: string, referrer?: string, href?: string, userAgent?: string, timeZone?: string, base?: string,
 *   upload?: (file: unknown) => Promise<string>, assign?: (url: string) => void
 * }} Options
 */

const MESSAGES = /** @type {Record<string, string>} */ ({
  "rate_limit.exceeded": "Too many tries. Wait a minute and send it again.",
  "auth.invalid_code": "This link is not valid any more. Ask for a new one.",
  "validation.too_large": "Those answers are too large to send.",
  "provider.unavailable": "The check could not run. Try again in a moment.",
});

/** @param {Options} o */
export function createController(o) {
  const base = (o.base ?? "").replace(/\/+$/, "");
  const { prefill, hide } = readUrlKeys(o.search ?? "", o.def);
  /** @type {State} */
  let state = {
    status: "editing", step: stepList(o.def, {})[0] ?? 0, history: [], answers: { ...prefill, ...(o.def.partial?.answers ?? {}) }, errors: {}, consent: false,
  };
  if (o.def.partial) {
    const wanted = o.def.partial.step;
    const steps = stepList(o.def, state.answers);
    state.step = steps.includes(wanted) ? wanted : (steps.find(s => s >= wanted) ?? steps[steps.length - 1] ?? 0);
    state.history = steps.filter(s => s < state.step);
  }
  /** Fields the URL hides are not drawn or checked on the page, but what they hold is still sent. */
  const viewDef = () => ({ ...o.def, fields: o.def.fields.map(f => (hide.has(f.field) ? { ...f, mode: /** @type {const} */ ("hide") } : f)) });
  /** @type {string | null} */
  let focus = null;

  const request = o.fetch;   // the injected transport; the bundle never names the global call (boundary B4)
  const post = async (/** @type {string} */ path, /** @type {unknown} */ body) => {
    const r = await request(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = /** @type {any} */ (await r.json().catch(() => ({})));
    return { status: r.status, ok: r.status >= 200 && r.status < 300, data: json?.data, error: json?.error };
  };

  const answersNow = () => submission(o.def, state.answers);

  /** Moves to the step that holds a field, with the steps before it as the way back. */
  const goToFieldStep = (/** @type {string | undefined} */ field) => {
    const f = o.def.fields.find(x => x.field === field);
    const steps = stepList(viewDef(), state.answers);
    if (f && steps.includes(f.step) && f.step !== state.step) state = { ...state, step: f.step, history: steps.filter(s => s < f.step) };
  };

  const api = {
    get state() { return state; },
    /** where the page should put focus after the next draw: "error:<field>", "step" or "thanks" */
    get focus() { return focus; },
    get hidden() { return hide; },
    html() {
      const def = viewDef();
      return renderForm(def, state, resolve(def, state.answers).required);
    },
    set(/** @type {string} */ field, /** @type {unknown} */ value) {
      if (!o.def.fields.some(f => f.field === field && f.mode === "ask")) return;
      const { [field]: _gone, ...rest } = state.errors;
      state = { ...state, answers: { ...state.answers, [field]: value }, errors: rest };
    },
    setConsent(/** @type {boolean} */ on) {
      const { consent: _c, ...rest } = state.errors;
      state = { ...state, consent: on, errors: rest };
    },
    setCaptcha(/** @type {string} */ token) {
      const { captcha: _c, ...rest } = state.errors;
      state = { ...state, captcha: token, errors: rest };
    },
    /** Next: check this step, remember the answers for a link, move on. Returns whether it moved. */
    async next() {
      if (state.status !== "editing") return false;
      const def = viewDef();
      const errors = validate(def, state.answers, fieldsOfStep(def, state.answers, state.step).map(f => f.field));
      if (Object.keys(errors).length > 0) {
        state = { ...state, errors, banner: "Check the highlighted answers." };
        focus = `error:${Object.keys(errors)[0]}`;
        return false;
      }
      const to = nextStep(def, state.answers, state.step);
      if (to === null) return false;
      state = { ...state, history: [...state.history, state.step], step: to, errors: {} };
      delete state.banner;
      focus = "step";
      // a link keeps the answers so the person can come back; it is best effort and never blocks the form
      if (o.def.token) post("/f/partial", { slug: o.def.slug, token: o.def.token, answers: answersNow(), step: to }).catch(() => {});
      return true;
    },
    back() {
      if (state.status !== "editing") return false;
      const to = state.history[state.history.length - 1] ?? prevStep(o.def, state.answers, state.step);
      if (to === undefined || to === null) return false;
      state = { ...state, step: to, history: state.history.slice(0, -1), errors: {} };
      delete state.banner;
      focus = "step";
      return true;
    },
    /** Send. Returns true when the answers were accepted. */
    async submit() {
      if (state.status !== "editing") return false;
      const def = viewDef();
      /** @type {Record<string, string>} */
      const errors = validate(def, state.answers);
      if (o.def.consentText && !state.consent) errors.consent = "Please accept the statement to continue.";
      if (o.def.captcha && !state.captcha) errors.captcha = "Complete the check to continue.";
      if (Object.keys(errors).length > 0) {
        // go to the first step that has a problem
        const bad = def.fields.find(f => errors[f.field] !== undefined);
        state = { ...state, errors, banner: "Check the highlighted answers." };
        goToFieldStep(bad?.field);
        focus = `error:${bad ? bad.field : Object.keys(errors)[0]}`;
        return false;
      }
      state = { ...state, status: "sending", errors: {} };
      delete state.banner;
      try {
        const answers = { ...state.answers };
        for (const f of o.def.fields) {
          if (f.type !== "files" || answers[f.field] === undefined) continue;
          const list = Array.isArray(answers[f.field]) ? /** @type {unknown[]} */ (answers[f.field]) : [answers[f.field]];
          if (list.some(x => typeof /** @type {any} */ (x)?.fileId !== "string") && !o.upload) throw new Error("uploads");
          answers[f.field] = await Promise.all(list.map(async x => (typeof /** @type {any} */ (x)?.fileId === "string" ? x : { fileId: await /** @type {NonNullable<Options["upload"]>} */ (o.upload)(x) })));
        }
        const sent = submission(o.def, answers);
        if (o.def.consentText) sent.consent = true;
        const res = await post("/f/submit", {
          slug: o.def.slug, answers: sent, ...(o.def.token ? { token: o.def.token } : {}), ...(state.captcha ? { captcha: state.captcha } : {}),
          attribution: captureAttribution({ search: o.search ?? "", referrer: o.referrer ?? "", href: o.href ?? "", userAgent: o.userAgent ?? "", ...(o.timeZone ? { timeZone: o.timeZone } : {}), consent: state.consent && Boolean(o.def.consentText) }),
        });
        if (res.ok) {
          const redirect = o.def.thankYou.redirect;
          const text = redirect ? o.def.thankYou.text : (typeof res.data?.thankYou === "string" ? res.data.thankYou : o.def.thankYou.text);
          state = { ...state, status: "done", thanks: { ...(text ? { text } : {}), ...(redirect ? { redirect } : {}) } };
          focus = "thanks";
          if (redirect && o.assign) o.assign(redirect);
          return true;
        }
        const code = String(res.error?.code ?? "");
        if (code === "validation.duplicate") {
          state = { ...state, status: "done", thanks: { text: "This was already sent. Thank you." } };
          focus = "thanks";
          return true;
        }
        /** @type {Record<string, string>} */
        const mapped = {};
        const field = typeof res.error?.details?.field === "string" ? String(res.error.details.field).replace(/^answers\./, "") : "";
        const message = MESSAGES[code] ?? (typeof res.error?.message === "string" ? res.error.message : "Something went wrong. Try again.");
        if (field && (o.def.fields.some(f => f.field === field) || field === "consent")) mapped[field] = message;
        state = { ...state };
        if (code === "auth.invalid_code" && o.def.captcha && !o.def.token) { mapped.captcha = "The check did not pass. Try again."; delete state.captcha; }
        state = { ...state, status: "editing", errors: mapped, banner: Object.keys(mapped).length > 0 ? "Check the highlighted answers." : message };
        const first = Object.keys(mapped)[0];
        goToFieldStep(first);
        focus = first ? `error:${first}` : "step";
        return false;
      } catch (e) {
        const upload = e instanceof Error && e.message === "uploads";
        state = { ...state, status: "editing", banner: upload ? "File uploads are not available on this form yet." : "We could not reach the server. Your answers are still here; send it again." };
        focus = "step";
        return false;
      }
    },
  };
  return api;
}
