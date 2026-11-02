// What a Space is called on screen. The name comes from the Space itself (spaces.get once signed in, the invite preview or sign-in options before). An id is never a name: a Space whose
// name is missing, or is only its id (an spc_ value, as a server that never learnt its name answers), is called by its address, mla.vyre.run, and failing that "your Space".

/** A Space id, which no person should ever read as a name. */
export const SPACE_ID = /^spc_/i;

/** The host a person typed or was sent to, without the scheme or port: mla.vyre.run. Empty when it is not an address. */
export function spaceHost(address: string | null | undefined): string {
  const a = (address ?? "").trim();
  if (a === "") return "";
  try { return new URL(/^[a-z]+:\/\//i.test(a) ? a : `https://${a}`).hostname; } catch { return a.replace(/^[a-z]+:\/\//i, "").split(/[:/]/)[0] ?? ""; }
}

/** The name to show for a Space: its own name, else its address, never its id. */
export function spaceLabel(name: string | null | undefined, address?: string | null): string {
  const n = (name ?? "").trim();
  if (n !== "" && !SPACE_ID.test(n)) return n;
  const host = spaceHost(address);
  return host !== "" && !SPACE_ID.test(host) ? host : "your Space";
}
