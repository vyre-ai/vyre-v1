// A pasted address of this Space that names a thing (a chat, a file, a record, a message...): the target it opens, or null when the text is anything else. The one place that reads a pasted address; the shapes it knows are
// the ones open-link.ts reads (/open/<kind>/<id> on the Space's web address, and the desktop form vyre://open?address=&kind=&id=), so a link the app makes is a link the app opens.
import { parseOpenPath, targetOfOpen } from "./open-link.ts";
import { placeForSubject } from "../hash/hash.ts";
import type { OpenTarget } from "./target.ts";

const KIND = /^[a-z_]{2,24}$/;
const ID = /^[A-Za-z0-9_.-]{1,128}$/;

/** What a kind and id name: the open link's own mapping, else the subject router's (any type a place shows). */
function ofKind(kind: string, id: string, at?: string): OpenTarget | null {
  if (!KIND.test(kind) || !ID.test(id)) return null;
  // a knowledge page has a screen of its own (the one the Knowledge list opens when a row is pressed); a computer is a row on the Console's Computers page (the page opens, the row is not picked)
  if (kind === "knowledge") return { screen: "files.knowledge", args: { v: "page", pageId: id } };
  if (kind === "machine") return { screen: "console.machines" };
  // a chat with a message named (vyre://thread/<id>?m=<message>) is a message link
  const t = targetOfOpen({
    kind: at && (kind === "thread" || kind === "chat") ? "message" : kind,
    id,
    ...(at ? { at } : {}),
  });
  if (t !== null) return t;
  return placeForSubject(kind) === null ? null : { subject: { type: kind, id }, ...(at ? { args: { m: at } } : {}) };
}

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
    if (sub) return ofKind(sub[1]!, sub[2]!);
    // an artifact's own address: <origin>/a/<id>
    const art = /^\/a\/([A-Za-z0-9_.-]{1,128})\/?$/.exec(url.pathname);
    if (art) return { subject: { type: "artifact", id: art[1]! } };
    const item = parseOpenPath(url.pathname);
    return item === null ? null : (targetOfOpen(item) ?? ofKind(item.kind, item.id, item.at));
  }
  if (url.protocol === "vyre:" && url.hostname === "open") {
    const address = url.searchParams.get("address") ?? "",
      kind = url.searchParams.get("kind") ?? "",
      id = url.searchParams.get("id") ?? "";
    if (!sameOrigin(address, origins)) return null;
    const item = parseOpenPath(`/open/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`);
    return item === null ? null : (targetOfOpen(item) ?? ofKind(item.kind, item.id, item.at));
  }
  if (url.protocol === "vyre:") {
    const rest = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    // vyre://settings/<page>: a Settings page
    if (url.hostname === "settings") return rest === "" ? null : { screen: "settings.page", args: { page: rest } };
    // vyre://<place>/<hash>: the main tab's Copy link, only when the hash names a thing
    if (rest.includes("=")) {
      const sub = new URLSearchParams(rest).get("subject") ?? "";
      const m = /^([a-z_]{2,24}):(.+)$/.exec(sub);
      return m ? ofKind(m[1]!, m[2]!) : null;
    }
    // vyre://<kind>/<id>[?m=<message>]: search, menus and rows
    return ofKind(url.hostname, rest, url.searchParams.get("m") ?? undefined);
  }
  return null;
}
