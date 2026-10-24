// Types for relay/client. The implementation stays plain JS.

export const PAIR_BASE: string;
export function pairBase(override?: string, env?: { VYRE_PAIR_BASE?: string }): string;

export interface DeviceKey {
  privateKey: CryptoKey;
  publicKey: Uint8Array;
  source: "indexeddb" | "shell" | "memory";
}

export interface X25519Jwk {
  kty: string;
  crv: string;
  x: string;
  d: string;
}

export type ShellInvoke = (command: string) => Promise<X25519Jwk>;

export function generateAgreementKey(): Promise<DeviceKey>;
export interface IndexedDbLike {
  open(name: string, version: number): unknown;
}

export function deviceKey(opts?: {
  store?: "indexeddb" | "shell";
  indexedDB?: IndexedDbLike | null;
  invoke?: ShellInvoke;
}): Promise<DeviceKey>;
export function indexedDbDeviceKey(opts?: { indexedDB?: IndexedDbLike | null }): Promise<DeviceKey>;
export function shellDeviceKey(invoke: ShellInvoke): Promise<DeviceKey>;

export const DEVICE_DB: string;
export const DEVICE_STORE: string;
export const DEVICE_RECORD: string;

export interface NoiseSession {
  send(plain: Uint8Array): Promise<Uint8Array>;
  recv(ciphertext: Uint8Array): Promise<Uint8Array>;
}

export interface Initiator {
  message1: Uint8Array;
  finish(message2: Uint8Array): Promise<NoiseSession>;
}

export interface ResponderRead {
  remotePublic: Uint8Array;
  message2: Uint8Array;
  session: NoiseSession;
}

export function createInitiator(opts: {
  localPrivate: CryptoKey;
  localPublic: Uint8Array;
  remotePublic: Uint8Array;
  prologue?: Uint8Array;
}): Promise<Initiator>;

export function createResponder(opts: {
  localPrivate: CryptoKey;
  localPublic: Uint8Array;
  prologue?: Uint8Array;
}): Promise<{ read(message1: Uint8Array): Promise<ResponderRead> }>;

export const HEARTBEAT_MS: number;

export interface NumberedEvent {
  n: number;
  type: string;
  body: unknown;
}

export class RelaySocket {
  static encode(type: number, payload: Uint8Array): Uint8Array;
  push(chunk: Uint8Array): void;
  drain(): { type: number; payload: Uint8Array }[];
}

export class Connection {
  session: NoiseSession;
  heartbeatMs: number;
  deliver: ((ciphertext: Uint8Array) => Promise<Uint8Array>) | null;
  pushEvent(type: string, body: unknown): NumberedEvent;
  catchUp(after: number): NumberedEvent[];
  tick(now: number): Uint8Array | null;
  request(method: string, path: string, body?: unknown): Promise<unknown>;
}

export function connect(opts: {
  session?: NoiseSession;
  exchange?: (message1: Uint8Array) => Promise<Uint8Array>;
  localPrivate?: CryptoKey;
  localPublic?: Uint8Array;
  remotePublic?: Uint8Array;
  prologue?: Uint8Array;
}): Promise<Connection>;

export interface PairLink {
  pairBase: string;
  inviteCode: string;
  spaceFingerprint: string;
  address: string;
}

export function readPairLink(link: string): PairLink;
export function fingerprintOf(publicKey: Uint8Array): Promise<string>;

export interface PairResult {
  stack: "pair";
  kind: "invite" | "pair";
  pairBase: string;
  address: string;
  spaceFingerprint: string;
  devicePublic: Uint8Array;
  connection: Connection;
}

export interface PairOptions {
  inviteCode?: string;
  pairCode?: string;
  link?: string;
  spaceFingerprint?: string;
  pairBase?: string;
  address?: string;
  fetch?: (url: string, init: { method: string; headers?: Record<string, string>; body?: string }) => Promise<Response>;
  deviceKey?: DeviceKey;
  indexedDB?: IndexedDbLike | null;
  store?: "indexeddb" | "shell";
  invoke?: ShellInvoke;
}

export function pair(opts?: PairOptions): Promise<PairResult>;
export const serverPair: typeof pair;
export const setupPair: typeof pair;

export interface PairBroker {
  issueInvite(key: DeviceKey): Promise<{ code: string; fingerprint: string; kind: "invite" }>;
  issuePairCode(key: DeviceKey): Promise<{ code: string; fingerprint: string; kind: "pair" }>;
  responder(): NoiseSession | null;
  fetch(url: string, init: { method: string; body?: string }): Promise<Response>;
}

export function createPairBroker(): PairBroker;

export function generateSeed(count?: 12 | 24): Promise<string>;
export function entropyToWords(entropy: Uint8Array): Promise<string>;
export function wordsToEntropy(phrase: string): Promise<Uint8Array>;
export const WORDS: readonly string[];

export class PairError extends Error {
  name: "PairError";
}
export class NoiseError extends Error {
  name: "NoiseError";
}
export class SeedError extends Error {
  name: "SeedError";
}
export class RelayError extends Error {
  name: "RelayError";
}

export function hex(bytes: Uint8Array): string;
export function equal(a: Uint8Array, b: Uint8Array): boolean;
export function b64(bytes: Uint8Array): string;
export function fromB64(text: string): Uint8Array;
export function utf8(text: string): Uint8Array;
export function utf8Decode(bytes: Uint8Array): string;
