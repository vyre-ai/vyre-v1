// Item kinds (spec 2.17): the field keys each kind starts with, which of them are not secret, and the kinds that cannot be shared. The Add sheet fills these in on the client; the server only checks keys.
export const KINDS = ["login", "api_key", "env", "card", "note", "totp", "ssh_key", "ai_subscription", "other"] as const;
export type Kind = (typeof KINDS)[number];

/** Field keys that are plain text by default: shown without a reveal, still sealed with the rest of the item. */
export const PLAIN_KEYS: ReadonlySet<string> = new Set(["username", "user", "email", "url", "host", "hostname", "account", "name", "label", "cardholder", "expiry"]);

export const STARTING_FIELDS: Record<Kind, string[]> = {
  login: ["username", "password", "url"],
  api_key: ["api_key"],
  env: [],
  card: ["cardholder", "number", "expiry", "cvc"],
  note: ["note"],
  totp: ["secret"],
  ssh_key: ["private_key", "passphrase"],
  ai_subscription: ["credentials"],
  other: [],
};

/** A subscription sign-in is one person's own credential: Mine, never shared. */
export const NEVER_SHARED: ReadonlySet<Kind> = new Set(["ai_subscription"]);

export const isKind = (v: unknown): v is Kind => typeof v === "string" && (KINDS as readonly string[]).includes(v);
export const secretByDefault = (key: string): boolean => !PLAIN_KEYS.has(key.toLowerCase());
