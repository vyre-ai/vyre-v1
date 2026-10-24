// Types for relay/client (plain ES modules). Everything here is exported from ./index.js.

export interface KeyPair { privateKey: unknown; publicKey: Uint8Array }

/** The async crypto the Noise handshake runs on: WebCrypto, injected @noble, or a shell that holds the key. */
export interface CryptoProvider {
  generateKeyPair(): Promise<KeyPair>;
  dh(privateKey: unknown, peerPub: Uint8Array): Promise<Uint8Array>;
  sha256(bytes: Uint8Array): Promise<Uint8Array>;
  hmacSha256(key: Uint8Array, bytes: Uint8Array): Promise<Uint8Array>;
  aesKey?(raw: Uint8Array): Promise<unknown>;
  aesGcmEncrypt(key: unknown, nonce: Uint8Array, ad: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array>;
  aesGcmDecrypt(key: unknown, nonce: Uint8Array, ad: Uint8Array, ciphertext: Uint8Array): Promise<Uint8Array>;
  randomBytes(n: number): Uint8Array | Promise<Uint8Array>;
  importKeyPair?(rawPrivateKey: Uint8Array): Promise<KeyPair>;
}

/** Where the device key lives. On the web it is a non-extractable CryptoKey in IndexedDB. */
export interface KeyStore {
  get(): Promise<KeyPair | null>;
  set(keyPair: KeyPair): Promise<void>;
}

export interface Visibility {
  hidden(): boolean;
  /** Returns the unsubscribe function. */
  on(fn: () => void): () => void;
}

export type About = { kind?: "app" | "web"; release?: string; manifest?: string };

export interface Offer { relay: string; route: string; box: Uint8Array; secret: string; name?: string }

export interface PresenceKey { public_key: string; alg?: number; storage?: "hardware" | "software" }
export interface Passkey { credential_id: string; public_key: string; alg?: number; rp_id: string }

export interface PairOptions {
  /** This device's name, shown on the box. */
  name?: string;
  enroll?: boolean;
  presenceKey?: PresenceKey;
  passkey?: Passkey;
  about?: About;
  keyStore?: KeyStore;
  crypto?: CryptoProvider;
  WebSocket?: unknown;
  timeout?: number;
  /** Called with this device's fingerprint before the handshake, which waits for Confirm on the box. */
  onFingerprint?: (fingerprint: string) => void;
}

export interface PairedBox {
  relay: string;
  route: string;
  /** The box's public key, base64url. */
  box: string;
  name: string;
  device: string | undefined;
  pending?: true;
  gate?: string;
  presence: unknown;
  enroll: { grant: string; expires: number; rpId: string } | null;
}

export interface ResolvedTicket {
  offer: { relay: string; route: string; box: Uint8Array; secret: string };
  name: string;
  /** Two groups of four characters; the box shows the same beside its Confirm. */
  fingerprint: string;
  handle: string | null;
  address: string | null;
  identity: string | null;
  invite: object | null;
}

export interface ResolveOptions { relay: string; fetch?: typeof fetch; crypto?: CryptoProvider }

/** The pairing page a Space uses. The default is a convenience; nothing depends on it. */
export const PAIR_BASE: string;
export const REMOVED: string;

export function parsePairUrl(url: string, base?: string): { relay: string; route: string; box: Uint8Array; secret: string; name: string } | null;
/** Pair from the offer URL a box shows as a QR code (the invite code). `pairBase` is the Space's own pairing page. */
export function pair(offerUrl: string, options?: PairOptions & { pairBase?: string }): Promise<PairedBox>;
export function pairOffer(offer: Offer, options?: PairOptions): Promise<PairedBox>;
/** Look up a compact pair code against the relay and verify it, without pairing. Errors carry a `code`: bad_input, ticket_gone, rate_limited, contested, bad_record, pair_failed. */
export function resolveTicket(ticket: Uint8Array, options: ResolveOptions): Promise<ResolvedTicket>;
export function pairTicket(ticket: Uint8Array, options: ResolveOptions & PairOptions): Promise<PairedBox & { address?: string; handle?: string }>;
export function keyFingerprint(box: Uint8Array, crypto: CryptoProvider): Promise<string>;
export function sameRelay(named: string, asked: string): boolean;
export function deviceKey(o: { keyStore: KeyStore; crypto: CryptoProvider }): Promise<KeyPair>;
export function defaultVisibility(): Visibility;

export type ConnectionState = "connecting" | "open" | "offline" | "relay_removed";

export interface ConnectOptions {
  relay: string;
  route: string;
  /** The box's public key, base64url or bytes. */
  box: string | Uint8Array;
  name?: string;
  about?: About;
  keyStore?: KeyStore;
  crypto?: CryptoProvider;
  WebSocket?: unknown;
  visibility?: Visibility;
  pingMs?: number;
  backoff?: { min?: number; max?: number };
  timeout?: number;
  rekeyEvery?: number;
  random?: () => number;
  invitee?: boolean;
  homeMove?: boolean;
  chainHello?: (devicePublicKey: Uint8Array) => Promise<object> | object;
  presenceKey?: PresenceKey | (() => Promise<PresenceKey> | PresenceKey);
}

export interface RelayResponse {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null; forEach(fn: (value: string, key: string) => void): void };
  body: AsyncIterable<Uint8Array>;
  text(): Promise<string>;
  json(): Promise<any>;
  bytes(): Promise<Uint8Array>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface FetchInit { method?: string; headers?: Record<string, string>; body?: string | Uint8Array | ArrayBuffer | null; signal?: AbortSignal }
export interface SseEvent { id?: string; event?: string; data: string }
export interface EventFollow { readonly lastEventId: string | undefined; reopen(): void; close(): void }

export class RelaySocket {
  readyState: number;
  binaryType: string;
  onopen: ((e: unknown) => void) | null;
  onmessage: ((e: { data: string | ArrayBuffer }) => void) | null;
  onclose: ((e: { code: number; reason: string; wasClean: boolean }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  send(data: string | Uint8Array | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
}

/** A kept-open channel to one paired box. */
export class Connection {
  constructor(options: ConnectOptions);
  state: ConnectionState;
  onstate: (state: ConnectionState) => void;
  readonly open: boolean;
  reply: unknown;
  lastError: Error | null;
  fetch(path: string, init?: FetchInit): Promise<RelayResponse>;
  events(path: string, options: { onEvent: (e: SseEvent) => void; lastEventId?: string }): EventFollow;
  socket(path: string, options?: { headers?: Record<string, string> }): RelaySocket;
  close(): void;
}
export function connect(options: ConnectOptions): Connection;
export function openChannel(options: Record<string, unknown>): Promise<{ channel: unknown; reply: unknown; ws: unknown }>;
export function request(channel: unknown, head: unknown, body: Uint8Array, signal?: AbortSignal): Promise<RelayResponse>;

export function createPaths(options: {
  paths: Array<{ kind: "direct"; base: string } | ({ kind: "relay" } & Record<string, unknown>)>;
  fetch?: typeof fetch;
  WebSocket?: unknown;
  visibility?: Visibility;
  directTimeout?: number;
  probeMs?: number;
  probePath?: string;
  report?: boolean;
  onstate?: (s: { kind: string; index: number; state: string }) => void;
}): { current: unknown; fetch(path: string, init?: FetchInit): Promise<RelayResponse>; events(path: string, options: { onEvent: (e: SseEvent) => void }): EventFollow; socket(path: string): unknown; close(): void } & Record<string, unknown>;

export function health(source: unknown, options?: { since?: number; rtt?: number | null }): {
  reach: "direct" | "relay" | "none";
  why: string;
  fix?: { action: string; label: string };
  since: number;
  tailnet?: { path: string; latencyMs: number | null };
};
export function watch(paths: unknown, options?: { now?: () => number; rtt?: () => number | null }): unknown;

export function webCrypto(options?: { subtle?: SubtleCrypto; getRandomValues?: (a: Uint8Array) => Uint8Array }): CryptoProvider & { importKeyPair(raw: Uint8Array): Promise<KeyPair> };
export function createDeviceKey(provider?: CryptoProvider): Promise<KeyPair>;
export function memoryKeyStore(): KeyStore;
export function indexedDbKeyStore(options?: { indexedDB?: IDBFactory; db?: string; store?: string; key?: string }): KeyStore;

/** For iOS and Android, where Hermes has no WebCrypto X25519: the app injects @noble/curves, @noble/hashes and @noble/ciphers. */
export function nobleCrypto(n: {
  x25519: { getPublicKey(priv: Uint8Array): Uint8Array; getSharedSecret(priv: Uint8Array, pub: Uint8Array): Uint8Array; utils?: { randomSecretKey?: () => Uint8Array; randomPrivateKey?: () => Uint8Array } };
  sha256: (b: Uint8Array) => Uint8Array;
  hmac: (hash: unknown, key: Uint8Array, msg: Uint8Array) => Uint8Array;
  gcm: (key: Uint8Array, nonce: Uint8Array, aad?: Uint8Array) => { encrypt(pt: Uint8Array): Uint8Array; decrypt(ct: Uint8Array): Uint8Array };
  randomBytes: (n: number) => Uint8Array;
}): CryptoProvider & { importKeyPair(raw: Uint8Array): Promise<KeyPair> };

/** A desktop shell that keeps the device key natively (DPAPI, Keychain): the page holds a marker, and every DH is a call into the shell. */
export function shellDeviceKey(invoke: (cmd: string, args?: unknown) => Promise<unknown>, options?: { crypto?: CryptoProvider }): { crypto: CryptoProvider; keyStore: KeyStore };

export const SEED_BYTES: number;
export const QR_PREFIX: string;
export function newSeed(crypto: CryptoProvider): Uint8Array;
export function seedToWords(seed: Uint8Array, crypto: CryptoProvider): Promise<string[]>;
export function wordsToSeed(words: string | string[], crypto: CryptoProvider): Promise<Uint8Array>;
export function seedQrText(seed: Uint8Array): string;
export function parseSeedText(text: string, crypto: CryptoProvider): Promise<Uint8Array>;

export function qrMatrix(text: string): boolean[][];
export function qrLines(text: string, options?: { quiet?: number }): string[];
export function qrArt(text: string, options?: { quiet?: number }): string;

export function createWsBridge(options: Record<string, unknown>): unknown;
export function webviewShim(): string;

export function base64url(bytes: Uint8Array): string;
export function fromBase64url(text: string): Uint8Array;
export function base32(bytes: Uint8Array): string;
export function utf8(text: string): Uint8Array;
export function fromUtf8(bytes: Uint8Array): string;
export function concat(...parts: Uint8Array[]): Uint8Array;
export function equal(a: Uint8Array, b: Uint8Array): boolean;
