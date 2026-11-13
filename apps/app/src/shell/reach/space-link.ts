// A pasted address of this Space that names a thing (a chat, a file, a record, a message...): the target it opens, or null when the text is anything else. The one place that reads a pasted address; the shapes it knows are
// the ones open-link.ts reads (/open/<kind>/<id> on the Space's web address, and the desktop form vyre://open?address=&kind=&id=), so a link the app makes is a link the app opens.
import { parseOpenPath, targetOfOpen } from "./open-link.ts";
import type { OpenTarget } from "./target.ts";

const sameOrigin = (a: string, origins: readonly string[]): boolean => {
  try {
    const o = new URL(a).origin;
    return origins.some((x) => new URL(x).origin === o);
  } catch {
    return false;
  }
};

/** The thing a pasted address of one of `origins` (this Space's web addresses) names, else null. Words around an address make it a message, not a link. */
export function resolveSpaceLink(text: string, origins: readonly string[]): OpenTarget | null {
  const t = text.trim();
  if (t === "" || /\s/.test(t)) return null;
  let url: URL;
  try {
    url = new URL(t);
  } catch {
    return null;
  }
  if (url.protocol === "http:" || url.protocol === "https:") {
    if (!sameOrigin(url.origin, origins)) return null;
    const item = parseOpenPath(url.pathname);
    return item === null ? null : targetOfOpen(item);
  }
  if (url.protocol === "vyre:" && url.hostname === "open") {
    const address = url.searchParams.get("address") ?? "",
      kind = url.searchParams.get("kind") ?? "",
      id = url.searchParams.get("id") ?? "";
    if (!sameOrigin(address, origins)) return null;
    const item = parseOpenPath(`/open/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`);
    return item === null ? null : targetOfOpen(item);
  }
  return null;
}
