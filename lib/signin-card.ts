// The one sign-in hand-off (27 Nov 2026, rc.44): when an agent needs a person to finish a login in its terminal (gh auth login, a vendor CLI, an SSH passphrase) or in its browser (a password, a code, a CAPTCHA),
// it asks, and the chat gets one card where the agent asked. It is a question card (chat.question.ask) with the card kind "signin": the turn parks on it like on any question, the people who may take over that computer
// see Open terminal or Open browser and Done, everyone else sees "Waiting for <name> to sign in", and Done hands the computer back so the agent carries on. terminal.ask_signin and computers.browser.ask_signin both build
// the question here, so the two surfaces cannot drift apart: one card, one answer shape.

/** The answers of the card, in the order they are offered. */
export const SIGNIN_OPTIONS = [
  { key: "done", label: "Done, I signed in" },
  { key: "cannot", label: "I can't sign in" },
] as const;

export interface SigninAsk {
  surface: "terminal" | "browser";
  /** What the agent needs the person to sign in to, in the agent's words. */
  why: string;
  /** The agent whose computer it is. */
  agentId: string;
  /** For the terminal: the session the sign-in is in. */
  terminalId?: string;
  /** For the browser: the site, when the agent knows it. */
  site?: string;
}

/** The chat.question.ask input for a sign-in card (the thread and the idempotency key are the caller's). */
export function signinQuestion(a: SigninAsk): {
  prompt: string;
  mode: "single";
  options: Array<{ key: string; label: string }>;
  allowOther: boolean;
  card: { kind: "signin"; surface: "terminal" | "browser"; agentId: string; terminalId?: string; site?: string };
} {
  const why = a.why.trim().replace(/\s+/g, " ").slice(0, 500);
  return {
    prompt: why,
    mode: "single",
    options: SIGNIN_OPTIONS.map((o) => ({ key: o.key, label: o.label })),
    allowOther: false,
    card: {
      kind: "signin",
      surface: a.surface,
      agentId: a.agentId,
      ...(a.terminalId === undefined ? {} : { terminalId: a.terminalId }),
      ...(a.site === undefined || a.site.trim() === "" ? {} : { site: a.site.trim().slice(0, 200) }),
    },
  };
}
