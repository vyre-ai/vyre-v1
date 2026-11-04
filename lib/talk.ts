// Talk: speak, and the words land in the composer. This file is the one provider seam: one object per provider says how to check a key, how to mint a short-lived token and how to open and read the
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
  socket(s: { model: string; language: string; token: string }): { url: string; protocols: string[] };
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
  socket({ model, language, token }) {
    const q = new URLSearchParams({ model, language, encoding: "linear16", sample_rate: String(TALK_SAMPLE_RATE), channels: "1", interim_results: "true", smart_format: "true", endpointing: "300" });
    // a browser socket cannot set a header: Deepgram reads the JWT from the subprotocol pair
    return { url: `wss://api.deepgram.com/v1/listen?${q.toString()}`, protocols: ["bearer", token] };
  },
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

export const TALK_PROVIDERS: readonly TalkProvider[] = [DEEPGRAM];
export const DEFAULT_TALK_PROVIDER = DEEPGRAM.key;
export const talkProvider = (key: string): TalkProvider | undefined => TALK_PROVIDERS.find((p) => p.key === key);
