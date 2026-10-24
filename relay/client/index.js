// relay/client: the device side of the relay and of pairing, as plain ES modules with no npm dependency.
// The web app, the desktop shell, the installer and the tests all import these same files; index.d.ts types them.
export { pair, pairOffer, pairTicket, resolveTicket, parsePairUrl, keyFingerprint, sameRelay, connect, Connection, openChannel, request, RelaySocket, deviceKey, defaultVisibility, PAIR_BASE, REMOVED } from "./client.js";
export { createPaths } from "./paths.js";
export { webCrypto, createDeviceKey, memoryKeyStore, indexedDbKeyStore } from "./webcrypto.js";
export { nobleCrypto } from "./noble.js";
export { shellDeviceKey } from "./shellkey.js";
export { SEED_BYTES, QR_PREFIX, newSeed, seedToWords, wordsToSeed, seedQrText, parseSeedText } from "./seedwords.js";
export { health, watch } from "./health.js";
export { qrMatrix, qrLines, qrArt } from "./qr.js";
export { createWsBridge, webviewShim } from "./wsbridge.js";
export { base64url, fromBase64url, base32, utf8, fromUtf8, concat, equal } from "./bytes.js";
