// Seam wiring at boot: build the Google, Microsoft and IMAP seams from the Vault and register them with the modules that call them.
// Host never imports a module (layer rule, and boundaries.ts rejects a non-literal import()), so the three registration functions arrive as arguments: the daemon passes
// setGoogleHost and setImapSecretResolver from the module files it already imports for the loader, a test passes fakes. A setter that is not given (the Microsoft module is not in the
// tree yet) leaves that seam "absent"; it is reported in the result, not a boot failure.
import { createGoogleHost } from "./google.ts";
import type { GoogleHostSeam, GoogleSeamDeps } from "./google.ts";
import { createImapSecretResolver } from "./imap.ts";
import { createMailgunHost, createResendHost } from "./mail-providers.ts";
import type { MailgunHostSeam, ResendHostSeam } from "./mail-providers.ts";
import type { ImapSecretResolver } from "./imap.ts";
import { createMsHost } from "./microsoft.ts";
import { createSourcesSecretResolver } from "./sources.ts";
import type { SourcesSecretResolver } from "./sources.ts";
import type { MsHostSeam, MsSeamDeps } from "./microsoft.ts";
import type { FetchedResponse, SeamFetch, SpaceBlobs, SpaceFiles, SpaceMembers, VaultPort } from "./ports.ts";

export { createGoogleHost, createImapSecretResolver, createMailgunHost, createMsHost, createResendHost, createSourcesSecretResolver };
export type { FetchedResponse, GoogleHostSeam, MailgunHostSeam, ResendHostSeam, GoogleSeamDeps, ImapSecretResolver, MsHostSeam, SourcesSecretResolver, MsSeamDeps, SeamFetch, SpaceBlobs, SpaceFiles, SpaceMembers, VaultPort };

export interface SeamSetters {
  setGoogleHost?: ((h: GoogleHostSeam | null) => void) | undefined;
  setMsHost?: ((h: MsHostSeam | null) => void) | undefined;
  setImapSecretResolver?: ((fn: ImapSecretResolver | null) => void) | undefined;
  /** the sources module's deps.secret: webhook signing secrets from the Vault */
  setSourcesSecretResolver?: ((fn: SourcesSecretResolver | null) => void) | undefined;
  /** the Space sending backends (P-L5_05): key, files, downloads; Mailgun also uploads and the public address */
  setResendHost?: ((h: ResendHostSeam | null) => void) | undefined;
  setMailgunHost?: ((h: MailgunHostSeam | null) => void) | undefined;
}

export interface SeamDeps {
  vault: VaultPort;
  fetch?: SeamFetch;
  files: SpaceFiles;
  blobs: SpaceBlobs;
  members: SpaceMembers;
  /** the Space the Vault is read for (the sources seam is fixed to it) */
  space: string;
  /** the address people reach this Space at, for Mailgun's inbound route; omitted: that call answers unavailable */
  publicUrl?: ((space: string) => Promise<string>) | undefined;
}

export type SeamState = "wired" | "absent";
export interface WiredSeams {
  state: { google: SeamState; microsoft: SeamState; imap: SeamState; sources: SeamState; resend: SeamState; mailgun: SeamState };
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
  const state: WiredSeams["state"] = { google: "absent", microsoft: "absent", imap: "absent", sources: "absent", resend: "absent", mailgun: "absent" };
  if (setters.setGoogleHost) { setters.setGoogleHost(createGoogleHost(common)); state.google = "wired"; }
  if (setters.setMsHost) { setters.setMsHost(createMsHost(common)); state.microsoft = "wired"; }
  if (setters.setImapSecretResolver) { setters.setImapSecretResolver(createImapSecretResolver(deps.vault)); state.imap = "wired"; }
  if (setters.setSourcesSecretResolver) { setters.setSourcesSecretResolver(createSourcesSecretResolver(deps.vault, deps.space)); state.sources = "wired"; }
  const mail = { vault: deps.vault, fetch: common.fetch, files: deps.files, blobs: deps.blobs, publicUrl: deps.publicUrl };
  if (setters.setResendHost) { setters.setResendHost(createResendHost(mail)); state.resend = "wired"; }
  if (setters.setMailgunHost) { setters.setMailgunHost(createMailgunHost(mail)); state.mailgun = "wired"; }
  return {
    state,
    unwire() {
      setters.setGoogleHost?.(null);
      setters.setMsHost?.(null);
      setters.setImapSecretResolver?.(null);
      setters.setSourcesSecretResolver?.(null);
      setters.setResendHost?.(null);
      setters.setMailgunHost?.(null);
    },
  };
}
