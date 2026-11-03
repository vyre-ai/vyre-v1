// The plain words of a Vault, AI key or connection call that a person's role does not reach (the Vault matrix, test/support/vault-matrix.ts): what happened and what to do instead, said once.
// The invoke pipeline uses them in place of the generic "No role of the caller includes the permission." for these capabilities; the app shows the server's words as they are.

export const SPACE_KEY_ROLE_LINE = "Only an owner or admin sets the Space AI key. Once it is set it covers you too: ask an owner or admin to add it.";
export const CONNECTION_ROLE_LINE = "Your role here does not connect apps. Ask an owner or admin to connect it for you; a key you share with them is all they need.";
export const CHAT_ROLE_LINE = "Your role here does not start chats with agents. Ask an owner or admin to add you to a chat or a channel.";
export const AUTOMATION_ROLE_LINE = "Your role here does not run automations. Ask an owner or admin to run it for you.";
export const VAULT_ROLE_LINE = "Your role here does not keep items in the Vault. Ask an owner or admin to share the key with you, and you can use it.";

/** The line for a capability the caller's role does not include (or whose Space-wide access is below it), or null to keep the generic one. */
export function roleLine(cap: string): string | null {
  if (cap === "chat.start" || cap === "chat.post") return CHAT_ROLE_LINE;
  if (cap === "engine.step_turn" || cap.startsWith("automations.")) return AUTOMATION_ROLE_LINE;
  if (cap === "providers.space_key.set" || cap === "providers.space_key.remove") return SPACE_KEY_ROLE_LINE;
  if (cap.startsWith("connections.") || cap.startsWith("connectors.")) return CONNECTION_ROLE_LINE;
  if (cap.startsWith("vault.") || cap.startsWith("providers.")) return VAULT_ROLE_LINE;
  return null;
}

/** A connection for the whole Space was given a key it may not use (someone's Mine item, or a key the person who made it cannot use). */
export const CONNECTION_KEY_LINE = "A connection for the whole Space cannot use a Mine item or a key not shared with you. Put the key in a Shared folder, then check the connection again.";

/** An outside agent asked its person to do something their own role does not allow either. */
export const PERSON_LACKS_ROLE_LINE = "The person you act for cannot do this either. Someone whose role allows it, an owner or an admin of this Space, has to do it or give them that role.";
