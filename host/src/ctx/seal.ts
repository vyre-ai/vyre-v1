// ctx.seal (ARCH B2): seal(bytes, scope) and unseal(sealed) over AES-256-GCM. Each scope gets its own key, derived from the host's seal key with HKDF, and the
// scope rides in Sealed.keyId ("<key id>/<scope>") and in the AAD, so a value sealed for one scope never opens under another and unseal needs no extra argument.
import { aesUnwrap, aesWrap, hkdf32 } from "../../../kernel/src/seal/index.ts";
import type { Ctx, Sealed } from "../../../packages/contracts/src/ctx.ts";

const SCOPE = /^[a-z][a-z0-9_.:-]{0,63}$/i;
const SALT = "vyre/ctx.seal/v1";

export class SealError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SealError";
  }
}

export interface CtxSealOptions {
  /** The host's seal key: at least 16 bytes, from the Space key hierarchy. */
  key: Uint8Array | string;
  /** Names this key in Sealed.keyId so a rotated key is recognised. No "/" in it. */
  keyId: string;
}

export function createCtxSeal(o: CtxSealOptions): Ctx["seal"] {
  if (!o.key || o.key.length < 16) throw new SealError("the seal key needs at least 16 bytes");
  if (!o.keyId || o.keyId.includes("/")) throw new SealError("a seal key id is a short name without '/'");
  const kek = (scope: string): Uint8Array => hkdf32(o.key, SALT, `scope:${scope}`);
  return {
    seal(v, scope) {
      if (!(v instanceof Uint8Array)) throw new SealError("only bytes can be sealed");
      if (!SCOPE.test(scope)) throw new SealError("a seal scope is a short name");
      const keyId = `${o.keyId}/${scope}`;
      const box = aesWrap(kek(scope), v, keyId);
      return { keyId, nonce: box.iv, bytes: `${box.ct}.${box.tag}` };
    },
    unseal(s: Sealed) {
      const cut = typeof s?.keyId === "string" ? s.keyId.indexOf("/") : -1;
      if (cut < 1 || s.keyId.slice(0, cut) !== o.keyId) throw new SealError("this value was sealed under a different key");
      const scope = s.keyId.slice(cut + 1);
      const [ct, tag, extra] = typeof s.bytes === "string" ? s.bytes.split(".") : [];
      if (!SCOPE.test(scope) || !ct || !tag || extra !== undefined || typeof s.nonce !== "string") throw new SealError("this sealed value is malformed");
      try {
        return new Uint8Array(aesUnwrap(kek(scope), { iv: s.nonce, ct, tag }, s.keyId));
      } catch {
        throw new SealError("this sealed value does not open (wrong key, scope or altered bytes)");
      }
    },
  };
}
