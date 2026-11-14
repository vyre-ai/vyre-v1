// The keys of a full-size sheet that captures them (an agent's terminal or browser). The surface inside takes Escape, Cmd+W and Tab, so the sheet takes none of them; one documented chord leaves it and
// moves focus to the Close control, where Enter closes. When the sheet closes, focus goes back to what opened it. A sheet that does not capture keys closes on Escape as every other layer does.

type KeyLike = {
  key?: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  preventDefault?: () => void;
  stopPropagation?: () => void;
};
interface FocusLike {
  focus?: () => void;
  isConnected?: boolean;
}
export interface KeyDocument {
  activeElement?: FocusLike | null;
  addEventListener(type: string, fn: (e: KeyLike) => void, capture?: boolean): void;
  removeEventListener(type: string, fn: (e: KeyLike) => void, capture?: boolean): void;
}

/** The chord that leaves a surface that holds the keyboard: Cmd+Shift+. on a Mac, Ctrl+Alt+. elsewhere (no browser, desktop app or shell uses them), and the words that tell a person about it. */
export function closeChord(mac: boolean, surface = "terminal"): { chord: string; hint: string } {
  const chord = mac ? "Cmd+Shift+." : "Ctrl+Alt+.";
  return { chord, hint: `${chord} leaves the ${surface}` };
}

/** Does this key event press exactly this chord? Modifiers must match exactly; the period is found by its code or its character. */
export function chordMatches(chord: string, e: KeyLike): boolean {
  const parts = chord.split("+");
  const key = parts[parts.length - 1]!;
  const mods = new Set(parts.slice(0, -1));
  if ((e.metaKey === true) !== mods.has("Cmd")) return false;
  if ((e.ctrlKey === true) !== mods.has("Ctrl")) return false;
  if ((e.altKey === true) !== mods.has("Alt")) return false;
  if ((e.shiftKey === true) !== mods.has("Shift")) return false;
  if (key === ".") return e.code === "Period" || e.key === "." || e.key === ">";
  return e.key?.toLowerCase() === key.toLowerCase();
}

/** Remembers what has focus now; the function it answers puts focus back there, if that thing is still in the page. Every sheet does this, so closing one never drops focus on the page. */
export function returnFocus(doc: Pick<KeyDocument, "activeElement">): () => void {
  const opener = doc.activeElement ?? null;
  return () => {
    if (opener && opener.isConnected !== false) opener.focus?.();
  };
}

/** Listens for the chord while the sheet is open; answers how to stop. Focus is given back by `returnFocus`, taken when the sheet first renders (before its body can take focus), not here. */
export function watchSheetKeys(o: { doc: KeyDocument; chord: string; focusClose(): void }): () => void {
  const onKey = (e: KeyLike): void => {
    if (!chordMatches(o.chord, e)) return;
    e.preventDefault?.();
    e.stopPropagation?.();
    o.focusClose();
  };
  o.doc.addEventListener("keydown", onKey, true);
  return () => {
    o.doc.removeEventListener("keydown", onKey, true);
  };
}
