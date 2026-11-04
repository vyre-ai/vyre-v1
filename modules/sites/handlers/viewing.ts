// Which chat a person has open right now, as their app last said. The app says it when it opens a chat and again every half minute while the chat stays open (sites.chat_viewing). An
// artifact an agent publishes in a turn that person asked is opened for them only while this says the chat is open; otherwise the card in the chat says Open. Memory only: a restart
// forgets, and then a card is all that happens. Nothing here is kept, shown to anyone else, or about where the person is beyond "this chat is open for them".

/** How long a report counts. The app repeats it every 30 seconds. */
export const VIEWING_MS = 75_000;
const MAX = 2000;
const seen = new Map<string, number>();

const keyOf = (person: string, thread: string): string => `${person}|${thread}`;

/** The person's app has this chat open at `now`. */
export function noteViewing(person: string, thread: string, now: number): void {
  if (seen.size >= MAX) for (const [k, until] of seen) if (until <= now) seen.delete(k);
  if (seen.size >= MAX) seen.delete(seen.keys().next().value as string);
  seen.set(keyOf(person, thread), now + VIEWING_MS);
}

/** Whether that person's app reported this chat open within the last VIEWING_MS. */
export function isViewing(person: string, thread: string, now: number): boolean {
  const until = seen.get(keyOf(person, thread));
  if (until === undefined) return false;
  if (until <= now) { seen.delete(keyOf(person, thread)); return false; }
  return true;
}

/** Tests only: forget everything. */
export function forgetViewing(): void { seen.clear(); }
