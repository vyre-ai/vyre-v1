// Talk: speak, and the words land in the composer. Deepgram and ElevenLabs. This file is the one provider seam: one object per provider says how to check a key, how to mint a short-lived token and how to open and read the
// live socket. It holds no network and no key; the host seam (host/src/seams/talk.ts) runs the grant, the module picks the provider, the client opens the socket. A new provider is one more object here.
// DECISION: the host mints a Deepgram temporary token and the page opens the socket to Deepgram itself. The long-lived key never reaches a browser and no audio passes through the Space. A token has to be
// valid only while the socket opens (Deepgram documents this), so 30 seconds is plenty. It carries usage::write on the core voice APIs and nothing on the Manage APIs.
// DECISION: audio is 16 kHz mono linear16 from the page, not a MediaRecorder container: Safari records fragmented mp4, Chrome webm, and raw PCM is the one form every webview can make the same way.
// The key needs the Member role or higher: /v1/auth/grant answers 403 for a lesser key, so the check at setup is the same call Talk makes every time.

export const TALK_SAMPLE_RATE = 16_000;
export const TOKEN_SECONDS = 30;

export interface TalkChoice { id: string; label: string }
export type GrantFailure = "key" | "role" | "busy" | "down";
export type GrantResult = { ok: true; token: string; expiresIn: number } | { ok: false; why: GrantFailure };
/** What a socket message means to the composer. The text is the person's words: it never goes to a log. */
export type TalkHeard = { kind: "words"; text: string; final: boolean } | { kind: "error" } | null;

export interface TalkProvider {
  key: string;
  name: string;
  /** Where a person gets a key. */
  keyUrl: string;
  /** The Vault item's name for a person's own key, and for the Space's. */
  keyName: string;
  spaceKeyName: string;
  /** The field of the item that holds the key. */
  keyField: string;
  models: readonly TalkChoice[];
  languages: readonly TalkChoice[];
  defaultModel: string;
  defaultLanguage: string;
  grant(apiKey: string, ttlSeconds: number): { url: string; method: string; headers: Record<string, string>; body: string };
  readGrant(status: number, body: string): GrantResult;
  /** `terms` are words the provider should favour: the product, the Space, its people and agents. Each provider passes them its own way, or ignores them. */
  socket(s: { model: string; language: string; token: string; terms?: readonly string[] }): { url: string; protocols: string[] };
  /** One chunk of microphone audio as the socket wants it: Deepgram takes the raw bytes, ElevenLabs a JSON text frame. */
  frame(pcm: ArrayBuffer): string | ArrayBuffer;
  /** The text frame that asks the provider for what it still holds, then to close. */
  closing: string;
  read(message: string): TalkHeard;
}

const DEEPGRAM: TalkProvider = {
  key: "deepgram",
  name: "Deepgram",
  keyUrl: "https://console.deepgram.com/",
  keyName: "Deepgram",
  spaceKeyName: "Deepgram for this Space",
  keyField: "api_key",
  // nova-3 is the model Deepgram names for live transcription; Flux is for voice agents that need turn detection, which Talk does not
  models: [{ id: "nova-3", label: "Nova 3" }, { id: "nova-2", label: "Nova 2" }],
  languages: [
    { id: "multi", label: "Automatic" }, { id: "en", label: "English" }, { id: "es", label: "Spanish" }, { id: "fr", label: "French" }, { id: "de", label: "German" }, { id: "it", label: "Italian" },
    { id: "pt", label: "Portuguese" }, { id: "nl", label: "Dutch" }, { id: "hi", label: "Hindi" }, { id: "ur", label: "Urdu" }, { id: "ar", label: "Arabic" }, { id: "ru", label: "Russian" },
    { id: "ja", label: "Japanese" }, { id: "ko", label: "Korean" },
  ],
  defaultModel: "nova-3",
  defaultLanguage: "multi",
  grant: (apiKey, ttlSeconds) => ({
    url: "https://api.deepgram.com/v1/auth/grant", method: "POST", headers: { authorization: `Token ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ ttl_seconds: ttlSeconds }),
  }),
  readGrant(status, body) {
    // a wrong or revoked key answers 400 "Invalid credentials" (seen live), not 401
    if (status === 400 || status === 401) return { ok: false, why: "key" };
    if (status === 403) return { ok: false, why: "role" };
    if (status === 429) return { ok: false, why: "busy" };
    if (status < 200 || status >= 300) return { ok: false, why: "down" };
    try {
      const j = JSON.parse(body) as { access_token?: unknown; expires_in?: unknown };
      if (typeof j.access_token !== "string" || j.access_token === "") return { ok: false, why: "down" };
      return { ok: true, token: j.access_token, expiresIn: typeof j.expires_in === "number" ? j.expires_in : TOKEN_SECONDS };
    } catch { return { ok: false, why: "down" }; }
  },
  socket({ model, language, token, terms = [] }) {
    const q = new URLSearchParams({ model, language, encoding: "linear16", sample_rate: String(TALK_SAMPLE_RATE), channels: "1", interim_results: "true", smart_format: "true", endpointing: "300" });
    // Nova 3 takes plain keyterms (one parameter each); Nova 2 takes keywords with an intensifier
    for (const term of terms) q.append(model.startsWith("nova-3") ? "keyterm" : "keywords", model.startsWith("nova-3") ? term : `${term}:2`);
    // a browser socket cannot set a header: Deepgram reads the JWT from the subprotocol pair
    return { url: `wss://api.deepgram.com/v1/listen?${q.toString()}`, protocols: ["bearer", token] };
  },
  frame: (pcm) => pcm,
  closing: JSON.stringify({ type: "CloseStream" }),
  read(message) {
    let j: { type?: unknown; is_final?: unknown; channel?: { alternatives?: { transcript?: unknown }[] } };
    try { j = JSON.parse(message) as typeof j; } catch { return null; }
    if (j.type === "Error") return { kind: "error" };
    if (j.type !== "Results") return null;
    const text = j.channel?.alternatives?.[0]?.transcript;
    return typeof text === "string" ? { kind: "words", text, final: j.is_final === true } : null;
  },
};

const base64 = (pcm: ArrayBuffer): string => {
  const b = new Uint8Array(pcm);
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const eleven = (audio: string, commit: boolean): string => JSON.stringify({ message_type: "input_audio_chunk", audio_base_64: audio, commit, sample_rate: TALK_SAMPLE_RATE });

// DECISION: ElevenLabs Scribe v2 Realtime. The host swaps the key for a single-use token (valid for one socket, 15 minutes to start it); the page opens the socket with the token in the address,
// because a browser cannot send a header and ElevenLabs has no subprotocol form. The token is not the key and works once. Audio goes up as base64 JSON frames, and a commit frame asks for what it still holds.
const ELEVENLABS: TalkProvider = {
  key: "elevenlabs",
  name: "ElevenLabs",
  keyUrl: "https://elevenlabs.io/app/settings/api-keys",
  keyName: "ElevenLabs",
  spaceKeyName: "ElevenLabs for this Space",
  keyField: "api_key",
  models: [{ id: "scribe_v2_realtime", label: "Scribe v2 Realtime" }],
  languages: DEEPGRAM.languages,
  defaultModel: "scribe_v2_realtime",
  defaultLanguage: "multi",
  grant: (apiKey) => ({ url: "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe", method: "POST", headers: { "xi-api-key": apiKey }, body: "" }),
  readGrant(status, body) {
    if (status === 401) return { ok: false, why: "key" };
    if (status === 403) return { ok: false, why: "role" };
    if (status === 429) return { ok: false, why: "busy" };
    if (status < 200 || status >= 300) return { ok: false, why: "down" };
    try {
      const j = JSON.parse(body) as { token?: unknown };
      if (typeof j.token !== "string" || j.token === "") return { ok: false, why: "down" };
      return { ok: true, token: j.token, expiresIn: 900 };
    } catch { return { ok: false, why: "down" }; }
  },
  socket({ model, language, token, terms = [] }) {
    const q = new URLSearchParams({ model_id: model, token, audio_format: "pcm_16000", commit_strategy: "vad", include_timestamps: "false" });
    for (const term of terms) q.append("keyterms", term);
    if (language !== "multi") q.set("language_code", language);
    return { url: `wss://api.elevenlabs.io/v1/speech-to-text/realtime?${q.toString()}`, protocols: [] };
  },
  frame: (pcm) => eleven(base64(pcm), false),
  closing: eleven("", true),
  read(message) {
    let j: { message_type?: unknown; text?: unknown };
    try { j = JSON.parse(message) as typeof j; } catch { return null; }
    const kind = j.message_type;
    if (typeof kind === "string" && /error|exceeded|rate_limited|unaccepted|auth_error|quota|invalid/i.test(kind)) return { kind: "error" };
    if ((kind === "partial_transcript" || kind === "committed_transcript") && typeof j.text === "string") return { kind: "words", text: j.text, final: kind === "committed_transcript" };
    return null;
  },
};

const MAX_TERMS = 40;
const MAX_TERM_CHARS = 40;
const MAX_TOTAL_CHARS = 600;
/** The words worth favouring, in order of use: the product first, then the Space, its agents and its people. Each is trimmed, kept to one line, and listed once; the list stays short (a provider caps what it takes). */
export function boostTerms(groups: { product: string; space?: string | undefined; agents?: readonly string[]; people?: readonly string[] }): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let total = 0;
  const add = (raw: string | undefined): void => {
    const term = (raw ?? "").replace(/[,;:&=#?]/g, "").replace(/\s+/g, " ").trim();
    if (term.length < 2 || term.length > MAX_TERM_CHARS || out.length >= MAX_TERMS || total + term.length > MAX_TOTAL_CHARS) return;
    const key = term.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key); out.push(term); total += term.length;
  };
  add(groups.product); add(groups.space);
  for (const a of groups.agents ?? []) add(a);
  for (const p of groups.people ?? []) add(p);
  return out;
}

export const TALK_PROVIDERS: readonly TalkProvider[] = [DEEPGRAM, ELEVENLABS];
export const DEFAULT_TALK_PROVIDER = DEEPGRAM.key;
export const talkProvider = (key: string): TalkProvider | undefined => TALK_PROVIDERS.find((p) => p.key === key);
