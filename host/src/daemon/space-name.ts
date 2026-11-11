// The name a fresh Space is made with when nobody gave one: the address people reach it at, else a plain word. Never the Space's id, which a person would read as developer text (client walk, 11 Nov 2026).
export function defaultSpaceName(address: string | null): string {
  try { if (address) return new URL(address.includes("://") ? address : `https://${address}`).hostname; } catch { /* not an address */ }
  return "My Space";
}
