// Sign in by name for a Personal Space on several computers (lane l-multidevice). The relay pieces are the deployed ones (relay/worker/index.js): /v1/signin, signin.watch, pairing tickets, /v1/pair.
//
//   name locator   sha256("vyre-personal-signin-v1\n" + username), base64url (43 characters). Each computer of a Personal Space watches its owner's locator; the relay holds only this hash.
//   the ask        a new computer posts { loc, s }: s is 32 random bytes it keeps. The relay hands { loc, s } to every computer that watches loc, and answers the asker the same either way.
//   the answer     each computer that heard the ask registers one pairing ticket in a slot: slot = sha256(route + "\n" + s)[0] mod SLOTS, so two computers of the Space rarely meet in one
//                  slot (a second register of a live locator contests it and both are lost; the asker reads every slot). The ticket bytes are sha256("vyre-peer-ticket\n" + s + "\n" + slot);
//                  the locator, record key and MAC key come from them exactly as for a Wink ticket (relay/node/wire.js ticketDerive), so the relay stores a sealed record it cannot open.
//   the offer      { v, space, name, route, box, relay }: which computer answered and the box key to pin. Anyone who knows the name and watches it can answer too, so the offer is not trusted
//                  for anything but where to send the request; the new computer trusts the Space only after the person's own password opens the key bundle it hands back after approval.
//   the code       six digits from sha256(s + "\n" + nonce): the new computer shows it, the computer that approves shows it beside the request, so the person approves the right one.
const subtle = globalThis.crypto.subtle;
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const b64u = (b: Uint8Array): string => Buffer.from(b).toString("base64url");
const fromB64u = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "base64url"));
const sha256 = async (b: Uint8Array): Promise<Uint8Array> => new Uint8Array(await subtle.digest("SHA-256", b as BufferSource));
const concat = (...p: Uint8Array[]): Uint8Array => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };

export const SLOTS = 3;
export const TICKET_AD = "vyre-pair-record\n1";
export const ASK_RE = /^[A-Za-z0-9_-]{43}$/;

export const normalUsername = (u: string): string => u.trim().toLowerCase();

export async function nameLocator(username: string): Promise<string> {
  return b64u(await sha256(utf8(`vyre-personal-signin-v1\n${normalUsername(username)}`)));
}

export function newAskSecret(): string { return b64u(globalThis.crypto.getRandomValues(new Uint8Array(32))); }

export async function slotOf(route: string, s: string): Promise<number> {
  return (await sha256(utf8(`${route}\n${s}`)))[0]! % SLOTS;
}

interface TicketKeys { loc: string; enc: CryptoKey; mac: CryptoKey }
async function ticketKeys(s: string, slot: number): Promise<TicketKeys> {
  const tk = await sha256(utf8(`vyre-peer-ticket\n${s}\n${slot}`));
  const derive = (tag: string): Promise<Uint8Array> => sha256(concat(utf8(`${tag}\n`), tk));
  const [loc, enc, mac] = await Promise.all([derive("vyre-pair-loc"), derive("vyre-pair-enc"), derive("vyre-pair-mac")]);
  return {
    loc: b64u(loc),
    enc: await subtle.importKey("raw", enc as BufferSource, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]),
    mac: await subtle.importKey("raw", mac as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]),
  };
}

export async function ticketLocator(s: string, slot: number): Promise<string> { return (await ticketKeys(s, slot)).loc; }

/** What a computer of the Space answers an ask with. */
export interface Offer { v: 1; space: string; name: string; route: string; box: string; relay: string }

export async function sealOffer(s: string, slot: number, offer: Offer): Promise<{ loc: string; record: string; mac: string }> {
  const k = await ticketKeys(s, slot);
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: utf8(TICKET_AD) }, k.enc, utf8(JSON.stringify(offer))));
  const record = b64u(concat(nonce, ct));
  const mac = b64u(new Uint8Array(await subtle.sign("HMAC", k.mac, utf8(record))));
  return { loc: k.loc, record, mac };
}

const OFFER_ROUTE = /^[a-z2-7]{26}$/;
export async function openOffer(s: string, slot: number, got: { record: string; mac: string }): Promise<Offer | null> {
  try {
    const k = await ticketKeys(s, slot);
    if (!(await subtle.verify("HMAC", k.mac, fromB64u(got.mac) as BufferSource, utf8(got.record)))) return null;
    const b = fromB64u(got.record);
    if (b.length < 28) return null;
    const pt = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: b.subarray(0, 12), additionalData: utf8(TICKET_AD) }, k.enc, b.subarray(12)));
    const o = JSON.parse(new TextDecoder().decode(pt)) as Partial<Offer>;
    if (o.v !== 1 || typeof o.space !== "string" || !/^spc_[A-Za-z0-9_]{1,190}$/.test(o.space) || typeof o.route !== "string" || !OFFER_ROUTE.test(o.route)) return null;
    if (typeof o.box !== "string" || fromB64u(o.box).length !== 32 || typeof o.relay !== "string" || !/^(wss?|https?):\/\//.test(o.relay)) return null;
    return { v: 1, space: o.space, name: typeof o.name === "string" ? o.name.slice(0, 60) : "Your other computer", route: o.route, box: o.box, relay: o.relay };
  } catch { return null; }
}

/** The six digits both screens show for one request. */
export async function confirmCode(s: string, nonce: string): Promise<string> {
  const h = await sha256(utf8(`vyre-peer-code\n${s}\n${nonce}`));
  const n = (((h[0]! << 16) | (h[1]! << 8) | h[2]!) >>> 0) % 1_000_000;
  const d = String(n).padStart(6, "0");
  return `${d.slice(0, 3)} ${d.slice(3)}`;
}

export function newToken(prefix: string): string { return `${prefix}${b64u(globalThis.crypto.getRandomValues(new Uint8Array(32)))}`; }
export async function tokenHash(token: string): Promise<string> { return Buffer.from(await sha256(utf8(token))).toString("hex"); }
