// Phone access in Settings > Computers: what `network.phone` answers, and the few decisions the section makes from it. Pure functions, so the page and the tests agree.

export type PhoneState = "none" | "claiming" | "claimed" | "releasing" | "failed";
export interface PhoneInfo { state: PhoneState; name?: string; nickname?: string; url?: string; link?: string; online: boolean; detail?: string }

/** A name is letters, digits and single dashes, three to 32 characters, starting with a letter. The relay and the names directory apply stricter rules and say so in words. */
export const validPhoneName = (s: string): boolean => /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/.test(s.trim().toLowerCase().replace(/\.vyre\.run$/, ""));

/** What a person types, as the name sent: lower case, without a pasted `.vyre.run`. */
export const phoneNameOf = (s: string): string => s.trim().toLowerCase().replace(/\.vyre\.run$/, "");

/** The one line under the address: online, or why a phone cannot reach this computer right now. */
export function phoneSub(p: PhoneInfo): string {
  if (p.state === "claiming") return "Claiming";
  if (p.state === "releasing") return "Releasing";
  if (p.state === "failed") return p.detail ?? "Could not claim that name.";
  if (p.state !== "claimed") return "";
  return p.online ? "Online" : "Offline";
}

/** The tooltip on the status dot. */
export const phoneDotHelp = (p: PhoneInfo): string | undefined =>
  p.state === "claimed" && !p.online ? "This computer is not connected to the relay. A phone sees \"asleep\" until it is back online." : undefined;

/** How long to wait before asking again: quickly while the host works, slowly otherwise. */
export const phonePollMs = (p: PhoneInfo | null): number => (p && (p.state === "claiming" || p.state === "releasing") ? 1000 : 10_000);
