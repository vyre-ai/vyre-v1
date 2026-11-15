/**
 * True for an address the Space answers only to a signed-in caller: /spaces/<space>/blobs/<id>, relative or on the Space's own origin. An address on any other host is never a Space blob (a reply or a pasted
 * document can name any host, and the person's sign-in must never go to one); with no origin given only a relative address counts.
 */
export function isSpaceBlob(uri: string, origin?: string): boolean {
  const m = /^(https?:\/\/[^/?#]+)?\/spaces\/[^/]+\/blobs\/[^/?#]+/.exec(uri);
  if (m === null) return false;
  if (m[1] === undefined) return true;
  return origin !== undefined && m[1].toLowerCase() === origin.toLowerCase();
}
