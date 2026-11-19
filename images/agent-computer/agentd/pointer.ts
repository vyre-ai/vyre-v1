// Where the agent last acted on a page, in the page's own pixels (the viewport), for the desk's cursor (lane r42-computer): the point it moved to, the box of the element it chose when it named one, and what
// it was doing. `seq` counts the actions, so a viewer draws each once. Never the text of a field and never a value: the label is the element's own visible name, cut to 60 characters.
export interface Pointer {
  seq: number;
  tool: string;
  x: number;
  y: number;
  box?: { x: number; y: number; w: number; h: number };
  label?: string;
  at: number;
}
interface Chosen {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

export function createPointerNote(now: () => number = Date.now): {
  /** The tool now running (set at the start of each browser tool). */
  during(tool: string): void;
  /** The element a tool chose, before it presses (its box in page pixels and its visible name). */
  chose(box: Chosen): void;
  /** The agent pressed or moved at this point: one more action. The chosen element's box rides along only when the point is its centre (within 2 px), so a coordinate click never borrows another element's box. */
  at(x: number, y: number): void;
  get(): Pointer | null;
} {
  let seen: Pointer | null = null;
  let seq = 0;
  let next: Chosen | null = null;
  let tool = "";
  return {
    during(t) {
      tool = t;
    },
    chose(box) {
      next = box;
    },
    at(x, y) {
      seq += 1;
      const near = next !== null && Math.abs(next.x + next.w / 2 - x) <= 2 && Math.abs(next.y + next.h / 2 - y) <= 2;
      seen = {
        seq,
        tool,
        x,
        y,
        at: now(),
        ...(near && next
          ? {
              box: { x: next.x, y: next.y, w: next.w, h: next.h },
              ...(next.label ? { label: next.label.slice(0, 60) } : {}),
            }
          : {}),
      };
      next = null;
    },
    get: () => seen,
  };
}

/** What the page says about the element a tool chose, raw: the label is made from it here, where it can be tested, never in the page. */
export interface LabelInput {
  tag: string;
  type: string;
  aria: string;
  text: string;
  value: string;
  title: string;
  name: string;
  placeholder: string;
  id: string;
  autocomplete: string;
}
const SENSITIVE =
  /pass(word|wd|code)?|pwd|otp|one.?time|2fa|mfa|verification|security.?code|token|secret|\bpin\b|cvv|cvc|card.?number|ssn/i;
/** A field that holds a secret: a password or code by its type, its autocomplete, or by what it is called. */
export function isSecretField(i: LabelInput): boolean {
  if (i.type.toLowerCase() === "password") return true;
  if (/password|one-time-code/i.test(i.autocomplete)) return true;
  return SENSITIVE.test(`${i.name} ${i.id} ${i.aria} ${i.placeholder}`);
}
const FIELD_TAGS = new Set(["input", "textarea", "select"]);
const BUTTON_TYPES = new Set(["submit", "button", "reset"]);
/**
 * The element's visible name for the desk and for a held action's words (at most 120 characters). The text a person has typed or a page has filled into a field is never the name: for any field the name is
 * its aria-label, placeholder or title, and a field that holds a secret (a password, a one-time code) is named only by its own aria-label, placeholder or name, never by its value or any text on it, even when that
 * value is shown on the page. A button's value is its name.
 */
export function labelOf(i: LabelInput): string {
  const tag = i.tag.toLowerCase();
  const field = FIELD_TAGS.has(tag);
  const clean = (v: string): string => v.trim().replace(/\s+/g, " ");
  let out: string;
  if (isSecretField(i)) out = i.aria || i.placeholder || i.name || "";
  else if (field && BUTTON_TYPES.has(i.type.toLowerCase())) out = i.aria || i.value || i.title || i.name;
  else if (field) out = i.aria || i.placeholder || i.title || i.name;
  else out = i.aria || i.text || i.title || i.name;
  return clean(out).slice(0, 120);
}
