// The person's own Chrome as a place work can run (Chrome step 2): one port, bound by the daemon that has the extension's bridge, used by the computers module (the chrome_* tools) and the browser module
// (the buttons on a held card). Pure types and one binding; no node imports. It answers only for the person signed in to that Chrome, in the Space they picked there, after they opened Chrome to agents.
export interface PersonalChrome {
  available(a: { space: string; person: string }): Promise<boolean>;
  call(a: { tool: string; args: Record<string, unknown>; agent: { id: string; name: string }; space: string; thread?: string; timeoutMs: number }): Promise<Record<string, unknown>>;
  /** What the extension said about a held item (the page's own To, From, Subject, Message), not what the agent said. The event can reach the daemon a moment after the tool's answer, so this waits a short while for it. */
  held(heldId: string): Promise<{ site?: string; kind?: string; summary?: string; card?: Record<string, string> } | null>;
  /** The newest small masked picture of the agent's tab, if there is one. */
  frame(agentId: string): { site: string; thumb: string } | null;
  /** How far the agent is in the plan it gave: its goal, the steps and how many are done. */
  plan(agentId: string): { goal: string; steps: string[]; done: number } | null;
  /** The person chose Don't send: the extension forgets the held item. */
  drop(heldId: string): void;
  /** Hand the agent's tab back to the person (the bar's Take over). */
  takeOver(agentId: string): void;
  /** Bring the agent's tab to the front. */
  watch(agentId: string): void;
}
let port: PersonalChrome | null = null;
export function bindPersonalChrome(p: PersonalChrome | null): void { port = p; }
export const personalChrome = (): PersonalChrome | null => port;
