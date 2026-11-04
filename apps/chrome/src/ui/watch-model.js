// @ts-check
// The parts of Watch a page that the worker and the side panel both need, with no browser in them: the rhythms on offer, where a watch runs, and the one line a watch gets in a list.

/** Frequencies the sheet offers, in minutes. */
export const FREQS = Object.freeze([
  { min: 15, label: "Every 15 minutes" }, { min: 30, label: "Every 30 minutes" }, { min: 60, label: "Every hour" },
  { min: 120, label: "Every 2 hours" }, { min: 360, label: "Every 6 hours" }, { min: 1440, label: "Every day" },
]);

/** @param {number} min */
export function freqLabel(min) {
  const f = FREQS.find((x) => x.min === min);
  if (f) return f.label;
  if (min % 1440 === 0) return `Every ${min / 1440} days`;
  if (min % 60 === 0) return `Every ${min / 60} hours`;
  return `Every ${min} minutes`;
}

/**
 * Where a watch runs: on the agent's computer when the agent has one, else in My Chrome. A choice for the computer is only honoured while there is one.
 * @param {boolean} hasComputer @param {"computer" | "chrome" | null} choice
 * @returns {"computer" | "chrome"}
 */
export function runsOnFor(hasComputer, choice) {
  if (choice === "chrome") return "chrome";
  return hasComputer ? "computer" : "chrome";
}

/** "40 min ago", "3 h ago", "2 days ago". @param {number} ms */
export function agoWords(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const hrs = Math.round(m / 60);
  if (hrs < 48) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} days ago`;
}

/**
 * The one line under a watch's name. @param {{ state?: string, everyMinutes: number, changes?: number, lastChange?: { at: number }, lastCheckedAt?: number, error?: string }} w @param {number} now
 */
export function watchLine(w, now) {
  if (w.state === "paused") return "Paused";
  if (w.state === "error") return `Can't read it${w.error ? `: ${w.error}` : ""}`;
  const when = w.lastChange ? `Changed ${agoWords(now - w.lastChange.at)}` : w.lastCheckedAt ? `No change since ${agoWords(now - w.lastCheckedAt)}` : "Not checked yet";
  return `${freqLabel(w.everyMinutes)} · ${when}`;
}
