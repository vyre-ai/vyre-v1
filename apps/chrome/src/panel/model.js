// @ts-check
// The side panel's state rules, kept apart from the DOM so they are tested on their own (tests/ext-panel.test.ts).

/** Two quiet suggestions for an empty chat, from what the page is. @param {{ host: string, title: string, record: { name: string, kind: string } | null }} p */
export function suggestions(p) {
  if (p.record && /contact|person|lead/i.test(p.record.kind)) return [`What should I know about ${p.record.name} before we talk?`, `Summarize ${p.record.name}'s activity`];
  if (p.record) return [`What is new on ${p.record.name}?`, "Summarize this page"];
  if (!p.host) return [];
  return ["Summarize this page", "What should I do next here?"];
}

/**
 * The chips in the composer. The page chip shows when the site may be read and the person has not removed it (on "ask" sites it starts removed); the Selected chip
 * is separate and shows whenever there is a selection the person has not removed.
 * @param {{ privacy: { read: boolean, mode: string } | null, pageRemoved: boolean | null, selection: string, selectionRemoved: boolean }} s
 */
export function chips(s) {
  const may = Boolean(s.privacy && s.privacy.read);
  const removed = s.pageRemoved === null ? Boolean(s.privacy && s.privacy.mode === "ask") : s.pageRemoved;
  return { page: may && !removed, selected: may && Boolean(s.selection.trim()) && !s.selectionRemoved, canAttach: may && removed, never: Boolean(s.privacy && !s.privacy.read) };
}

/**
 * A streamed reply arriving: the delta carries the whole reply so far. Returns the new conversation.
 * @param {{ id: string, who: string, text: string, at: number, turnId?: string, streaming?: boolean, error?: string | null }[]} conv
 * @param {{ turnId: string, text: string, done: boolean, error: string | null }} d @param {string} who @param {number} at
 */
export function applyDelta(conv, d, who, at) {
  const i = conv.findIndex((m) => m.turnId === d.turnId);
  const msg = { id: `t_${d.turnId}`, who, text: d.text, at, turnId: d.turnId, streaming: !d.done, error: d.error };
  if (i < 0) return [...conv, msg];
  const next = conv.slice();
  next[i] = { ...conv[i], text: d.text, streaming: !d.done, error: d.error };
  return next;
}

/** Search results: those on this site first ("On this page"), then the rest ("Earlier"). @param {{ host?: string | null }[]} threads @param {string | null} host */
export function groupThreads(threads, host) {
  const here = host ? threads.filter((t) => t.host === host) : [];
  return { here, earlier: threads.filter((t) => !here.includes(t)) };
}

/**
 * The live models, grouped by provider for the model picker, the agent's default first in the picker's last row. Nothing here is a list of models: it is all from
 * engine.models.list. A model the account may not use is listed greyed with the reason.
 * @param {{ id: string, provider: string, title: string, allowed: boolean, reason: string | null, isDefault: boolean }[]} models
 */
export function modelGroups(models) {
  /** @type {Map<string, typeof models>} */
  const by = new Map();
  for (const m of models) { const g = by.get(m.provider) ?? []; g.push(m); by.set(m.provider, g); }
  const NAMES = /** @type {Record<string,string>} */ ({ anthropic: "Claude", openai: "OpenAI", google: "Gemini", openrouter: "OpenRouter", ollama: "On this computer" });
  return [...by.entries()].map(([provider, list]) => ({ provider, title: NAMES[provider] ?? provider, models: list }));
}

export const WHY_NOT = Object.freeze({ label_provider: "Not for this chat's label", policy_model: "Turned off by your Space", not_connected: "Not connected", usage_limit: "Usage limit reached" });

/** The label on the model picker: the picked model's title, else the default's. @param {{ id: string, title: string, isDefault: boolean }[]} models @param {string} picked */
export function modelLabel(models, picked) {
  const m = models.find((x) => x.id === picked) ?? models.find((x) => x.isDefault);
  return m ? m.title : "Default model";
}

/** "2d", "5h", "now". @param {number | string | null | undefined} at @param {number} now */
export function ago(at, now) {
  const t = typeof at === "number" ? at : at ? Date.parse(String(at)) : NaN;
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** A stable hue for a name (faces and the Space tile). @param {string} s */
export function hue(s) {
  let h = 7;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return [250, 160, 28, 205, 330, 95, 12, 280][h % 8];
}
