// @ts-check
// from vyre 0.6.9 modules/hands-chrome/selector.js@dbd2dfbab
// How the agent says "this control" in a way that survives the page moving. A DOM path or a screen point is a property of one observation, not of
// the control: a banner appearing renumbers every path after it, and scrolling moves every point. So a selector is a set of attributes ranked by how far
// they can be trusted, and it is resolved against a FRESH snapshot every time it is used. Nothing here stores a location.

/**
 * @typedef {{ role?: string, identifier?: string, name?: string, container?: string, path?: string }} Selector
 * @typedef {{ role: string, identifier?: string | undefined, name?: string | undefined, container?: string | undefined, path?: string | undefined, enabled?: boolean | undefined }} Described
 */

/** Write down what makes this control itself. @param {Described} ctl @returns {Selector} */
export function of(ctl) {
  /** @type {Selector} */
  const s = { role: ctl.role };
  if (ctl.identifier) s.identifier = ctl.identifier;
  if (ctl.name) s.name = ctl.name;
  if (ctl.container) s.container = ctl.container;
  // Kept only as a tiebreak between siblings that are otherwise identical, never as identity.
  if (ctl.path) s.path = ctl.path;
  return s;
}

// An identifier is the page's own stable handle for a control, so it outranks a name; a name outranks a container; a path is worth almost nothing.
export const WEIGHT = Object.freeze({ identifier: 100, name: 40, container: 10, path: 1 });

/** @param {Selector} sel @param {Described} ctl */
export function score(sel, ctl) {
  // Role is a gate, not a score. A text field is never the button you meant however much else agrees.
  if (sel.role && ctl.role !== sel.role) return -1;
  let n = 0;
  if (sel.identifier && ctl.identifier === sel.identifier) n += WEIGHT.identifier;
  if (sel.name && ctl.name === sel.name) n += WEIGHT.name;
  if (sel.container && ctl.container === sel.container) n += WEIGHT.container;
  if (sel.path && ctl.path === sel.path) n += WEIGHT.path;
  return n;
}

/**
 * The least score that counts as the same control. A control with an identifier or a name must match on one of them. A control with neither (an unlabelled
 * field) can only be told by where it sits, so its container and path together must agree: that is still better than refusing every unlabelled field.
 * @param {Selector} sel
 */
export function threshold(sel) {
  if (sel.identifier) return WEIGHT.identifier;
  if (sel.name) return WEIGHT.name;
  return WEIGHT.path;
}

/**
 * Find this control in a fresh snapshot. `{ control }` or `{ control: null, why }`. No match is a real answer: look again or stop with a reason.
 * Never lower the threshold or take the best of a bad set.
 * @template {Described} C
 * @param {Selector} sel @param {C[]} candidates @param {{ min?: number }} [opts]
 * @returns {{ control: C | null, why?: "unbound" | "tied" }}
 */
export function resolve(sel, candidates, { min = threshold(sel) } = {}) {
  /** @type {C | null} */
  let best = null;
  let bestScore = -1;
  let tied = false;
  for (const c of candidates) {
    const n = score(sel, c);
    if (n > bestScore) { best = c; bestScore = n; tied = false; } else if (n === bestScore && n >= min) tied = true;
  }
  if (bestScore < min) return { control: null, why: "unbound" };
  // Two controls that agree equally well is not a resolution. Say so rather than guess.
  if (tied) return { control: null, why: "tied" };
  return { control: best };
}
