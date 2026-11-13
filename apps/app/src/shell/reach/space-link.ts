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
  // a dead address an older desktop build copied (tauri://localhost/..., https://tauri.localhost/...) is this Space's own thing: the address was the app's, not a website
  const dead = url.protocol === "tauri:" || url.hostname === "tauri.localhost";
  if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "tauri:") {
    if (!dead && !sameOrigin(url.origin, origins)) return null;
    // the app's own address form: #subject=<type>:<id> (what the server redirects an artifact address to, and what a record's Copy link makes)
    const sub = /^([a-z_]{2,24}):([A-Za-z0-9_.-]{1,128})$/.exec(
      new URLSearchParams(url.hash.replace(/^#/, "")).get("subject") ?? "",
    );
    if (sub) return { subject: { type: sub[1]!, id: sub[2]! } };
    // an artifact's own address: <origin>/a/<id>
    const art = /^\/a\/([A-Za-z0-9_.-]{1,128})\/?$/.exec(url.pathname);
    if (art) return { subject: { type: "artifact", id: art[1]! } };
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
