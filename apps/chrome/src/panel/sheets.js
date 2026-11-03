// @ts-check
// The side panel's three sheets for recording and watching (prototype "Show it once" and "Watch a page"): Show Vyre how, Watch this page, and Watching, plus the recording line that
// sits above the chat while a recording runs. Pure drawing: they read the panel's state and name the actions (data-a) the panel runs. Built node by node (ui/dom.js).

import { h } from "../ui/dom.js";
import { face, ic } from "../ui/icons.js";
import { FREQS, freqLabel, runsOnFor, watchLine } from "../ui/watch-model.js";

/** @param {string} a @param {Record<string, any>} [o] */
const act = (a, o = {}) => ({ ...o, data: { a, ...(o["data"] ?? {}) } });

/** @param {string} title @param {string} sub */
const head = (title, sub = "") => h("div.shh", null, h("button.ib", act("sheetX", { "data-tip": "Back", "aria-label": "Back" }), ic("chevl")), h("h3", null, title), sub ? h("span.xs.mut.ell", null, sub) : null);

/** The line above the chat while a recording runs. @param {{ paused?: boolean, count?: number, secret?: boolean }} r */
export function recLine(r) {
  return h("div.recline", { role: "status" },
    h(`span.rdot${r.paused ? ".p" : ""}`), h("span.grow.ell", null, h("b", null, r.paused ? "Paused" : "Recording"), ` · ${r.count ?? 0} step${r.count === 1 ? "" : "s"}`),
    r.secret ? h("span.xs.mut", { css: { display: "flex", gap: "4px", alignItems: "center" } }, ic("lock", "xs"), "Password not recorded") : null,
    h("button.btn", act("recPause"), ic(r.paused ? "play" : "pause", "s"), r.paused ? "Resume" : "Pause"),
    h("button.btn.pri", act("recStop"), ic("stop", "s"), "Stop"));
}

/** Show Vyre how. @param {{ name: string, host: string, error: string, busy: boolean }} s */
export function showSheet(s) {
  const row = (/** @type {string} */ icon, /** @type {any} */ body) => h("div", { css: { display: "flex", gap: "8px", alignItems: "flex-start" } }, h("span", { css: { color: icon === "lock" ? "var(--ok)" : "var(--ink-3)", display: "grid", marginTop: "2px" } }, ic(icon, "s")), h("span", null, body));
  return h("div.sheet", null, head("Show Vyre how"),
    h("div.shb", null,
      h("div.sm.mut2", { css: { lineHeight: "18px" } }, "Do the task once in this window. Vyre writes each step in plain words, finds the parts that change, and saves it as a skill your agents can repeat."),
      h("div.lbl", null, "What are you showing?"),
      h("input.fld", { id: "recname", value: s.name, placeholder: s.host ? `Task on ${s.host}` : "Name it", "aria-label": "What are you showing?", autocomplete: "off" }),
      h("div.lbl", null, "Vyre records"),
      h("div", { css: { display: "flex", flexDirection: "column", gap: "8px", fontSize: "12.5px" } },
        row("check", "Clicks, page changes and what you type in this window"),
        row("check", "A small picture of each step"),
        row("lock", [h("b.b5", { css: { color: "var(--ink)" } }, "Never"), " passwords, codes or card numbers. A sign-in is saved as \"sign in with Vault\"."])),
      s.error ? h("div.note.err", { css: { margin: "12px 0 0" } }, s.error) : null,
      h("div.note", { css: { marginTop: "14px" } }, ic("spark", "s"), h("div", null, "Also in the right-click menu on any page."))),
    h("div.shf", null, h("button.btn.q", act("sheetX"), "Cancel"), h("button.btn.pri", act("recStart", { disabled: s.busy }), ic("rec", "s"), "Start recording")));
}

/**
 * Watch this page.
 * @param {{ page: { host?: string, title?: string } | null, w: { what: "region" | "page", region: { label: string } | null, every: number, agentId: string, run: "computer" | "chrome" | null, picking: boolean, saving: boolean, error: string, note: string },
 *   agents: { id: string, name: string, avatar?: string | null, assistant?: boolean, computer?: boolean }[] }} s
 */
export function watchSheet(s) {
  const w = s.w;
  const agent = s.agents.find((a) => a.id === w.agentId) || s.agents[0] || null;
  const hasPc = Boolean(agent && agent.computer);
  const run = runsOnFor(hasPc, w.run);
  const start = (w.what === "region" && !w.region) || w.saving || !agent;
  return h("div.sheet", null, head("Watch this page", s.page ? s.page.host || "" : ""),
    h("div.shb", null,
      h("div.lbl.first", null, "What to watch"),
      h(`button.opt${w.what === "region" ? ".on" : ""}`, act("wWhat", { data: { k: "region" }, role: "radio", "aria-checked": String(w.what === "region") }), h("span.rd"),
        h("div.grow", null, h("div.ot", null, "A part of the page"), h("div.od", null, w.region ? ["Watching: ", h("b.b5", { css: { color: "var(--ink)" } }, w.region.label)] : "Pick it on the page."))),
      w.what === "region" ? h("div", { css: { padding: "0 0 4px 36px" } }, h("button.btn", act("pickStart", { disabled: w.picking }), ic("region", "s"), w.picking ? "Click it on the page" : w.region ? "Pick again" : "Pick on the page")) : null,
      h(`button.opt${w.what === "page" ? ".on" : ""}`, act("wWhat", { data: { k: "page" }, role: "radio", "aria-checked": String(w.what === "page") }), h("span.rd"),
        h("div.grow", null, h("div.ot", null, "Any change on the page"), h("div.od", null, "Reads the text of the page. A clock or a counter that changes on every look will tell you every time."))),
      h("div.lbl", null, "How often"),
      h("button.pick", act("wFreq", { css: { marginLeft: "-8px" }, "aria-haspopup": "menu" }), ic("clock", "s"), freqLabel(w.every), h("span.chev", null, ic("chev", "xs"))),
      h("div.lbl", null, "Who checks it"),
      agent ? h("button.pick", act("wWho", { css: { marginLeft: "-8px" }, "aria-haspopup": "menu" }), face({ name: agent.name, avatar: agent.avatar ?? null, assistant: Boolean(agent.assistant) }, 20), agent.name, h("span.chev", null, ic("chev", "xs")))
        : h("div.xs.mut", null, "No agent to check it yet."),
      h("div.lbl", null, "Run on"),
      h("div.seg", { css: { width: "100%" } },
        h(`button${run === "computer" ? ".on" : ""}`, act("wRun", { data: { k: "computer" }, css: { flex: "1", justifyContent: "center", opacity: hasPc ? "" : ".45" }, "data-tip": hasPc ? null : `${agent ? agent.name : "The agent"} has no computer yet`, "aria-disabled": hasPc ? null : "true" }), ic("server", "s"), "Agent computer"),
        h(`button${run === "chrome" ? ".on" : ""}`, act("wRun", { data: { k: "chrome" }, css: { flex: "1", justifyContent: "center" } }), ic("monitor", "s"), "My Chrome")),
      h("div.note", { css: { marginTop: "8px" } }, ic(run === "computer" ? "server" : "monitor", "s"),
        run === "computer"
          ? h("div", null, `Runs on ${agent ? agent.name : "the agent"}'s computer, so your computer can sleep. ${agent ? agent.name : "It"} signs in with the Vault and never sees the password.`, w.run ? null : h("div.xs.mut", { css: { marginTop: "3px" } }, `Default, because ${agent ? agent.name : "the agent"} has a computer.`))
          : h("div", null, "Runs in your Chrome in the background while it is open, with your own sessions.", hasPc ? null : h("div.xs.mut", { css: { marginTop: "3px" } }, `Default, because ${agent ? agent.name : "the agent"} has no computer. `, agent ? h("button.lnk", act("givePc"), `Give ${agent.name} one`) : null))),
      h("div.lbl", null, "Tell"),
      h("div.note", null, ic("chat", "s"), h("div", null, `You, in a chat with ${agent ? agent.name : "the agent"}. It shows what changed: what it was and what it is now.`)),
      w.note ? h("div.xs.mut", { css: { marginTop: "8px" } }, w.note) : null,
      w.error ? h("div.note.err", { css: { margin: "10px 0 0" } }, w.error) : null),
    h("div.shf", null, h("button.btn.q", act("sheetX"), "Cancel"), h("button.btn.pri", act("wStart", { disabled: start, css: start ? { opacity: ".5" } : null }), ic("eye", "s"), w.saving ? "Starting" : "Start watching")));
}

/**
 * Watching: the person's watches.
 * @param {{ list: any[] | null, open: string | null, error: string, agents: { id: string, name: string }[] }} s
 */
export function watchingSheet(s) {
  const rows = s.list || [];
  const nameOf = (/** @type {string} */ id) => (s.agents.find((a) => a.id === id) || { name: "An agent" }).name;
  return h("div.sheet", null,
    h("div.shh", null, h("button.ib", act("sheetX", { "data-tip": "Back", "aria-label": "Back" }), ic("chevl")), h("h3", null, "Watching"), h("span.xs.mut", null, String(rows.length)), h("span.grow"),
      h("button.ib", act("wNew", { "data-tip": "Watch this page", "aria-label": "Watch this page" }), ic("plus"))),
    h("div.shb", { css: { padding: "0 6px" } },
      s.list === null ? h("div.qline.pad", null, "Loading") : null,
      s.list !== null && !rows.length ? h("div.empty", { css: { padding: "36px 18px" } }, h("div.big", null, ic("watch")), h("div.t", null, "Nothing is being watched"), "Watch a page, or a part of one, and an agent tells you when it changes.") : null,
      s.error ? h("div.note.err", null, s.error) : null,
      rows.map((w) => {
        const on = w.state === "on";
        const line = watchLine(w, Date.now());
        return h("div.rowh", null,
          h("div", Object.assign({ css: { display: "flex", alignItems: "center", gap: "10px", padding: "8px" } }, act("wRow", { data: { id: w.watchId } })),
            h("span.fav", { css: { width: "24px", height: "24px" } }, ic("globe", "s")),
            h("div.grow", null, h("div.b5.ell", { css: on ? {} : { color: "var(--ink-3)" } }, w.title), h("div.xs.mut.ell", null, line)),
            h("span", { "data-tip": w.runsOn === "computer" ? `Runs on ${nameOf(w.agentId)}'s computer` : "Runs in my Chrome", css: { color: "var(--ink-3)", display: "grid" } }, ic(w.runsOn === "computer" ? "server" : "monitor", "s")),
            h("button.ib.sm.hov", act("wPause", { data: { id: w.watchId, on: on ? "1" : "" }, "data-tip": on ? "Pause" : "Resume", "aria-label": on ? "Pause" : "Resume" }), ic(on ? "pause" : "play", "s")),
            h("button.ib.sm.hov", act("wMore", { data: { id: w.watchId }, "aria-label": "More", "aria-haspopup": "menu" }), ic("more", "s"))),
          s.open === w.watchId ? h("div.sm.mut2", { css: { padding: "0 10px 10px 42px" } },
            w.lastChange ? h("div", { css: { marginBottom: "6px" } }, h("div.xs.mut", null, "Before"), h("div", { css: { overflowWrap: "anywhere" } }, w.lastChange.before.slice(0, 160) || "(nothing)"), h("div.xs.mut", { css: { marginTop: "4px" } }, "Now"), h("div", { css: { overflowWrap: "anywhere" } }, w.lastChange.after.slice(0, 160) || "(nothing)")) : null,
            h("div", null, `Checks ${w.mode === "region" && w.region ? w.region.label.toLowerCase() : "any change"} · tells you in a chat with ${nameOf(w.agentId)}`),
            h("div.xs.mut", { css: { marginTop: "4px" } }, w.runsOn === "computer" ? `On ${nameOf(w.agentId)}'s computer, signed in with the Vault` : "In your Chrome, with your own session"),
            w.error ? h("div.xs", { css: { color: "var(--danger)", marginTop: "4px" } }, w.error) : null) : null);
      })));
}
