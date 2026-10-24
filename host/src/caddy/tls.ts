// Certificate state for a host Caddy serves: connect to the local HTTPS listener with the host as SNI and read the certificate Caddy presents. Caddy answers with a TLS alert
// until it holds a certificate for a name, so "no certificate" means "not issued yet". node:tls is not a crypto-key import (boundary B3 lists node:crypto and the noble libraries).
import tls from "node:tls";

export interface PeerCert {
  /** subject alternative names as Node prints them: "DNS:a.example, DNS:b.example" */
  subjectaltname?: string | undefined;
  subject?: { CN?: string | undefined } | undefined;
  issuer?: { CN?: string | undefined; O?: string | undefined } | undefined;
  /** "Oct 24 21:02:59 2026 GMT" */
  valid_to?: string | undefined;
  valid_from?: string | undefined;
}

export type PeerFn = (host: string, port: number, servername: string, timeoutMs: number) => Promise<PeerCert | null>;

export interface CertInfo {
  issued: boolean;
  expiresAt?: number;
  issuer?: string;
  /** why a certificate was presented but not accepted */
  why?: string;
}

function names(c: PeerCert): string[] {
  const san = (c.subjectaltname ?? "").split(",").map((x) => x.trim()).filter((x) => x.startsWith("DNS:")).map((x) => x.slice(4).toLowerCase());
  return san.length ? san : c.subject?.CN ? [c.subject.CN.toLowerCase()] : [];
}

const covers = (pattern: string, host: string): boolean =>
  pattern === host || (pattern.startsWith("*.") && host.endsWith(pattern.slice(1)) && host.split(".").length === pattern.split(".").length);

/** Is this the certificate for `host`: names it, in date, and not a self-signed placeholder? */
export function judgeCert(c: PeerCert | null, host: string, now: number): CertInfo {
  if (!c) return { issued: false };
  const h = host.toLowerCase();
  if (!names(c).some((n) => covers(n, h))) return { issued: false, why: "the certificate names other hosts" };
  const expiresAt = c.valid_to ? Date.parse(c.valid_to) : Number.NaN;
  const from = c.valid_from ? Date.parse(c.valid_from) : Number.NaN;
  if (!Number.isFinite(expiresAt)) return { issued: false, why: "the certificate has no end date" };
  if (expiresAt <= now) return { issued: false, expiresAt, why: "the certificate has expired" };
  if (Number.isFinite(from) && from > now + 300_000) return { issued: false, why: "the certificate is not valid yet" };
  const issuer = c.issuer?.O ?? c.issuer?.CN;
  if (c.issuer?.CN && c.subject?.CN && c.issuer.CN === c.subject.CN) return { issued: false, expiresAt, ...(issuer ? { issuer } : {}), why: "the certificate is self-signed" };
  return { issued: true, expiresAt, ...(issuer ? { issuer } : {}) };
}

/** The real connection. Resolves null on any failure: Caddy closes the handshake with an alert while it has no certificate for the name. */
export const connectPeer: PeerFn = (host, port, servername, timeoutMs) =>
  new Promise<PeerCert | null>((resolve) => {
    let done = false;
    const finish = (v: PeerCert | null): void => { if (!done) { done = true; socket.destroy(); resolve(v); } };
    const socket = tls.connect({ host, port, servername, rejectUnauthorized: false, ALPNProtocols: ["http/1.1"] }, () => {
      const c = socket.getPeerCertificate();
      finish(c && Object.keys(c).length ? (c as unknown as PeerCert) : null);
    });
    socket.setTimeout(timeoutMs, () => finish(null));
    socket.on("error", () => finish(null));
  });
