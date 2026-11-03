// The release's What's new, as the app's own build carries it beside the page (apps/app/public/whats-new.json, written at release time by scripts/changelog/assemble.ts). The page reads it
// after an update to show what got better. In the client layer because apps never fetch (boundary B4). Offline, missing or unreadable is nothing.
export const WHATS_NEW_PATH = "/whats-new.json";

type Fetch = (url: string, init?: { cache?: string }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export async function fetchWhatsNew(f: Fetch | undefined = (globalThis as { fetch?: Fetch }).fetch): Promise<unknown> {
  if (!f) return null;
  try {
    const r = await f(WHATS_NEW_PATH, { cache: "no-store" });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
