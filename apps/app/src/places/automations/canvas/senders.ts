// The line under an Automation's name that says what it sends from (automations.senders). A person's Turn on is what gives the Automation these senders, so the page shows them.
export interface SenderLine { id: string; channel: "email" | "text"; address: string; usable: boolean; why?: string }

/** "Sends from hello@firm.com", "Sends from hello@firm.com and +14155550100", or null when no step sends. A sender that cannot send says so. */
export function sendsFromLine(senders: readonly SenderLine[]): { text: string; ok: boolean } | null {
  if (senders.length === 0) return null;
  const stuck = senders.find((s) => !s.usable);
  if (stuck) return { text: `${stuck.address} cannot send. ${stuck.why ?? ""}`.trim(), ok: false };
  const names = senders.map((s) => s.address);
  return { text: `Sends from ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`}`, ok: true };
}

/** A refusal from Turn on that a connection would fix: the Connect button goes beside the words. */
export const needsConnecting = (message: string): boolean => /Console, Comms/.test(message);
