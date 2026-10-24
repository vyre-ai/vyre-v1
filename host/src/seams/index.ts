// Seam wiring at boot: build the Google, Microsoft and IMAP seams from the Vault and register them with the modules that call them.
// Host never imports a module (layer rule, and boundaries.ts rejects a non-literal import()), so the three registration functions arrive as arguments: the daemon passes
// setGoogleHost and setImapSecretResolver from the module files it already imports for the loader, a test passes fakes. A setter that is not given (the Microsoft module is not in the
// tree yet) leaves that seam "absent"; it is reported in the result, not a boot failure.
import { createGoogleHost } from "./google.ts";
import type { GoogleHostSeam, GoogleSeamDeps } from "./google.ts";
import { createImapSecretResolver } from "./imap.ts";
import type { ImapSecretResolver } from "./imap.ts";
import { createMsHost } from "./microsoft.ts";
import type { MsHostSeam, MsSeamDeps } from "./microsoft.ts";
import type { FetchedResponse, SeamFetch, SpaceBlobs, SpaceFiles, SpaceMembers, VaultPort } from "./ports.ts";

export { createGoogleHost, createImapSecretResolver, createMsHost };
export type { FetchedResponse, GoogleHostSeam, GoogleSeamDeps, ImapSecretResolver, MsHostSeam, MsSeamDeps, SeamFetch, SpaceBlobs, SpaceFiles, SpaceMembers, VaultPort };

export interface SeamSetters {
  setGoogleHost?: ((h: GoogleHostSeam | null) => void) | undefined;
  setMsHost?: ((h: MsHostSeam | null) => void) | undefined;
  setImapSecretResolver?: ((fn: ImapSecretResolver | null) => void) | undefined;
}

export interface SeamDeps {
  vault: VaultPort;
  fetch?: SeamFetch;
  files: SpaceFiles;
  blobs: SpaceBlobs;
  members: SpaceMembers;
}

export type SeamState = "wired" | "absent";
export interface WiredSeams {
  state: { google: SeamState; microsoft: SeamState; imap: SeamState };
  /** Take every seam back out (shutdown, tests). */
  unwire(): void;
}

const defaultFetch: SeamFetch = async (url, init) => {
  // a token request or a bearer download never follows a redirect off the listed host, so redirects are errors here
  const r = await globalThis.fetch(url, {
    ...(init?.method ? { method: init.method } : {}), ...(init?.headers ? { headers: init.headers } : {}),
    ...(init?.body !== undefined ? { body: init.body } : {}), redirect: "error",
  } as never);
  return { status: r.status, text: () => r.text(), arrayBuffer: () => r.arrayBuffer() };
};

export function wireSeams(setters: SeamSetters, deps: SeamDeps): WiredSeams {
  const common = { vault: deps.vault, fetch: deps.fetch ?? defaultFetch, files: deps.files, blobs: deps.blobs, members: deps.members };
  const state: WiredSeams["state"] = { google: "absent", microsoft: "absent", imap: "absent" };
  if (setters.setGoogleHost) { setters.setGoogleHost(createGoogleHost(common)); state.google = "wired"; }
  if (setters.setMsHost) { setters.setMsHost(createMsHost(common)); state.microsoft = "wired"; }
  if (setters.setImapSecretResolver) { setters.setImapSecretResolver(createImapSecretResolver(deps.vault)); state.imap = "wired"; }
  return {
    state,
    unwire() {
      setters.setGoogleHost?.(null);
      setters.setMsHost?.(null);
      setters.setImapSecretResolver?.(null);
    },
  };
}
