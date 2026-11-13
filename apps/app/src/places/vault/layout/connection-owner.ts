// Whose a connection row is. The server sends `owner: { kind, id }` (manifests/connectors.ts connectionRow); the Vault's Connections page read a field called ownerKind that does not exist,
// so every Space connection counted as the person's own and the Space tab was empty.
export function isMine(c: { owner?: { kind: string } }): boolean {
  return c.owner?.kind !== "space";
}
