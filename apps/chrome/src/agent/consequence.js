// @ts-check
// from vyre 0.6.9 modules/hands-chrome/consequence.js@dbd2dfbab
// Which actions may be retried, and which may only be done once. "Do it, check, replay if unsure" works where tasks are resettable; a person's are not:
// replaying "send the update" sends it twice. So every activation is classified before it is taken.
//
// v1 change (spec 3.12, manifests/computers.ts): in 0.6 the hands refused a consequential control outright because no Gate existed. Now it is HELD: the
// act returns a heldId, nothing is pressed, and only chrome_send (gate: send, the person approves) presses it. And a readable name that matches nothing below
// is free to press (a link called "Pricing"): in 0.6 it was refused, which made browsing unusable. The default for an unreadable control stays "matters".

// Matched against the control's name, case-insensitively, as whole words where it matters. "Resend" contains "send" and must still be consequential.
export const CONSEQUENTIAL = Object.freeze([
  { kind: "send", re: /\bsend\b|\bresend\b|\breply\b|\bforward\b/i },
  { kind: "post", re: /\bpost\b|\bpublish\b|\bshare\b|\btweet\b/i },
  { kind: "payment", re: /\bpay\b|\bcharge\b|\bpurchase\b|\bcheckout\b|\bsubscribe\b|\bbuy\b|\bplace order\b|\bdonate\b|\$\s?\d/i },
  { kind: "delete", re: /\bdelete\b|\bremove\b|\btrash\b|\berase\b|\bdiscard\b|\bcancel (subscription|plan|account|order)\b|\bclose account\b/i },
  { kind: "submit", re: /\bsubmit\b|\bconfirm\b|\bapprove\b|\bapply (now|for)\b|\bcomplete (order|purchase|payment|booking)\b|\bregister\b|\bsign up\b|\bagree and (continue|submit)\b/i },
  { kind: "deploy", re: /\bmerge\b|\bpush\b|\bdeploy\b|\brelease\b|\btransfer\b|\bwire\b/i },
  { kind: "access", re: /\bsign out\b|\blog ?out\b|\bsign (the|this|document|agreement|contract)\b|\binvite\b|\badd member\b|\bgrant\b|\bauthori[sz]e\b|\brevoke\b|\bconnect\b|\binstall\b|\bunsubscribe\b/i },
]);

/** A link that leaves for a consent, sign-in, payment or deletion page. */
export const RISKY_HREF = /oauth|authori[sz]e|consent|checkout|payment|delete|logout|signout|sign-out|billing|grant/i;
/** Input-like controls: clicking or toggling one only focuses or sets it, whatever its label says ("Send to", "Subscribe to updates"). The page names the role, so it is believed for these and for nothing else. */
export const PASSIVE_ROLES = /^(?:textbox|searchbox|combobox|slider|spinbutton|checkbox|radio|switch|listbox)$/i;
/** A form-submit control with one of these names moves on or looks something up; it does not send anything out. */
export const BENIGN_SUBMIT = /^(?:sign ?in|log ?in|search|next|continue|go|back|filter|apply filters?|update|refresh|reload|show results?|find)$/i;

/**
 * @typedef {{ consequential: boolean, kind: "send" | "post" | "payment" | "delete" | "submit" | "deploy" | "access" | "unreadable" | "form" | "link" | "none", why: string }} Verdict
 * @param {{ name?: string | undefined, nameless?: boolean | undefined, role?: string | undefined, submit?: boolean | undefined, href?: string | undefined, formSubmit?: string | undefined }} ctl
 * @returns {Verdict}
 */
export function of(ctl) {
  const name = String((ctl && ctl.name) || "").trim();
  if (ctl && PASSIVE_ROLES.test(String(ctl.role || "").trim())) return { consequential: false, kind: "none", why: "typing, focusing or setting a field" };
  if (!name || (ctl && ctl.nameless)) {
    return { consequential: true, kind: "unreadable", why: "cannot read what this control does, so it is treated as one that matters" };
  }
  for (const c of CONSEQUENTIAL) {
    if (c.re.test(name)) return { consequential: true, kind: /** @type {Verdict["kind"]} */ (c.kind), why: `${JSON.stringify(name)} looks like an action that cannot be undone by doing it again` };
  }
  if (ctl && ctl.submit === true && !BENIGN_SUBMIT.test(name)) return { consequential: true, kind: "form", why: `${JSON.stringify(name)} submits a form` };
  if (ctl && typeof ctl.href === "string" && RISKY_HREF.test(ctl.href)) return { consequential: true, kind: "link", why: `${JSON.stringify(name)} leads to a consent, sign-in, payment or deletion page` };
  return { consequential: false, kind: "none", why: "navigating, focusing or selecting" };
}

/**
 * Pressing Enter in a field submits its form: it is as consequential as the form's own submit control.
 * @param {{ formSubmit?: string | undefined }} ctl
 * @returns {Verdict}
 */
export function ofEnter(ctl) {
  if (!ctl || !ctl.formSubmit) return { consequential: false, kind: "none", why: "Enter in a field with no form to submit" };
  const v = of({ name: ctl.formSubmit, role: "button", submit: true });
  return v.consequential ? { ...v, why: `Enter would press ${JSON.stringify(ctl.formSubmit)}: ${v.why}` } : v;
}

/** May this action be tried a second time if the first appeared to miss? @param {Parameters<typeof of>[0]} ctl */
export const retryable = (ctl) => !of(ctl).consequential;
