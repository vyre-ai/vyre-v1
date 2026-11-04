// "Open" on an install card goes to the Skills tab of the chat pane with that skill lit. The card is in the conversation and the tab is in the pane, so they meet here: the card says a name, the pane
// (once it is open and has the tab) takes it. A name said before the pane subscribed waits for it.
type Listener = (name: string) => void;
const listeners = new Set<Listener>();
let waiting: string | null = null;

export function openSkills(name: string): void {
  if (listeners.size === 0) { waiting = name; return; }
  for (const l of listeners) l(name);
}
export function onOpenSkills(l: Listener): () => void {
  listeners.add(l);
  if (waiting !== null) { const n = waiting; waiting = null; l(n); }
  return () => { listeners.delete(l); };
}
