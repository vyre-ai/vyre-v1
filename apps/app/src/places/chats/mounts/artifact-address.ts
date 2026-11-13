// The address an opened artifact is framed or opened at. sites.artifact_open always returns a one-time code on the artifact host (/x/<code>); there is no keyed address any more.
export const artifactAddress = (
  open: { path: string; url?: string | undefined },
  base: string | undefined,
  embed = false,
): string => {
  const at = open.url ?? `${(base ?? "").replace(/\/+$/, "")}${open.path}`;
  // framed in the app, the host's cookie is partitioned to the app (the host's CSP lets only the app frame it)
  return embed && /\/x\/[0-9a-f]{48}$/.test(at) ? `${at}?embed=1` : at;
};

/** The link to copy and share: the plain address of the artifact on this app, which asks anyone who opens it to sign in. A one-time code is for opening, never for copying. */
export const plainLink = (base: string | undefined, artifactId: string): string =>
  `${(base ?? "").replace(/\/+$/, "")}/a/${artifactId}`;

/** A one-time code no artifact was ever given: the artifact host answers it with its own plain "This link has ended" page, which is what the check below reads. It uses nothing up. */
export const PROBE_CODE = "0".repeat(48);
/** How long the app waits for the artifact host to answer before it says it could not be reached. */
export const PROBE_LIMIT_MS = 8_000;

type ProbeFetch = (
  url: string,
  init?: { mode?: "cors" | "no-cors"; credentials?: "omit"; cache?: "no-store"; signal?: AbortSignal },
) => Promise<{ text(): Promise<string> }>;

/**
 * Does the address an artifact opens at reach a Vyre artifact host? A frame reports nothing across origins (onLoad fires for a blank page, a refusal and a relay's 404 alike, which is how an artifact
 * opened as a white rectangle), so the app asks the host itself before it frames anything. The host answers the dead code with its own page (read across origins by the Space's own app only, host/src/routes/artifact-host.ts)
 * and the page carries a mark; the relay hands every answer on with the same read allowance, so a name the relay does not know (its own 404) is told apart from this host. A server too old to allow the read is
 * not told apart from one that is not there by that read, so when the read is refused the app falls back to asking without reading: a name that does not answer at all (no record, no certificate) still fails, and
 * one that answers is let through as it always was. Never throws.
 */
export async function artifactHostAnswers(
  address: string,
  f: ProbeFetch | undefined = (globalThis as { fetch?: ProbeFetch }).fetch,
  limitMs = PROBE_LIMIT_MS,
): Promise<boolean> {
  let at: URL;
  try {
    at = new URL(address);
  } catch {
    return true; // a relative address is the app's own origin: nothing to check
  }
  if (!f) return true;
  const probe = `${at.origin}/x/${PROBE_CODE}`;
  const once = (mode: "cors" | "no-cors"): Promise<{ text(): Promise<string> }> => {
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // the limit is the app's own clock, so a fetch that ignores its abort signal cannot hold the tab on its loading mark
    const late = new Promise<never>((_, no) => {
      timer = setTimeout(() => {
        ctl.abort();
        no(new Error("the artifact host did not answer in time"));
      }, limitMs);
    });
    return Promise.race([f(probe, { mode, credentials: "omit", cache: "no-store", signal: ctl.signal }), late]).finally(
      () => clearTimeout(timer),
    );
  };
  try {
    return /<meta name="vyre-artifact-host" content="1">/.test(await (await once("cors")).text());
  } catch {
    try {
      await once("no-cors");
      return true;
    } catch {
      return false;
    }
  }
}
