// The views of the Inbox a link names (see useInboxLinks in inbox.tsx).
/** The views a link names, in the order the effects above apply them: a link names at most one, so the list has at most one view. */
export function inboxViewsLinked(l: {
  meetingHash: string | null;
  repliesHash: boolean;
  unmatchedLink: string | null;
  eventHash: string | null;
}): ("meetings" | "replies" | "unmatched" | "calendar")[] {
  return [
    ...(l.meetingHash !== null ? (["meetings"] as const) : []),
    ...(l.repliesHash ? (["replies"] as const) : []),
    ...(l.unmatchedLink !== null ? (["unmatched"] as const) : []),
    ...(l.eventHash !== null ? (["calendar"] as const) : []),
  ];
}
