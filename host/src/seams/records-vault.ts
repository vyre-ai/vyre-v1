// The Vault, as Records needs it for sealed fields (the host half of modules/records setRecordsVault). A sealed value is one Vault item in a Space owned Shared folder called "Sealed fields",
// named after the record and field, so a retry of the same put is the same item. Records keep only the item's id as the reference; the plaintext goes to the Vault over `put` and nowhere else,
// and comes back only through `reveal`, which runs vault.item.reveal as the person asking, so the Vault checks their access and logs the reveal.
// Layer rule: host never imports a module, so the shape is structural here and the module has its own copy of the types.

export interface RecordsVaultSeam {
  /** Store one value (a new item, or a new value in the item `ref` names) and answer the item's id, the reference a record keeps. */
  put(o: { type: string; recordId: string; field: string; value: string; ref?: string }): Promise<string>;
  /** Show one value to one person. The Vault refuses a person without access and logs every reveal. */
  reveal(ref: string, person: string): Promise<string>;
}

export interface RecordsVaultDeps {
  /** Run a capability as the host's service principal (no approval step, no person). */
  system(cap: string, input: unknown): Promise<unknown>;
  /** Run a capability as a person: their own access decides. */
  as(person: string, cap: string, input: unknown): Promise<unknown>;
  /** Make the folder a resource in access, as the Vault's folder repair does, so people with the Space role can reach what is in it. */
  registerFolder(folderId: string): Promise<void>;
}

export const SEALED_FOLDER = "Sealed fields";
export const SEALED_KEY = "value";

export function createRecordsVaultHost(d: RecordsVaultDeps): RecordsVaultSeam {
  let folder: Promise<string> | null = null;
  const folderId = (): Promise<string> => {
    folder ??= (async () => {
      const have = ((await d.system("vault.folders.list", { scope: "shared" })) as { folders: { id: string; name: string }[] }).folders.find((f) => f.name === SEALED_FOLDER);
      const id = have?.id ?? ((await d.system("vault.folders.create", { name: SEALED_FOLDER, scope: "shared", idempotencyKey: "sealed-fields-folder" })) as { folder: { id: string } }).folder.id;
      await d.registerFolder(id);
      return id;
    })().catch((e: unknown) => { folder = null; throw e; });
    return folder;
  };
  return {
    async put(o) {
      const fields = [{ key: SEALED_KEY, value: o.value, secret: true }];
      if (o.ref) {
        await d.system("vault.item.update", { itemId: o.ref, fieldsSet: fields });
        return o.ref;
      }
      const out = (await d.system("vault.item.put", {
        folderId: await folderId(), name: `${o.type}.${o.field}.${o.recordId}`, kind: "other", fields, idempotencyKey: `sealed-${o.type}-${o.field}-${o.recordId}`,
      })) as { item: { id: string } };
      return out.item.id;
    },
    async reveal(ref, person) {
      const out = (await d.as(person, "vault.item.reveal", { itemId: ref, fields: [SEALED_KEY], reason: "Revealed from a record" })) as { fields: { key: string; value: string }[] };
      const v = out.fields.find((f) => f.key === SEALED_KEY)?.value;
      if (v === undefined) throw new Error("The sealed value is missing from the Vault.");
      return v;
    },
  };
}
