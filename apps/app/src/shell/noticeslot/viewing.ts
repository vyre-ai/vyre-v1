// The chat the person is looking at right now (the Chats place says so): a reply, mention or message there is not announced in the top bar, because they are reading it. The place sets the ids of what
// it shows (the chat and the thread beside it); the notices read them.
type Listener = () => void;
const listeners = new Set<Listener>();
let ids: ReadonlySet<string> = new Set();

export const viewing = {
  set(next: readonly string[]): void {
    const n = new Set(next.filter((x) => x !== ""));
    if (n.size === ids.size && [...n].every((x) => ids.has(x))) return;
    ids = n;
    for (const l of [...listeners]) l();
  },
  has: (id: string | undefined): boolean => id !== undefined && ids.has(id),
  subscribe(l: Listener): () => void { listeners.add(l); return () => { listeners.delete(l); }; },
};
