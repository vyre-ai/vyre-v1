// The IMAP password for one login (modules/mail setImapSecretResolver): the Vault releases it for this call only. The handle must look like a Vault handle;
// the value is returned to the caller and not kept, logged or cached here.
import { fail } from "../routes/errors.ts";
import { HANDLE } from "./ports.ts";
import type { VaultPort } from "./ports.ts";

export type ImapSecretResolver = (handle: string, ctx: { space: string; trace: { traceId: string } }) => Promise<string>;

export function createImapSecretResolver(vault: Pick<VaultPort, "secret">): ImapSecretResolver {
  return async (handle, ctx) => {
    if (!HANDLE.test(handle)) throw fail("provider.auth_failed", ctx.trace.traceId, { message: "The mailbox password is not a Vault handle." });
    let value: string;
    try { value = await vault.secret(handle, ctx.space); } catch { throw fail("provider.auth_failed", ctx.trace.traceId, { message: "The vault did not release the mailbox password." }); }
    if (!value) throw fail("provider.auth_failed", ctx.trace.traceId, { message: "The mailbox password in the Vault is empty." });
    return value;
  };
}
