// The rows and the directory the one Access sheet takes, from the access data every place reads (access.shares_of, the Space directory).
import { targetOfOpen } from "../shell/reach/open-link.ts";
import { setSpaceLinkTools } from "../../../../ui/src/link-origin.ts";
import { notices } from "../shell/noticeslot/model.ts";
import type { CapMap } from "../../../../generated/types.ts";
import type { AccessEntry, ShareRow } from "../../../../ui/src/AccessSheet/index.tsx";

export type SharesOut = CapMap["access.shares_of"]["out"];
export type AccessRow = ShareRow & { through: SharesOut["shares"][number]["through"] };

/**
 * The contract's grants as the sheet's rows: a grant on this item can be raised and removed, the rest come from a group, a role, a folder or the Space above it. `through` keeps which.
 * `resourceId` is the item itself: a group or role it was given to (Everyone) is a grant on the item, not something inherited.
 */
export function shareRows(out: SharesOut, name: (id: string) => string, resourceId?: string): AccessRow[] {
  return out.shares.map((s) => {
    const kind = s.grant.subject.kind;
    return {
      subjectKind:
        kind === "person" || kind === "group" || kind === "role" || kind === "agent" || kind === "link"
          ? kind
          : "agent",
      subjectId: s.grant.subject.id,
      name: name(s.grant.subject.id),
      level: s.grant.level,
      via:
        s.through === "owner"
          ? "owner"
          : s.through === "direct" || (resourceId !== undefined && s.grant.resource.id === resourceId)
            ? "grant"
            : s.through === "folder"
              ? "folder"
              : "space",
      fromFolderId: s.through === "folder" ? (s.grant.source ?? null) : null,
      ...(s.grant.conditions.export === true ? { canExport: true } : {}),
      ...(s.grant.conditions.reshare === true ? { canShare: true } : {}),
      through: s.through,
    };
  });
}

export const entries = (
  list: readonly { id: string; name: string; sub?: string }[],
  kind: AccessEntry["kind"],
): AccessEntry[] => list.map((e) => ({ id: e.id, name: e.name, kind, ...(e.sub ? { sub: e.sub } : {}) }));

/** The people, groups, roles and agents a Space offers, as the sheet's directory. */
export function sheetDirectory(d: {
  people: readonly { id: string; name: string }[];
  groups: readonly { id: string; name: string }[];
  roles: readonly { id: string; name: string }[];
  agents: readonly { id: string; name: string }[];
  loading?: boolean;
}) {
  return {
    people: entries(d.people, "person"),
    groups: entries(d.groups, "group"),
    roles: entries(d.roles, "role"),
    agents: entries(d.agents, "agent"),
    ...(d.loading === true ? { loading: true } : {}),
  };
}

/** access.share (or vault.share) input from what the sheet hands back, with the Notify people choice folded in as `notify`. */
export function withNotify<T extends Record<string, unknown>>(
  input: T,
  opts?: { notify: boolean; message?: string },
): T & { notify?: { message?: string } } {
  if (!opts || !opts.notify) return input;
  return { ...input, notify: opts.message ? { message: opts.message } : {} };
}

/** What a person is told when a link is meant for others and the Space has no address anyone else could open (a Space on this computer alone). */
export const NO_LINK_WORDS =
  "This Space has no public address yet, so there is no link to give. Set one under Console, Network, then copy again.";
/** What a person is told when the copied link opens in Vyre on this computer only. */
export const LOCAL_LINK_WORDS =
  "Copied. This link opens in Vyre on this computer only. For a link others can open, set a public address under Console, Network, or ask an admin.";

let spaceAddress: string | null = null;
/** The Space this session is open on: set when the session opens, so a link is made from the Space's own address and not from the page the app runs in (the desktop app runs in tauri://localhost). */
export function setLinkOrigin(address: string | null): void {
  spaceAddress = address;
  setSpaceLinkTools({
    origin: linkOrigin(),
    artifactLink: (id) => itemLink("site", id),
    copy: (l) => void copyLinkText(l),
  });
}

const isLocalHost = (host: string): boolean =>
  host === "localhost" || host.endsWith(".localhost") || host === "[::1]" || /^127\./.test(host) || host === "0.0.0.0";

const webOrigin = (raw: string | null | undefined): URL | null => {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname !== "" ? u : null;
  } catch {
    return null;
  }
};

/**
 * The origin a link to this Space is made from for people on other computers: the Space's own public address, else (a web app opened at the Space) the page's origin. Never tauri:// or a loopback or local
 * name: then "". A link made from location.origin was copied as tauri://localhost/a/<id> from the desktop app (13 Nov 2026) and opened nowhere.
 */
export function linkOrigin(
  address: string | null = spaceAddress,
  page: string | undefined = (globalThis as { location?: { origin?: string } }).location?.origin,
): string {
  for (const raw of [address, page]) {
    const u = webOrigin(raw);
    if (u && !isLocalHost(u.hostname.toLowerCase())) return u.origin;
  }
  return "";
}

/** The page's own origin when the app runs as a web page at a local or network address: a link made from it opens for the person who copied it, on that computer or network (a Space at 127.0.0.1 or on a LAN). */
const localWebOrigin = (): string => {
  const u = webOrigin((globalThis as { location?: { origin?: string } }).location?.origin);
  // the Windows desktop app is the page http://tauri.localhost: that is the app, not a web page at an address
  return u && u.hostname.toLowerCase() !== "tauri.localhost" ? u.origin : "";
};

/** What a person is told when a sign-in needs an address the provider can send them back to and the Space has none. */
export const NO_CALLBACK_WORDS =
  "This Space has no public address yet, so a sign-in cannot come back to it. Set one under Console, Network, then try again.";

/**
 * The address a sign-in (an OAuth redirect) comes back to. On the web it is the page's own origin, exactly what rc.26 sent (a provider's registered redirect is an exact string, so it must not change by which address
 * the Space is also known by). In the desktop app, whose page is tauri://localhost and cannot be returned to, it is the Space's public address; "" when that is none: the caller says NO_CALLBACK_WORDS and sends nothing.
 * Never built from location.origin by a caller.
 */
export const callbackOrigin = (): string => localWebOrigin() || linkOrigin();

/** The in-app form, for a Space with no public address on the desktop app: the app's own resolver opens it when pasted in the new tab or the command bar (apps/app/src/shell/reach/space-link.ts). */
const inAppLink = (kind: string, id: string): string =>
  // only a kind the app's own resolver (shell/reach/open-link.ts targetOfOpen) opens: a link that opens nothing is never handed out
  spaceAddress === null || webOrigin(spaceAddress) === null || targetOfOpen({ kind, id }) === null
    ? ""
    : `vyre://open?address=${encodeURIComponent(spaceAddress)}&kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`;

const kindOf = (type: string): string =>
  type === "vault_item" || type === "vault_folder" ? "vault" : type === "site" ? "artifact" : type;

/**
 * The item's own link: on the Space's public address, /open/<kind>/<id> (an artifact keeps /a/<id>); it opens the app when installed and the web app otherwise, after sign-in, through the same access check
 * as any other way in. With no public address: a web page at a local or network address copies its own origin (it opens for that person); the desktop app copies the in-app form (vyre://open?...), which opens
 * in Vyre on this computer only. "" when there is nothing that would open. `origin` is for tests and callers that know it.
 */
export function itemLink(type: string, id: string, origin?: string): string {
  const o = origin ?? (linkOrigin() || localWebOrigin());
  if (o === "") return inAppLink(kindOf(type), id);
  if (type === "site") return `${o}/a/${id}`;
  return `${o}/open/${kindOf(type)}/${id}`;
}

/** One message's own link: /open/message/<threadId>/<messageId> on the Space's address; with no public address on the desktop app, the in-app form of its chat. */
export function messageLink(threadId: string, messageId: string, origin?: string): string {
  const o = origin ?? (linkOrigin() || localWebOrigin());
  if (o === "") return inAppLink("thread", threadId);
  return `${o}/open/message/${encodeURIComponent(threadId)}/${encodeURIComponent(messageId)}`;
}

/**
 * Put a link on the clipboard, or say in words why there is none to give. A link for other people (`forOthers`: the Share sheet's) is never the in-app form, which only opens here. True when a link was copied.
 */
export function copyLinkText(link: string, forOthers = false): boolean {
  if (link === "" || (forOthers && link.startsWith("vyre://"))) {
    notices.pass(NO_LINK_WORDS);
    return false;
  }
  const g = globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } };
  void g.navigator?.clipboard?.writeText(link);
  if (link.startsWith("vyre://")) notices.pass(LOCAL_LINK_WORDS);
  return true;
}

export function copyItemLink(type: string, id: string, forOthers = false): void {
  copyLinkText(itemLink(type, id), forOthers);
}
