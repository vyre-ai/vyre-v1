// The IMAP password for one login (modules/mail setImapSecretResolver): the Vault releases it for this call only. The handle must look like a Vault handle;
// the value is returned to the caller and not kept, logged or cached here.
import { fail } from "../routes/errors.ts";
import { HANDLE } from "./ports.ts";
import type { VaultPort } from "./ports.ts";

export type ImapSecretResolver = (handle: string, ctx: { space: string; trace: { traceId: string } }, asker?: string) => Promise<string>;

export function createImapSecretResolver(vault: Pick<VaultPort, "secret">): ImapSecretResolver {
  return async (handle, ctx, asker) => {
    if (!HANDLE.test(handle)) throw fail("provider.auth_failed", ctx.trace.traceId, { message: "The mailbox password is not a Vault handle." });
    let value: string;
    // why the Vault said no, in fixed words (never its own text, which may carry more): locked, or no item under that name
    try { value = await vault.secret(handle, ctx.space, asker); } catch (e) {
      const said = e instanceof Error ? e.message : "";
      const message = /locked/i.test(said) ? "Your sign-ins are locked on this server. Unlock Vyre to use the mailbox password." : /no (shared )?item/i.test(said) ? "The Vault has no item for that mailbox password." : "The vault did not release the mailbox password.";
      throw fail("provider.auth_failed", ctx.trace.traceId, { message });
    }
    if (!value) throw fail("provider.auth_failed", ctx.trace.traceId, { message: "The mailbox password in the Vault is empty." });
    return value;
  };
}
