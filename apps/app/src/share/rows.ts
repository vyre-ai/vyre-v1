// The rows and the directory the one Access sheet takes, from the access data every place reads (access.shares_of, the Space directory).
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

/** What a person is told when there is no address anyone else could open (a Space on this computer alone). */
export const NO_LINK_WORDS =
  "This Space has no public address yet, so there is no link to give. Set one under Console, Network, then copy again.";

let spaceAddress: string | null = null;
/** The Space this session is open on: set when the session opens, so a link is made from the Space's own address and not from the page the app runs in (the desktop app runs in tauri://localhost). */
export function setLinkOrigin(address: string | null): void {
  spaceAddress = address;
}

/**
 * The origin a link to this Space is made from: the Space's own public address, else (a web app opened at the Space) the page's origin. Never tauri://, a loopback or a local name, which nobody else can open:
 * then "", and the caller says so in words (NO_LINK_WORDS). A link made from location.origin was copied as tauri://localhost/a/<id> from the desktop app (13 Nov 2026) and opened nowhere.
 */
export function linkOrigin(
  address: string | null = spaceAddress,
  page: string | undefined = (globalThis as { location?: { origin?: string } }).location?.origin,
): string {
  for (const raw of [address, page]) {
    if (!raw) continue;
    try {
      const u = new URL(raw);
      const host = u.hostname.toLowerCase();
      const local =
        host === "localhost" ||
        host.endsWith(".localhost") ||
        host === "[::1]" ||
        /^127\./.test(host) ||
        host === "0.0.0.0";
      if ((u.protocol === "https:" || u.protocol === "http:") && !local && host !== "") return u.origin;
    } catch {
      /* not an address */
    }
  }
  return "";
}

/**
 * The item's own link, one that works wherever it is pasted: the Space's web address, /open/<kind>/<id>. It opens the app when it is installed and the web app otherwise, after sign-in, through the
 * same access check as any other way in. An artifact keeps its own address (/a/<id>). Never the page the person is on, and never a vyre:// link, which only opens where the app is installed.
 * "" when the Space has no public address (see linkOrigin).
 */
export function itemLink(type: string, id: string, origin: string = linkOrigin()): string {
  if (origin === "") return "";
  if (type === "site") return `${origin}/a/${id}`;
  const kind = type === "vault_item" || type === "vault_folder" ? "vault" : type;
  return `${origin}/open/${kind}/${id}`;
}

/** One message's own link: /open/message/<threadId>/<messageId> on the Space's web address. It opens the chat on that message, through the same access check as the chat. "" when there is no public address. */
export function messageLink(threadId: string, messageId: string, origin: string = linkOrigin()): string {
  if (origin === "") return "";
  return `${origin}/open/message/${encodeURIComponent(threadId)}/${encodeURIComponent(messageId)}`;
}

/** Put a link on the clipboard, or say in words why there is none to give. True when a link was copied. */
export function copyLinkText(link: string): boolean {
  if (link === "") {
    notices.pass(NO_LINK_WORDS);
    return false;
  }
  const g = globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } };
  void g.navigator?.clipboard?.writeText(link);
  return true;
}

export function copyItemLink(type: string, id: string): void {
  copyLinkText(itemLink(type, id));
}
