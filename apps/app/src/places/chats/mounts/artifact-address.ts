// The address an opened artifact is framed or opened at. sites.artifact_open always returns a one-time code on the artifact host (/x/<code>); there is no keyed address any more.
export const artifactAddress = (
  open: { path: string; url?: string | undefined },
  base: string | undefined,
  embed = false,
  native = false,
): string => {
  const at = open.url ?? `${(base ?? "").replace(/\/+$/, "")}${open.path}`;
  // framed in the app, the host's cookie is partitioned to the app (the host's CSP lets only the app frame it)
  // the desktop app's own page of the host (not a frame, so no partitioned cookie): `app=1` only tells the host's plain pages they are inside Vyre, so they carry no link back to it
  if (!/\/x\/[0-9a-f]{48}$/.test(at)) return at;
  return embed ? `${at}?embed=1` : native ? `${at}?app=1` : at;
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
 * opened as a white rectangle), so the app asks the artifact host itself before it frames anything. The host answers the dead code with its own page, which carries a mark, and lets the Space's own app read it
 * (host/src/routes/artifact-host.ts). Success is ONLY that: an answer the app can read and that carries the mark. Anything else is a failure, on every host form: silence, an error, an answer with no mark, and an
 * answer it cannot read at all. The last matters most: the relay's edge answers a name no Space holds with a bare 404 and NO access-control-allow-origin (fixture
 * apps/app/tests/fixtures/relay-edge-unclaimed-404.json, recorded from the real edge), which a browser refuses to read; treating "something answered" as good framed that 404 and drew the white page again. A server older
 * than this check does not allow the read, so with it the tab shows the failed state until the server updates. Never throws.
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
  if (!f) return false;
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // the limit is the app's own clock over the whole read, so a fetch that ignores its abort signal cannot hold the tab on its loading mark
  const late = new Promise<never>((_, no) => {
    timer = setTimeout(() => {
      ctl.abort();
      no(new Error("the artifact host did not answer in time"));
    }, limitMs);
  });
  try {
    const read = (async (): Promise<string> =>
      (
        await f(`${at.origin}/x/${PROBE_CODE}`, {
          mode: "cors",
          credentials: "omit",
          cache: "no-store",
          signal: ctl.signal,
        })
      ).text())();
    return /<meta name="vyre-artifact-host" content="1">/.test(await Promise.race([read, late]));
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
