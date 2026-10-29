// Which environment variable or request header carries an account's key into an engine (spec 4.14, 2.17). The account is named by Vault handle; the value is filled at the last moment
// (fill-launcher.ts, fill-authorizer.ts) and never passes through anything that records, logs or sends it to the model.
import type { ApiId } from "../api/types.ts";
import type { CliId } from "../cli/types.ts";

export type CredentialKind = "api_key" | "subscription";

interface EnvSlot { env: string; /** Field of the Vault item when the account ref names the whole item. */ field?: string }

// Claude Code reads a `claude setup-token` token from CLAUDE_CODE_OAUTH_TOKEN, or an API key from ANTHROPIC_API_KEY.
// CHECKED in the vendors' docs (30 Oct 2026): `codex exec` reads CODEX_API_KEY and the Grok CLI reads XAI_API_KEY. Whether either accepts it for a real turn still needs a real account (S7 live recording). Their subscription sign-ins are
// credential files (auth.json), which the sandbox places (sandbox/src/creds.ts); an env var cannot carry them, so those accounts are refused with a clear code until that path is wired.
const CLI_ENV: Readonly<Record<CliId, Readonly<Partial<Record<CredentialKind, EnvSlot>>>>> = {
  claude_code: { subscription: { env: "CLAUDE_CODE_OAUTH_TOKEN", field: "setup_token" }, api_key: { env: "ANTHROPIC_API_KEY" } },
  codex: { api_key: { env: "CODEX_API_KEY" } },
  grok: { api_key: { env: "XAI_API_KEY" } },
};

/** The handle to fill: the account ref as is when it names a field (`#Dana_Claude.token`), else the engine's default field of the item. */
function handleOf(ref: string, field: string | undefined): string {
  return ref.includes(".") || field === undefined ? ref : `${ref}.${field}`;
}

export interface CliCredential { env: string; handle: string }

/** Null when this engine cannot take this kind of account through its environment. */
export function cliCredential(cli: CliId, kind: CredentialKind, ref: string): CliCredential | null {
  const slot = CLI_ENV[cli][kind];
  return slot ? { env: slot.env, handle: handleOf(ref, slot.field) } : null;
}

const bearer = (h: string): Record<string, string> => ({ authorization: `Bearer ${h}` });

/** Auth header of each provider with the handle where the key goes. The Vault fill replaces the handle; the result goes to the HTTP layer only. */
export const API_AUTH: Readonly<Record<ApiId, (handle: string) => Record<string, string>>> = {
  anthropic: (h) => ({ "x-api-key": h }),
  openai: bearer,
  openrouter: bearer,
  xai: bearer,
  google: (h) => ({ "x-goog-api-key": h }),
  opencode_go: bearer,
  custom: bearer,
  local: () => ({}),
};
