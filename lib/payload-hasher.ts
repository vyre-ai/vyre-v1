// The hash a held call's approval is bound to is made by the host (the hook that parks the call), which owns the cryptography (boundary B3). Editing a held message re-binds the approval to the new words,
// so the daemon hands the same function to the Gate module through this one binding (modules/gate/handlers/revise.ts).
export type PayloadHasher = (capName: string, capVersion: number, input: unknown, principal: { kind: string; id: string }, actingFor: string | undefined) => string;
let hasher: PayloadHasher | null = null;
export function bindPayloadHash(f: PayloadHasher | null): void { hasher = f; }
export const payloadHasher = (): PayloadHasher | null => hasher;
