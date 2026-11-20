// What a deploy that waits for a person, or that a person denied, is called in the site's failed list: shared by the tick that asks (release.ts) and the record of it (hook.ts).
/** How long a deploy that waits for a person is not asked for again: the card is still there. */
export const WAITING_MS = 24 * 60 * 60 * 1000;
/** The words of a deploy that waits for a person (the site's card, and what the tick looks for before asking again). */
export const WAITING_PREFIX = "Waiting for a person";
/** The words of a deploy a person said no to: that commit is not asked for again, a newer one is. */
export const DENIED_PREFIX = "Denied by a person";
