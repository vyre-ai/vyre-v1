// The Authorizer of an API driver (drivers/api/types.ts) built on the Vault fill: the key goes into the request header at the HTTP layer and nowhere else. The model, the transcript and
// the event log see the handle only; the headers returned here go straight to fetch, and the session scrubs them out of any error text (api/errors.ts scrub).
import { runWithVault } from "../../vault-use/index.ts";
import type { Used, ValueSource, VaultRunDeps } from "../../vault-use/index.ts";
import { DriverError } from "../api/driver.ts";
import type { Authorizer } from "../api/types.ts";
import { API_AUTH } from "./credentials.ts";
import { fillErrorCode } from "./fill-launcher.ts";
import type { FillWho } from "./fill-launcher.ts";

export interface FillAuthorizerDeps {
  source: ValueSource;
  reportMiss: VaultRunDeps["reportMiss"];
  who: FillWho;
  onUsed?(used: readonly Used[]): void;
}

export function createFillAuthorizer(d: FillAuthorizerDeps): Authorizer {
  return async (account, provider) => {
    const got: { headers?: Record<string, string> } = {};
    const run = await runWithVault(
      { source: d.source, reportMiss: d.reportMiss },
      { tool: "engine_authorize", args: { headers: API_AUTH[provider](account.ref) }, traceId: d.who.traceId, agentId: d.who.agentId, asker: d.who.asker, where: d.who.where },
      async (args) => {
        // Kept for the caller only. What the executor returns goes through the scrubber, so it returns nothing.
        got.headers = (args as { headers: Record<string, string> }).headers;
        return "";
      },
    );
    if (!run.ok) throw new DriverError(fillErrorCode(run.error.code), run.error.message);
    if (got.headers === undefined || run.used.length === 0) throw new DriverError("engine.account_unavailable", "The account's key is not in the Vault.");
    d.onUsed?.(run.used);
    return got.headers;
  };
}
