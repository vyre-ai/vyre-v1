// The registry hash this build of the app was exported against. CI bakes it in at `expo export` time as EXPO_PUBLIC_VYRE_REGISTRY_HASH (scripts/lib/registry-hash.mjs: sha256 of
// generated/registry.json, the value the daemon computes), because generated/hash.txt no longer exists. The access must stay the literal `process.env.EXPO_PUBLIC_VYRE_REGISTRY_HASH`,
// the only form Expo inlines. OpenSessionOptions.registryHash defaults to this, so the live hello never says "".
export const BUILD_REGISTRY_HASH: string = process.env.EXPO_PUBLIC_VYRE_REGISTRY_HASH ?? "";
