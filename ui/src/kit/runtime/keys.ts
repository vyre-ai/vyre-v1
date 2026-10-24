// Keyboard combos for KitScreenDef.keys: "mod+k", "shift+Delete", "Enter". `mod` is Command on a Mac and Control elsewhere.

export interface Combo {
  key: string;
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
}

export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

const NAMES: Readonly<Record<string, string>> = {
  up: "arrowup", down: "arrowdown", left: "arrowleft", right: "arrowright",
  esc: "escape", del: "delete", space: " ", return: "enter",
};

export function parseCombo(text: string): Combo {
  const combo: Combo = { key: "", mod: false, ctrl: false, meta: false, shift: false, alt: false };
  for (const raw of text.split("+")) {
    const part = raw.trim().toLowerCase();
    if (part === "mod") combo.mod = true;
    else if (part === "ctrl" || part === "control") combo.ctrl = true;
    else if (part === "cmd" || part === "meta" || part === "command") combo.meta = true;
    else if (part === "shift") combo.shift = true;
    else if (part === "alt" || part === "option") combo.alt = true;
    else combo.key = NAMES[part] ?? part;
  }
  return combo;
}

export function matchCombo(combo: Combo, e: KeyLike, isMac: boolean): boolean {
  if (combo.key === "" || e.key.toLowerCase() !== combo.key) return false;
  const wantMeta = combo.meta || (combo.mod && isMac);
  const wantCtrl = combo.ctrl || (combo.mod && !isMac);
  return e.metaKey === wantMeta && e.ctrlKey === wantCtrl && e.shiftKey === combo.shift && e.altKey === combo.alt;
}
