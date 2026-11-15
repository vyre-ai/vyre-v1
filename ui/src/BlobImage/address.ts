/** True for an address the Space answers only to a signed-in caller: /spaces/<space>/blobs/<id>, relative or on the Space's own origin. */
export const isSpaceBlob = (uri: string): boolean => /^(?:https?:\/\/[^/]+)?\/spaces\/[^/]+\/blobs\/[^/?#]+/.test(uri);
