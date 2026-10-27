export interface FilesHost {
  resources: {
    ensure(r: { id: string; type: "folder"; parentId: string | null; ownerId?: string }): Promise<void>;
    setLabel(r: { id: string; type: "folder"; label: "public" | "internal" | "confidential" | "restricted" }): Promise<void>;
  };
}

let configured: FilesHost | null = null;

export function setFilesHost(host: FilesHost | null): void { configured = host; }
export function filesHost(): FilesHost | null { return configured; }

/** Update the Access projection through the host without crossing a public, Team-only capability gate. */
export async function setFolderLabel(id: string, label: "public" | "internal" | "confidential" | "restricted"): Promise<void> {
  if (!configured) throw new Error("The Files host is not configured.");
  await configured.resources.setLabel({ id, type: "folder", label });
}
