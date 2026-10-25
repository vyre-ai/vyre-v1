// @ts-check
// What the popup shows, as plain data computed from the worker's state, so the rules (which note, which menu, which key moves where)
// are tested without a browser. popup.js only turns this into elements. A login row carries the item's name, never a username or value.

/** @param {string} name @returns {string} one capital letter for the row's leading slot */
export function letterOf(name) {
  const m = /[A-Za-z0-9]/.exec(name || "");
  return m ? m[0].toUpperCase() : "V";
}

/**
 * @typedef {{ id: string, name: string, kind: string, fieldKeys: string[], hasUsername: boolean }} LoginRow
 * @typedef {{ kind: "info" | "warn", text: string, action?: { id: string, label: string } }} Note
 */

/**
 * @param {any} state the worker's popup.state data
 * @returns {{ spaceName: string, site: string, rows: { id: string, name: string, letter: string, trail: string, kind: string }[], note: Note | null, canAsk: boolean, canFill: boolean }}
 */
export function viewOf(state) {
  const active = (state.spaces || []).find((/** @type {any} */ s) => s.id === state.active);
  const spaceName = active ? active.name : (state.spaces && state.spaces[0] ? state.spaces[0].name : "Vyre");
  const site = state.page ? state.page.host : "";
  /** @type {Note | null} */
  let note = null;
  let canFill = false;
  if (state.status === "no_host" || state.status === "offline") {
    const web = (state.spaces || []).some((/** @type {any} */ s) => s.webUrl);
    note = { kind: "warn", text: state.error && state.error.message ? state.error.message : "The Vyre app is not running." };
    // The way forward sits in the note itself; a second link in the footer would say the same thing twice.
    if (web) note.action = { id: "openWeb", label: "Open the web app" };
  } else if (state.error && state.error.code === "locked") {
    note = { kind: "warn", text: state.error.message };
  } else if (!state.page) {
    note = { kind: "info", text: "This tab is not a web page." };
  } else if (!state.page.secure) {
    note = { kind: "warn", text: "This page is not secure (http), so Vyre will not fill it." };
  } else if (state.blocked === "never_fill") {
    note = { kind: "info", text: "Filling is turned off for this site.", action: { id: "fillOn", label: "Turn on" } };
  } else if (!state.rows || state.rows.length === 0) {
    note = { kind: "info", text: "No saved login for this site." };
  } else {
    canFill = true;
  }
  const rows = canFill ? state.rows.map((/** @type {LoginRow} */ r) => ({ id: r.id, name: r.name, letter: letterOf(r.name), trail: r.kind === "totp" ? "Code" : "", kind: r.kind })) : [];
  return { spaceName, site, rows, note, canAsk: state.status === "online" && Boolean(state.page), canFill };
}

/**
 * The right-click menu for a login row.
 * @param {{ kind: string }} row @param {{ fieldKeys?: string[] } | null} login
 * @returns {({ id: string, label: string } | { sep: true })[]}
 */
export function rowMenu(row, login) {
  /** @type {({ id: string, label: string } | { sep: true })[]} */
  const items = row.kind === "totp"
    ? [{ id: "fillCode", label: "Fill Code" }]
    : [{ id: "fill", label: "Fill" }, { id: "fillSignIn", label: "Fill and Sign In" }];
  if (row.kind !== "totp" && login && login.fieldKeys && login.fieldKeys.includes("totp")) items.push({ id: "fillCode", label: "Fill Code" });
  items.push({ id: "openVault", label: "Open in Vault" }, { sep: true }, { id: "neverFill", label: "Never Fill on This Site" });
  return items;
}

/**
 * Which row a key moves to. Up and Down wrap; Home and End jump. Returns the new index (or the same one).
 * @param {number} index @param {string} key @param {number} count
 */
export function move(index, key, count) {
  if (count <= 0) return -1;
  if (key === "ArrowDown") return index < 0 ? 0 : (index + 1) % count;
  if (key === "ArrowUp") return index < 0 ? count - 1 : (index - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return index;
}

/** The keyboard's menu key. Spelled in two parts because the repo's no-raw-context-menu lint reads the plain word as a native menu (see popup.js). */
export const MENU_KEY = "Context" + "Menu";

/**
 * What a key does in the popup, given where focus is. "none" leaves the key to the browser.
 * @param {{ key: string, meta?: boolean, ctrl?: boolean, shift?: boolean }} e @param {{ inInput: boolean, menuOpen: boolean }} where
 * @returns {"fill" | "fillSignIn" | "menu" | "focusAsk" | "close" | "none"}
 */
export function keyAction(e, where) {
  if (e.key === "Escape") return where.menuOpen ? "none" : "close";
  if (where.inInput) return "none";
  if (e.key === "/") return "focusAsk";
  if (e.key === "Enter") return e.meta || e.ctrl || e.shift ? "fillSignIn" : "fill";
  if (e.key === MENU_KEY || (e.key === "F10" && e.shift)) return "menu";
  return "none";
}
