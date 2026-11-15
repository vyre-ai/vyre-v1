// THE switch for the connect card (b-connect, 14 Nov 2026) and everything behind it. ON by default from rc.29 (b-connect2, 15 Nov 2026), after the three items the review r-keyreach-9-b-connect left open were closed:
// A a saved key is offered only from the card's own stamp and only to the person on their own card, B the key goes only to the hosts the connection's own record lists, checked on the server when it is sent,
// C no capability an agent can reach erases a Vault item. Set VYRE_CONNECT_CARD=0 (or off, false) to turn it off: ten capabilities then answer `internal.not_implemented` and the agent tools are not offered.
// Read at the moment of each call, never cached, so a test that turns it off for itself needs no restart. Every site that gates the feature reads this one function; nothing else decides.

/** Is the connect card on? Yes unless the variable is exactly "0", "off" or "false". */
export const connectCardOn = (): boolean => !["0", "off", "false"].includes(process.env["VYRE_CONNECT_CARD"] ?? "");

/** The one plain refusal every caller gets for a connect capability while the switch is off. */
export const CONNECT_OFF_MESSAGE = "Connecting a service this way is not available yet.";

/** The error code the refusal uses; each connect capability lists it in its manifest `errors`. */
export const CONNECT_OFF_CODE = "internal.not_implemented" as const;

/** Every capability the connect work added. All refuse while the switch is off, and the agent tools they back are neither listed nor found with tool_search. */
export const CONNECT_CAPS: ReadonlySet<string> = new Set([
  "vault.connect",
  "vault.connect_card.get",
  "vault.connect_card.options",
  "vault.connect_card.may_discard",
  "vault.connect_card.submit",
  "vault.connect_card.ask_admin",
  "vault.connect_card.reopen",
  "vault.connect_card.disconnect",
  "connectors.for_service",
  "connectors.check_key",
  "vault.item.discard_new",
]);

/** The agent tools (by tool name) that back a connect capability: they are not offered while the switch is off. */
export const isConnectCap = (cap: string): boolean => CONNECT_CAPS.has(cap);

/**
 * Wrap a handler so that, with the switch off, it refuses before it reads, writes or emits anything. `refuse` raises the module's own error for the plain message.
 */
export function gateConnect<A extends unknown[], R>(
  handler: (...a: A) => R,
  refuse: (...a: A) => never,
): (...a: A) => R {
  return (...a: A): R => (connectCardOn() ? handler(...a) : refuse(...a));
}

const SKILL_LINES: Readonly<Record<string, { before: string; line: string }>> = {
  "working-in-vyre": {
    before: "- If the item is missing, call `vault_request`",
    line: 'A service the person names ("is Fathom connected", "connect Fathom"): call `vault_connect` with its name. It draws one card that asks for the key, tries it, connects it and saves it. Say at most one line before the card and one after, and never explain keys, folders, handles or access. Do not use `vault_request` or `connections_create` for it.',
  },
  "focus-vault": {
    before: "- If the item you need is not listed for you",
    line: "A service the person names (Fathom, Slack): `vault_connect` with its name; one card does the rest. Everything below is for a plain key by name.",
  },
};

/** A built-in skill's text as an agent reads it: the lines that name `vault_connect` are added only while the switch is on, so no skill tells an agent to call a tool that is off. */
export function skillTextFor(name: string, text: string): string {
  const add = SKILL_LINES[name];
  if (!connectCardOn() || add === undefined) return text;
  const at = text.indexOf(add.before);
  return at < 0 ? text : `${text.slice(0, at)}- ${add.line}\n${text.slice(at)}`;
}
