// esign: the hosted providers, built from the Space's Vault each time they are needed (SIGN-PLAN gap 1; P6 migration step 1). Before this, nothing outside a test ever registered Dropbox Sign or DocuSign, so a key
// in the Vault changed nothing. Now a key added or removed takes effect on the next call, and what a person connected is what runs. The Vault items are named like the service:
//   #Dropbox_Sign   apiKey (required), clientId, testMode ("true" for Dropbox's free test mode), baseUrl
//   #DocuSign       integrationKey, userId, accountId, baseUri, privateKey (all required), authHost
// The values are read for the call and held only inside the provider object; they are never logged and never leave this module except to the service's own address.

import { docusign } from "./docusign.ts";
import { dropboxSign } from "./dropbox.ts";
import type { HttpFn } from "./documenso.ts";
import { setBuilt } from "./send.ts";
import type { EsignProvider, ProviderKey } from "./send.ts";

export interface HostedAccess {
  /** One Vault field as text, or rejects when the item or the field is not there. */
  secret(handle: string): Promise<string>;
  http: HttpFn;
}

let access: HostedAccess | null = null;
export function setHostedAccess(a: HostedAccess | null): void {
  access = a;
  last.clear();
  for (const k of ["dropbox_sign", "docusign"] as const) setBuilt(k, undefined);
}

const last = new Map<ProviderKey, { fingerprint: string; provider: EsignProvider }>();

async function field(handle: string): Promise<string | null> {
  try {
    const v = await (access as HostedAccess).secret(handle);
    return typeof v === "string" && v.trim() !== "" ? v : null;
  } catch {
    return null;
  }
}

async function read(names: Record<string, boolean>, item: string): Promise<Record<string, string> | null> {
  const out: Record<string, string> = {};
  for (const [name, required] of Object.entries(names)) {
    const v = await field(`${item}.${name}`);
    if (v === null) {
      if (required) return null;
      continue;
    }
    out[name] = v;
  }
  return out;
}

/** Makes the hosted providers that have a Vault item ready for this call, and takes away the ones whose item is gone. A call with no host (a test) leaves the registered providers as they are. */
export async function prime(): Promise<void> {
  if (!access) return;
  const http = access.http;
  const dropbox = await read({ apiKey: true, clientId: false, testMode: false, baseUrl: false }, "#Dropbox_Sign");
  const docu = await read(
    { integrationKey: true, userId: true, accountId: true, baseUri: true, privateKey: true, authHost: false },
    "#DocuSign",
  );
  const make = (
    key: ProviderKey,
    creds: Record<string, string> | null,
    build: (c: Record<string, string>) => EsignProvider,
  ): void => {
    if (creds === null) {
      last.delete(key);
      setBuilt(key, undefined);
      return;
    }
    const fingerprint = JSON.stringify(creds);
    const kept = last.get(key);
    if (kept?.fingerprint === fingerprint) return setBuilt(key, kept.provider);
    const provider = build(creds);
    last.set(key, { fingerprint, provider });
    setBuilt(key, provider);
  };
  make("dropbox_sign", dropbox, (c) =>
    dropboxSign({
      apiKey: c.apiKey as string,
      http,
      ...(c.clientId ? { clientId: c.clientId } : {}),
      ...(c.testMode === "true" ? { testMode: true } : {}),
      ...(c.baseUrl ? { baseUrl: c.baseUrl } : {}),
    }),
  );
  make("docusign", docu, (c) =>
    docusign({
      integrationKey: c.integrationKey as string,
      userId: c.userId as string,
      accountId: c.accountId as string,
      baseUri: c.baseUri as string,
      privateKey: c.privateKey as string,
      http,
      ...(c.authHost ? { authHost: c.authHost } : {}),
    }),
  );
}
