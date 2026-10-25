// The webhook signing secret for the sources module (deps.secret): the module hands over the Vault item name saved on a source, the Vault releases the value for this delivery only.
// A name the Vault does not know, an empty value or a Vault failure all read as "no secret", which the sources module turns into a refused delivery (bad_signature). Nothing is kept, logged or cached here.
import { HANDLE } from "./ports.ts";
import type { VaultPort } from "./ports.ts";

export type SourcesSecretResolver = (name: string) => Promise<string | undefined>;

/** `space` is the Space whose Vault is read; the daemon runs one Space, so it is fixed when the seam is built. */
export function createSourcesSecretResolver(vault: Pick<VaultPort, "secret">, space: string): SourcesSecretResolver {
  return async (name) => {
    const handle = name.startsWith("#") ? name : `#${name}`;
    if (!HANDLE.test(handle)) return undefined;
    try {
      const value = await vault.secret(handle, space);
      return value ? value : undefined;
    } catch { return undefined; }
  };
}
