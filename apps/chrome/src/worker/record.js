// @ts-check
// "Show Vyre how" in the worker (prototype "Show it once"): start a recording on a tab, collect the steps the page script sends (content/record.js), keep a small masked picture
// of each, and on Stop open the review page. The review page (src/review) edits the recording here; Save as skill turns it into SKILL.md and replay.json (skill.js) and adds it
// through skills.mine.add as the signed-in person.
//
// Never recorded: a password, a one-time code or a card number. The page script does not read those fields; a use of one becomes the step "Sign in with Vault" (a login) or an
// input that is asked for each time with no example (a card). Typed values are kept only in session storage, which is memory-only and gone when Chrome closes.
//
// The worker can be stopped by Chrome between two steps, so every change is written to session storage (key vyre.rec for the running one, vyre.recs for finished ones).

import { maskedShot } from "./shot.js";
import { BridgeFailure } from "./protocol.js";
import { applyEdits, buildSkill, cleanUrl, inputsOf, words } from "./skill.js";

export const MAX_STEPS = 60;
const SHOT = { maxW: 520, quality: 0.55 };
const SHOT_GAP_MS = 600;
/** A page change this soon after a click or a key is that action's result, not a step of its own. */
const CAUSED_MS = 2500;
/** A username typed this recently before a password is part of the same sign-in. */
const LOGIN_MS = 120_000;
const USERISH = /user|e-?mail|login|account|phone|member|id\b/i;
const SUBMITISH = /sign.?in|log.?in|continue|next|submit|verify|enter/i;
const KEEP_FINISHED = 6;

/** @typedef {import("./skill.js").Recording} Recording */
/** @typedef {import("./skill.js").Step} Step */

/** @param {unknown} u */
function hostOf(u) { try { return new URL(String(u)).hostname.replace(/^www\./, ""); } catch { return ""; } }

/**
 * @param {{ ext: any, bridge: { invoke(c: string, i?: any): Promise<any>, op(o: string, i?: any): Promise<any> }, privacy: { of(tab: any): Promise<any> }, now?: () => number, shot?: typeof maskedShot, sleep?: (ms: number) => Promise<void> }} deps
 */
export function createRecorder({ ext, bridge, privacy, now = Date.now, shot = maskedShot, sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const area = ext.storage && ext.storage.session ? ext.storage.session : null;
  /** @type {null | { rec: Recording, tabs: number[], paused: boolean, lastActionAt: number, secret: boolean }} */
  let live = null;
  let loaded = false;
  /** @type {Promise<any>} */
  let queue = Promise.resolve();
  let seq = 0;

  const newId = () => `rec_${now().toString(36)}${(++seq).toString(36)}`;
  const stepId = (/** @type {Recording} */ rec) => `s${rec.steps.length ? Number(rec.steps[rec.steps.length - 1].id.slice(1)) + 1 : 1}`;

  async function load() {
    if (loaded) return;
    loaded = true;
    if (!area) return;
    const kept = await area.get(["vyre.rec"]);
    const v = kept["vyre.rec"];
    if (v && v.rec && Array.isArray(v.tabs)) live = v;
  }
  async function persist() {
    if (!area) return;
    if (live) await area.set({ "vyre.rec": live }); else await area.remove(["vyre.rec"]);
  }
  /** @returns {Promise<Record<string, Recording>>} */
  async function finished() {
    if (!area) return memory;
    const kept = await area.get(["vyre.recs"]);
    return kept["vyre.recs"] && typeof kept["vyre.recs"] === "object" ? kept["vyre.recs"] : {};
  }
  /** @type {Record<string, Recording>} */
  let memory = {};
  /** @param {Record<string, Recording>} all */
  async function keep(all) {
    const ids = Object.keys(all).sort((a, b) => (all[a].endedAt || 0) - (all[b].endedAt || 0));
    for (const id of ids.slice(0, Math.max(0, ids.length - KEEP_FINISHED))) delete all[id];
    if (area) await area.set({ "vyre.recs": all }); else memory = all;
  }

  /** Tell every recorded tab how the recording stands (the bar draws it). @param {boolean} [done] */
  async function broadcast(done = false) {
    if (!live) return;
    const msg = { type: "vyre.rec.state", paused: live.paused, count: live.rec.steps.length, secret: live.secret, done };
    for (const id of live.tabs) { try { await ext.tabs.sendMessage(id, msg); } catch { /* the page is loading; it asks when it is ready */ } }
  }

  /** @param {number} tabId */
  async function inject(tabId) {
    try { await ext.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["src/content/record.js"] }); } catch { /* a page we may not script */ }
  }

  // Chrome lets an extension take two screenshots of a tab a second; a step that comes sooner waits its turn, so every step still gets its picture
  let lastShot = 0;
  /** @param {number} tabId */
  const picture = async (tabId) => {
    const wait = lastShot + SHOT_GAP_MS - now();
    if (wait > 0) await sleep(wait);
    lastShot = now();
    try { const s = await shot(ext, tabId, SHOT); return s ? s.dataUrl : null; } catch { return null; }
  };

  /** @param {Partial<Step> & { kind: Step["kind"], url: string }} s @param {number} [tabId] */
  async function add(s, tabId) {
    if (!live || live.rec.steps.length >= MAX_STEPS) return null;
    const step = /** @type {Step} */ ({ id: stepId(live.rec), host: hostOf(s.url), at: now(), shot: tabId === undefined ? null : await picture(tabId), ...s, url: cleanUrl(s.url) });
    live.rec.steps.push(step);
    live.lastActionAt = now();
    return step;
  }

  /** @param {Step | undefined} s @param {string} host */
  const isLoginFor = (s, host) => Boolean(s && s.kind === "signin" && s.host === host);

  /** Handle one message from the page script. @param {number} tabId @param {any} tab @param {any} m */
  async function handleStep(tabId, tab, m) {
    await load();
    if (!live || live.paused || !live.tabs.includes(tabId)) return;
    const may = await privacy.of(tab);
    if (!may.read) return; // a site that is never sent is not recorded
    const url = cleanUrl(String(m.url || tab.url || ""));
    const host = hostOf(url);
    const steps = live.rec.steps;
    const last = steps[steps.length - 1];
    const recent = live.lastActionAt && now() - live.lastActionAt < LOGIN_MS;
    live.lastActionAt = now(); // whatever the person just did, the page change that follows is its result
    switch (m.kind) {
      case "secret": {
        live.secret = true;
        const what = String(m.what || "password");
        if (what === "card") {
          const t = m.target && typeof m.target === "object" ? { role: String(m.target.role || "textbox"), name: String(m.target.name || "Card detail").slice(0, 80) } : { role: "textbox", name: "Card detail" };
          if (!(last && last.kind === "type" && last.secret && last.target && last.target.name === t.name)) await add({ kind: "type", url, target: t, value: "", secret: true }, tabId);
          break;
        }
        if (isLoginFor(last, host)) break;
        // the username typed just before belongs to the sign-in: the Vault fills it
        if (last && last.kind === "type" && last.host === host && recent && last.target && (USERISH.test(last.target.name) || last.target.type === "email")) steps.pop();
        await add({ kind: "signin", url }, tabId);
        break;
      }
      case "click": {
        // the Sign in button, still on the login page, is part of the sign-in
        if (isLoginFor(last, host) && url === last.url && now() - last.at < 60_000 && (m.submit || (m.target && SUBMITISH.test(String(m.target.name || ""))))) { last.at = now(); break; }
        await add({ kind: "click", url, target: m.target }, tabId);
        break;
      }
      case "press": {
        if (isLoginFor(last, host)) break;
        if (last && last.kind === "press" && now() - last.at < 400) break;
        await add({ kind: "press", url, value: "Enter" }, tabId);
        break;
      }
      case "type":
      case "select": {
        const target = m.target;
        const value = String(m.value ?? "");
        if (last && last.kind === m.kind && last.target && target && last.target.name === target.name && last.host === host && !last.secret) { last.value = value; last.at = now(); break; }
        await add({ kind: m.kind, url, target, value }, tabId);
        break;
      }
      default: break;
    }
    live.rec.inputs = inputsOf(live.rec.steps);
    await persist();
    await broadcast();
  }

  return {
    get running() { return Boolean(live); },
    /** The shape the panel and the bar show. */
    async state() {
      await load();
      return live ? { running: true, paused: live.paused, count: live.rec.steps.length, name: live.rec.name, secret: live.secret } : { running: false };
    },

    /**
     * Start recording on a tab. Refused in incognito and on a site that is never sent.
     * @param {any} tab @param {{ name?: string }} [o]
     */
    async start(tab, o = {}) {
      await load();
      if (live) throw new BridgeFailure("not_allowed", "A recording is already running.");
      const may = await privacy.of(tab);
      if (may.why === "incognito") throw new BridgeFailure("incognito", "");
      if (!may.read) throw new BridgeFailure(may.why === "never" ? "never_site" : "no_page", "");
      const host = hostOf(tab.url);
      /** @type {Recording} */
      const rec = { id: newId(), name: String(o.name || "").trim().slice(0, 120) || `Task on ${host}`, startedAt: now(), steps: [], inputs: [] };
      live = { rec, tabs: [tab.id], paused: false, lastActionAt: now(), secret: false };
      await add({ kind: "open", url: String(tab.url) }, tab.id);
      await persist();
      await inject(tab.id);
      await broadcast();
      return { id: rec.id };
    },

    /** The page script asks how things stand when it loads. @param {number} tabId */
    async hello(tabId) {
      await load();
      return live && live.tabs.includes(tabId) ? { paused: live.paused, count: live.rec.steps.length, secret: live.secret } : { done: true };
    },

    /** One step from a page. Steps are handled one at a time, in the order they came. @param {number} tabId @param {any} tab @param {any} m */
    step(tabId, tab, m) {
      queue = queue.then(() => handleStep(tabId, tab, m)).catch(() => {});
      return queue;
    },

    /** Pause, resume or stop from the bar or the panel. @param {"pause" | "resume" | "stop"} op */
    async control(op) {
      await load();
      if (!live) return { running: false };
      await queue;
      if (op === "pause") { live.paused = true; await persist(); await broadcast(); return { running: true, paused: true }; }
      if (op === "resume") { live.paused = false; live.lastActionAt = now(); await persist(); await broadcast(); return { running: true, paused: false }; }
      // stop
      const rec = live.rec;
      rec.endedAt = now();
      rec.inputs = inputsOf(rec.steps);
      await broadcast(true);
      const all = await finished();
      all[rec.id] = rec;
      await keep(all);
      live = null;
      await persist();
      try { await ext.tabs.create({ url: ext.runtime.getURL(`src/review/review.html?rec=${encodeURIComponent(rec.id)}`) }); } catch { /* the review can be opened from the panel */ }
      return { running: false, id: rec.id };
    },

    /** A tab finished loading: the page script is gone with the old page, so put it back. @param {number} tabId @param {{ status?: string, url?: string }} info @param {any} tab */
    async tabUpdated(tabId, info, tab) {
      await load();
      if (!live || !live.tabs.includes(tabId)) return;
      if (info.status === "complete") { await inject(tabId); await broadcast(); }
      // a change of address nobody caused (a typed address, a redirect, a link opened in this tab) is a step; one that follows a click or a key is that step's result
      if (info.url && !live.paused && now() - live.lastActionAt > CAUSED_MS) {
        const may = await privacy.of(tab);
        const last = live.rec.steps[live.rec.steps.length - 1];
        if (may.read && !(last && last.kind === "open" && last.url === info.url)) { await queue; await add({ kind: "open", url: info.url }, tabId); await persist(); await broadcast(); }
      }
    },

    /** A tab was opened by a recorded tab (a link in a new tab): it is recorded too. @param {any} tab */
    async tabCreated(tab) {
      await load();
      if (live && tab && typeof tab.openerTabId === "number" && live.tabs.includes(tab.openerTabId) && !live.tabs.includes(tab.id)) { live.tabs.push(tab.id); await persist(); }
    },

    /** @param {number} tabId */
    async tabClosed(tabId) {
      await load();
      if (live && live.tabs.includes(tabId)) { live.tabs = live.tabs.filter((t) => t !== tabId); await persist(); }
    },

    // ---------- the review page

    /** @param {string} id */
    async get(id) {
      const rec = (await finished())[id];
      if (!rec) throw new BridgeFailure("not_available", "That recording is gone. Record it again.");
      return { rec, saved: rec["saved"] ?? null, words: rec.steps.map((s) => words(s, rec.inputs)) };
    },
    /** @param {string} id @param {Parameters<typeof applyEdits>[1]} edit */
    async edit(id, edit) {
      const all = await finished();
      const rec = all[id];
      if (!rec) throw new BridgeFailure("not_available", "That recording is gone. Record it again.");
      const next = { ...applyEdits(rec, edit), saved: rec["saved"] };
      all[id] = next;
      await keep(all);
      return { rec: next, words: next.steps.map((s) => words(s, next.inputs)) };
    },
    /** @param {string} id */
    async discard(id) {
      const all = await finished();
      delete all[id];
      await keep(all);
      return { discarded: true };
    },
    /**
     * Save the reviewed recording as one of the person's skills. `agents` are the agents that use it ("*" for all of them).
     * @param {string} id @param {{ agents?: string[] }} [o]
     */
    async save(id, o = {}) {
      const all = await finished();
      const rec = all[id];
      if (!rec) throw new BridgeFailure("not_available", "That recording is gone. Record it again.");
      if (!rec.steps.length) throw new BridgeFailure("not_allowed", "There is nothing to save: every step was removed.");
      const skill = buildSkill(rec);
      const agents = Array.isArray(o.agents) ? o.agents.map((a) => String(a).slice(0, 80)).filter(Boolean).slice(0, 50) : [];
      const prior = /** @type {any} */ (rec)["saved"];
      const out = await bridge.invoke("skills.mine.add", { text: skill.text, files: skill.files, source: "chrome:recording", ...(agents.length ? { agents } : {}), ...(prior && prior.skillId ? { replaces: prior.skillId } : {}) });
      const row = out && out.skill ? out.skill : {};
      const saved = { skillId: String(row.skillId || ""), name: String(row.label || row.name || skill.name), agents };
      all[id] = { ...rec, saved };
      await keep(all);
      return { saved, steps: rec.steps.length };
    },
    /** Add the saved skill to all the person's agents (the share card's first button). @param {string} id @param {string[]} [agents] */
    async addToAgents(id, agents = ["*"]) {
      const rec = (await finished())[id];
      const saved = rec && /** @type {any} */ (rec)["saved"];
      if (!saved || !saved.skillId) throw new BridgeFailure("not_allowed", "Save the skill first.");
      await bridge.invoke("skills.mine.set", { skillId: saved.skillId, enabled: true, agents });
      const all = await finished();
      all[id] = { ...all[id], saved: { ...saved, agents } };
      await keep(all);
      return { agents };
    },
    /** Share the saved skill with chosen people, or everyone in the Space (cards go to them, each decides), or take it back. @param {string} id @param {{ space?: boolean, stop?: boolean, to?: string[] }} o */
    async share(id, o) {
      const rec = (await finished())[id];
      const saved = rec && /** @type {any} */ (rec)["saved"];
      if (!saved || !saved.skillId) throw new BridgeFailure("not_allowed", "Save the skill first.");
      const out = await bridge.invoke("skills.share", { skillId: saved.skillId, ...(o.stop ? { stop: true } : Array.isArray(o.to) && o.to.length ? { to: o.to.map((x) => String(x).slice(0, 80)).slice(0, 50) } : { space: Boolean(o.space) }) });
      return { sharedWith: out && Array.isArray(out.sharedWith) ? out.sharedWith : [] };
    },
    /** Try it: ask an agent, in a new chat, to run the skill. The chat is the place to follow it. @param {string} id @param {string} agentId */
    async tryIt(id, agentId) {
      const rec = (await finished())[id];
      const saved = rec && /** @type {any} */ (rec)["saved"];
      if (!saved || !saved.skillId) throw new BridgeFailure("not_allowed", "Save the skill first.");
      const asks = rec.inputs.filter((i) => i.mode === "ask");
      const text = `Run the skill "${saved.name}" once to test it. ${asks.length ? `Use the example values it was shown with (${asks.map((i) => `${i.label}: ${i.example || "ask me"}`).join("; ")}). ` : ""}Tell me what you did at each step and stop if anything looks different.`;
      const out = await bridge.op("chat.ask", { agentId, text, from: "chrome" });
      return { threadId: out && out.threadId ? String(out.threadId) : null };
    },
  };
}
