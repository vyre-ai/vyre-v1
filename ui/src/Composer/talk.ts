// Talk's engine: from a press to words. It knows nothing of React. A mic gives 16 kHz PCM and a level, the session names a socket, the provider (lib/talk.ts) reads its messages, and the composer gets the running words.
// It never sends and never holds a key: it holds a short-lived token for as long as the socket takes to open. Words are never logged. Every failure is one plain line, and what is already in the field stays.
import { TALK_SAMPLE_RATE, talkProvider } from "../../../lib/talk.ts";

export interface TalkSession { provider: string; url: string; protocols: string[]; source: "own" | "space"; expiresIn: number }
export interface TalkSocket {
  binaryType?: string;
  readyState: number;
  onopen: ((e: unknown) => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onclose: ((e: unknown) => void) | null;
  send(data: string | ArrayBuffer): void;
  close(): void;
}
export interface TalkMic { stop(): void }
export interface TalkDeps {
  session(): Promise<TalkSession>;
  openMic(on: (pcm: ArrayBuffer, level: number) => void): Promise<TalkMic>;
  openSocket(url: string, protocols: string[]): TalkSocket;
  online(): boolean;
  now(): number;
  later(fn: () => void, ms: number): unknown;
  /** Where the refused-mic line sends a person: this app's system settings, or the site's own permission. */
  shell: "mac" | "web";
}
export interface TalkEvents {
  /** Everything heard so far in this session, the part still being corrected last. */
  words(text: string): void;
  level(value: number): void;
  listening(): void;
  /** The session is over: its last words are in. */
  ended(): void;
  failed(line: string): void;
  /** No key covers this person: the sheet asks. */
  needsKey(): void;
  /** The server said Talk is off for this person. */
  off(line: string): void;
}
export interface TalkRun { stop(): void; cancel(): void }

export const LINE = {
  noMicApi: "This browser cannot reach a microphone here. Open Vyre at its https address.",
  noMic: "No microphone found. Plug one in and press the mic again.",
  micMac: "Vyre cannot hear you. Allow the microphone for Vyre in System Settings, Privacy and Security, Microphone.",
  micWeb: "Your browser blocked the microphone. Allow it for this site, then press the mic again.",
  network: "Talk needs the internet. What you typed is still here.",
  down: "The voice service is not answering. Try again in a moment.",
  dropped: "Talk lost its connection. Your words are still here.",
  generic: "Talk could not start. Try again.",
} as const;

const FINISH_MS = 2_000;
const BACKLOG_CHUNKS = 120;   // about ten seconds held while the socket opens
const OPEN = 1;

type ErrorLike = { code?: string; message?: string; details?: { reason?: string }; error?: { code?: string; message?: string; details?: { reason?: string } } };
const reasonOf = (e: unknown): string | undefined => (e as ErrorLike)?.details?.reason ?? (e as ErrorLike)?.error?.details?.reason;
const codeOf = (e: unknown): string => (e as ErrorLike)?.code ?? (e as ErrorLike)?.error?.code ?? "";
const messageOf = (e: unknown): string => (e as ErrorLike)?.message ?? (e as ErrorLike)?.error?.message ?? "";

/** The line for a refused session. A server refusal is already a plain sentence with no provider text in it. */
export function sessionLine(e: unknown, online: boolean): string {
  const code = codeOf(e);
  if (/^(provider|auth|validation)\./.test(code) && messageOf(e) !== "") return messageOf(e);
  return online ? LINE.generic : LINE.network;
}

export function micLine(e: unknown, shell: TalkDeps["shell"]): string {
  const name = (e as { name?: string })?.name ?? "";
  if (name === "NoMicApi") return LINE.noMicApi;
  if (name === "NotFoundError" || name === "OverconstrainedError") return LINE.noMic;
  return shell === "mac" ? LINE.micMac : LINE.micWeb;
}

/** What was heard: finished words in order, then the part still changing. */
export function joinWords(finals: readonly string[], interim: string): string {
  return [...finals, interim].filter((s) => s !== "").join(" ");
}

export function startTalk(deps: TalkDeps, ev: TalkEvents, opts: { warm: boolean }): TalkRun {
  let phase: "starting" | "open" | "closing" | "done" = "starting";
  let mic: TalkMic | null = null;
  let socket: TalkSocket | null = null;
  const backlog: ArrayBuffer[] = [];
  const finals: string[] = [];
  let interim = "";
  let closing: string | null = null;

  const onAudio = (pcm: ArrayBuffer, level: number): void => {
    if (phase === "closing" || phase === "done") return;
    ev.level(level);
    if (socket?.readyState === OPEN) socket.send(pcm);
    else if (backlog.length < BACKLOG_CHUNKS) backlog.push(pcm);
  };
  const quiet = (): void => {
    mic?.stop(); mic = null;
    ev.level(0);
  };
  const shut = (): void => {
    const s = socket; socket = null;
    if (s) { s.onopen = s.onmessage = s.onerror = s.onclose = null; try { s.close(); } catch { /* it is closing */ } }
  };
  const finish = (): void => {
    if (phase === "done") return;
    phase = "done";
    quiet(); shut();
    ev.ended();
  };
  const fail = (line: string): void => {
    if (phase === "done") return;
    phase = "done";
    quiet(); shut();
    ev.failed(line);
  };

  const openSocket = (info: TalkSession): void => {
    const provider = talkProvider(info.provider);
    if (!provider) { fail(LINE.generic); return; }
    closing = provider.closing;
    let s: TalkSocket;
    try { s = deps.openSocket(info.url, info.protocols); } catch { fail(LINE.down); return; }
    socket = s;
    s.binaryType = "arraybuffer";
    s.onopen = () => {
      if (phase === "done") return;
      for (const pcm of backlog.splice(0)) s.send(pcm);
      if (phase === "closing") { s.send(provider.closing); return; }
      phase = "open";
      ev.listening();
    };
    s.onmessage = (m) => {
      if (typeof m.data !== "string") return;
      const heard = provider.read(m.data);
      if (heard === null) return;
      if (heard.kind === "error") { fail(deps.online() ? LINE.down : LINE.network); return; }
      if (heard.final) { if (heard.text !== "") finals.push(heard.text); interim = ""; } else interim = heard.text;
      ev.words(joinWords(finals, interim));
    };
    s.onerror = () => { if (phase !== "closing") fail(deps.online() ? (phase === "open" ? LINE.dropped : LINE.down) : LINE.network); };
    s.onclose = () => {
      if (phase === "closing") { finish(); return; }
      fail(deps.online() ? (phase === "open" ? LINE.dropped : LINE.down) : LINE.network);
    };
  };

  const begin = async (): Promise<void> => {
    let micAsked: Promise<TalkMic> | null = null;
    // a key already known to work starts the mic at once, so the first word is not lost to the round trip; a first press learns what covers the person before any permission prompt
    if (opts.warm) micAsked = deps.openMic(onAudio);
    let info: TalkSession;
    try {
      info = await deps.session();
    } catch (e) {
      const reason = reasonOf(e);
      micAsked?.then((m) => m.stop(), () => undefined);
      phase = "done";
      if (reason === "no_key") ev.needsKey();
      else if (reason === "off") ev.off(messageOf(e));
      else ev.failed(sessionLine(e, deps.online()));
      return;
    }
    if ((phase as string) === "done") { micAsked?.then((m) => m.stop(), () => undefined); return; }
    const asked = deps.now();
    try { mic = await (micAsked ?? deps.openMic(onAudio)); }
    catch (e) { fail(micLine(e, deps.shell)); return; }
    if ((phase as string) === "done") { mic.stop(); mic = null; return; }
    // the permission prompt can outlast the token; a token needs to be good only as the socket opens
    if (deps.now() - asked > (info.expiresIn - 5) * 1000) {
      try { info = await deps.session(); } catch (e) { fail(sessionLine(e, deps.online())); return; }
    }
    openSocket(info);
  };
  void begin();

  return {
    stop() {
      if (phase === "done" || phase === "closing") return;
      phase = "closing";
      quiet();
      if (socket === null) { finish(); return; }
      deps.later(finish, FINISH_MS);
      if (socket.readyState === OPEN && closing !== null) socket.send(closing);
    },
    cancel() {
      if (phase === "done") return;
      phase = "done";
      quiet(); shut();
    },
  };
}

/* ---------- the web microphone ---------- */

/** 32-bit samples at the context's rate to 16-bit little-endian at 16 kHz, averaging what is dropped. */
export function toPcm16(input: ArrayLike<number>, fromRate: number, toRate = TALK_SAMPLE_RATE): ArrayBuffer {
  const ratio = Math.max(1, fromRate / toRate);
  const n = Math.floor(input.length / ratio);
  const out = new DataView(new ArrayBuffer(n * 2));
  for (let i = 0; i < n; i++) {
    const from = Math.floor(i * ratio), to = Math.max(from + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = from; j < to; j++) sum += input[j] ?? 0;
    const v = Math.max(-1, Math.min(1, sum / (to - from)));
    out.setInt16(i * 2, Math.round(v < 0 ? v * 32768 : v * 32767), true);
  }
  return out.buffer;
}

/** 0 to 1: speech sits well above the floor, a quiet room near it. */
export function levelOf(input: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < input.length; i++) sum += (input[i] ?? 0) ** 2;
  return Math.min(1, Math.sqrt(Math.sqrt(sum / Math.max(1, input.length))) * 1.6);
}

interface WebAudio {
  sampleRate: number;
  destination: unknown;
  resume(): Promise<void>;
  close(): Promise<void>;
  createMediaStreamSource(s: unknown): { connect(n: unknown): void; disconnect(): void };
  createScriptProcessor(size: number, inputs: number, outputs: number): { onaudioprocess: ((e: { inputBuffer: { getChannelData(c: number): Float32Array } }) => void) | null; connect(n: unknown): void; disconnect(): void };
}
interface WebGlobal {
  navigator?: { mediaDevices?: { getUserMedia?: (c: unknown) => Promise<{ getTracks(): { stop(): void }[] }> } };
  AudioContext?: new () => WebAudio;
  webkitAudioContext?: new () => WebAudio;
}

/**
 * The microphone through the page. ScriptProcessor, not an AudioWorklet: a worklet's module has to load from a script source and the desktop shell's CSP allows only 'self', and this runs the same in Safari, Chrome and WKWebView.
 * The context is made before the first await, inside the press, so Safari lets it run; a page with no mediaDevices is an insecure address.
 */
export async function openWebMic(on: (pcm: ArrayBuffer, level: number) => void, g: WebGlobal = globalThis as WebGlobal): Promise<TalkMic> {
  const Ctx = g.AudioContext ?? g.webkitAudioContext;
  const media = g.navigator?.mediaDevices;
  if (!Ctx || !media?.getUserMedia) throw Object.assign(new Error("no microphone here"), { name: "NoMicApi" });
  const audio = new Ctx();
  let stream: { getTracks(): { stop(): void }[] };
  try {
    stream = await media.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    await audio.resume();
  } catch (e) { void audio.close().catch(() => undefined); throw e; }
  const source = audio.createMediaStreamSource(stream);
  const proc = audio.createScriptProcessor(4096, 1, 1);
  proc.onaudioprocess = (e) => { const data = e.inputBuffer.getChannelData(0); on(toPcm16(data, audio.sampleRate), levelOf(data)); };
  source.connect(proc);
  proc.connect(audio.destination);   // a processor runs only when it reaches the output; it writes nothing, so nothing is heard
  return {
    stop() {
      proc.onaudioprocess = null;
      try { source.disconnect(); proc.disconnect(); } catch { /* already gone */ }
      for (const t of stream.getTracks()) t.stop();
      void audio.close().catch(() => undefined);
    },
  };
}
