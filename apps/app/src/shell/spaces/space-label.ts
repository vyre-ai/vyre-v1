// What a Space is called on screen. The name comes from the Space itself (spaces.get once signed in, the invite preview or sign-in options before). An id is never a name: a Space whose
// name is missing, or is only its id (an spc_ value, as a server that never learnt its name answers), is called "your Space": neither an id nor a web address stands in for a name.

/** A Space id, which no person should ever read as a name. */
export const SPACE_ID = /^spc_/i;

/** The host a person typed or was sent to, without the scheme or port: mla.vyre.run. Empty when it is not an address. */
export function spaceHost(address: string | null | undefined): string {
  const a = (address ?? "").trim();
  if (a === "") return "";
  try { return new URL(/^[a-z]+:\/\//i.test(a) ? a : `https://${a}`).hostname; } catch { return a.replace(/^[a-z]+:\/\//i, "").split(/[:/]/)[0] ?? ""; }
}

/** What a Space with no name of its own is called on screen. */
export const UNNAMED = "your Space";

/** Does this name belong to the Space (a person gave it), rather than being an id, empty, or the stand-in for no name? */
export const isNamed = (name: string | null | undefined): boolean => { const n = (name ?? "").trim(); return n !== "" && !SPACE_ID.test(n) && n !== UNNAMED; };

/** The name to show for a Space: its own name, else "your Space". Never its id, never its address (the address is how people reach it, not what it is called). `address` is kept for callers that pass it. */
export function spaceLabel(name: string | null | undefined, _address?: string | null): string {
  return isNamed(name) ? (name as string).trim() : UNNAMED;
}
