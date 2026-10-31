// A request to open the New channel or Browse channels sheet from outside the sidebar (Cmd-K, the Space's new menu). The sheet lives in the Chats sidebar; when that is not on screen yet the
// request waits here and the sidebar takes it as it mounts, so "New channel" from another place lands on the sheet.
export type ChannelSheetKind = "new" | "browse";

let pending: ChannelSheetKind | null = null;
const listeners = new Set<() => void>();

export function requestChannelSheet(kind: ChannelSheetKind): void {
  pending = kind;
  for (const l of [...listeners]) l();
}

/** The waiting request, once. */
export function takeChannelRequest(): ChannelSheetKind | null {
  const k = pending;
  pending = null;
  return k;
}

export function onChannelRequest(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
