// One dynamic boundary for the browser's expensive password-key implementation. Multiple direct
// imports make Metro hoist hash-wasm into the startup common chunk; callers reach it only when a
// person unlocks or creates key material.
export const loadCryptoKeys = () => import("./keys.ts");
// Types only: erased at build, so a startup file can name the key shapes without importing keys.ts.
export type { MadeBundle } from "./keys.ts";

export const loadRecoveryCrypto = () => import("./recovery.ts");
