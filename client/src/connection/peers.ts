// A new computer joining the person's Personal Space from another of their computers (lane l-multidevice). The app on the new computer drives its own fresh, unclaimed Personal Space over
// loopback (/local/peers/*, host/src/peers/service.ts): find the Space by the username, send the request, wait for the person to allow it on the other computer, then copy. The daemon holds
// the Space's keys; the page only ever sees the owner's key bundle, which it opens with the password to make sure it is the person's own Space before anything is copied.
export interface PeerOffer { index: number; name: string; space: string }
export type PeerJoinState =
  | { state: "pending"; from: string }
  | { state: "declined" | "expired"; from: string }
  | { state: "allowed"; from: string; bundle: unknown; username: string; space: string; spaceName: string };

export class PeerJoinError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

export interface PeerJoin {
  find(username: string): Promise<PeerOffer[]>;
  request(index: number, name?: string): Promise<{ code: string; name: string }>;
  status(): Promise<PeerJoinState>;
  commit(): Promise<{ space: string }>;
  cancel(): Promise<void>;
}

export function createPeerJoin(base: string, f: typeof fetch = fetch): PeerJoin {
  const post = async <T,>(p: string, body: Record<string, unknown> = {}): Promise<T> => {
    let r: Response;
    try { r = await f(`${base.replace(/\/+$/, "")}/local/peers/${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
    catch { throw new PeerJoinError("provider.unavailable", "Vyre on this computer did not answer. Try again."); }
    let j: { data?: T; error?: { code?: string; message?: string } } = {};
    try { j = (await r.json()) as typeof j; } catch { /* empty answer */ }
    if (!r.ok || j.data === undefined) throw new PeerJoinError(j.error?.code ?? "provider.unavailable", j.error?.message ?? "That did not work. Try again.");
    return j.data;
  };
  return {
    find: async (username) => (await post<{ offers: PeerOffer[] }>("find", { username })).offers,
    request: (index, name) => post("request", { index, ...(name ? { name } : {}) }),
    status: () => post("status"),
    commit: () => post("commit"),
    cancel: async () => { await post("cancel").catch(() => undefined); },
  };
}
