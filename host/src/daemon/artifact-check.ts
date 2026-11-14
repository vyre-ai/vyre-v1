// The one way the server asks an artifact host whether it reaches this Space (the daemon's self-check and `vyre-server doctor` both use it). It is a request from the server to a name set by the
// operator (the Space's address, or VYRE_ARTIFACT_HOST), so it is held to a few rules: https only, a plain DNS name (or the loopback form the code derives itself), no redirect followed (a redirecting
// answer is not this host), ONE deadline over the headers AND the body (a host that sends headers and then stalls must not hold anything), and a small answer (a long one is refused unread when it says so,
// and the abort at the deadline bounds one that does not). It reads one short line and keeps nothing. This is not ctx.http's guardedFetch: that guard is the module egress list keyed to a connector's declared
// domains; this is the host's own check of its own configured name, so it applies the same rules by hand.
import type { FetchFn } from "../platform/probes.ts";

export const HOST_CHECK_LIMIT_MS = 5000;
/** The longest answer read: the marker line is about 40 characters. */
export const HOST_CHECK_MAX_BYTES = 512;

const DNS_NAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** A host that may be asked: a plain DNS name, or the a.localhost[:port] form of a Space on this computer. No scheme, path, credentials, IP address or other port. */
export const validArtifactHost = (host: string): boolean =>
  host.length <= 253 && (DNS_NAME.test(host) || /^a\.localhost(:\d{1,5})?$/.test(host));

export interface HostAnswer {
  ok: boolean;
  status: number;
  body: string;
}

/** The answer of https://<host><path>, or a thrown reason. Never waits longer than limitMs in all, whatever the host does. */
export async function askArtifactHost(
  f: FetchFn,
  host: string,
  path: string,
  limitMs = HOST_CHECK_LIMIT_MS,
): Promise<HostAnswer> {
  if (!validArtifactHost(host)) throw new Error("not a plain DNS name");
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, no) => {
    timer = setTimeout(() => {
      ctl.abort();
      no(new Error("did not answer in time"));
    }, limitMs);
    timer.unref();
  });
  try {
    const read = (async (): Promise<HostAnswer> => {
      const r = await f(`https://${host}${path}`, { signal: ctl.signal, redirect: "error" });
      const said = Number(r.headers.get("content-length") ?? 0);
      if (Number.isFinite(said) && said > HOST_CHECK_MAX_BYTES) throw new Error("the answer is too long");
      const body = await r.text();
      if (body.length > HOST_CHECK_MAX_BYTES) throw new Error("the answer is too long");
      return { ok: r.ok, status: r.status, body: body.trim() };
    })();
    read.catch(() => undefined); // a read that loses the race to the deadline must not become an unhandled rejection
    return await Promise.race([read, late]);
  } finally {
    clearTimeout(timer);
  }
}
