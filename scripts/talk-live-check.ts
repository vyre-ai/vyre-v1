// Live check of Talk against the real providers. Run on a build box with the keys in the environment:
//   DEEPGRAM_API_KEY=... ELEVENLABS_API_KEY=... node --import tsx scripts/talk-live-check.ts [deepgram|elevenlabs ...]
// For each provider whose key is set it does what Check now does (the host's grant with a one second life, through the real createTalkHost), then mints a token the way a session does, opens the
// socket the way the page does and sends a 2 second spoken WAV (scripts/fixtures/talk-hello.wav, 16 kHz mono) in real time, then prints the words that came back. A key is read from the environment and
// never printed or written. With `--variants` ElevenLabs is run once per way of passing the boosted words (the docs do not say how a query array is written) and each prints what it heard. Exit 1 if a provider that has a key fails.
import { readFileSync } from "node:fs";
import { createTalkHost } from "../host/src/seams/talk.ts";
import { TALK_SAMPLE_RATE, boostTerms, talkProvider } from "../lib/talk.ts";

const ENV: Record<string, string> = { deepgram: "DEEPGRAM_API_KEY", elevenlabs: "ELEVENLABS_API_KEY" };
const ctx = { space: "spc_live", trace: { traceId: "0".repeat(32) } };

function pcmOf(path: string): Uint8Array {
  const b = readFileSync(path);
  let at = 12;
  while (at + 8 <= b.length) {
    const id = b.toString("ascii", at, at + 4), size = b.readUInt32LE(at + 4);
    if (id === "data") return new Uint8Array(b.subarray(at + 8, at + 8 + size));
    at += 8 + size + (size % 2);
  }
  throw new Error("no data chunk in the WAV");
}
const message = (e: unknown): string => { const x = e as { error?: { code?: string; message?: string } }; return x?.error ? `${x.error.code}: ${x.error.message}` : String((e as Error)?.message ?? e); };

/** ElevenLabs: the ways to hand the model its words, to find the one that works. */
const VARIANTS: Record<string, (url: URL, terms: string[]) => { url: URL; previousText?: string; noContext?: boolean }> = {
  provider: (u) => ({ url: u }),
  repeated: (u, t) => { u.searchParams.delete("keyterms"); for (const x of t) u.searchParams.append("keyterms", x); return { url: u, noContext: true }; },
  json: (u, t) => { u.searchParams.delete("keyterms"); u.searchParams.set("keyterms", JSON.stringify(t)); return { url: u }; },
  comma: (u, t) => { u.searchParams.delete("keyterms"); u.searchParams.set("keyterms", t.join(",")); return { url: u }; },
  bracket: (u, t) => { u.searchParams.delete("keyterms"); for (const x of t) u.searchParams.append("keyterms[]", x); return { url: u }; },
  previous_text: (u, t) => { u.searchParams.delete("keyterms"); return { url: u, previousText: `Words that may come up: ${t.join(", ")}.` }; },
  both: (u, t) => ({ url: u, previousText: `Words that may come up: ${t.join(", ")}.` }),
  none: (u) => { u.searchParams.delete("keyterms"); return { url: u }; },
};

async function one(name: string, key: string, variant = "provider"): Promise<boolean> {
  const p = talkProvider(name)!;
  const host = createTalkHost({ vault: { secret: async () => key }, fetch: async (url, init) => { const r = await fetch(url, init as RequestInit); return { status: r.status, text: () => r.text(), arrayBuffer: () => r.arrayBuffer() }; } });
  const t0 = Date.now();
  try { await host.mint(ctx, { provider: name, handle: "#live.api_key", own: false, ttl: 1 }); console.log(`${name}: check ok (${Date.now() - t0} ms)`); }
  catch (e) { console.log(`${name}: check FAILED ${message(e)}`); return false; }
  let minted: { token: string };
  try { minted = await host.mint(ctx, { provider: name, handle: "#live.api_key", own: false }); }
  catch (e) { console.log(`${name}: token FAILED ${message(e)}`); return false; }
  const terms = boostTerms({ product: "Vyre" });
  const sock = p.socket({ model: p.defaultModel, language: "en", token: minted.token, terms });
  const shaped = name === "elevenlabs" ? VARIANTS[variant]!(new URL(sock.url), terms) : { url: new URL(sock.url) };
  const ws = new WebSocket(shaped.url.toString(), sock.protocols);
  let first = true;
  ws.binaryType = "arraybuffer";
  const finals: string[] = [];
  let interim = "", errored = false;
  const opened = new Promise<void>((res, rej) => { ws.onopen = () => res(); ws.onerror = () => rej(new Error("the socket would not open")); });
  ws.onmessage = (m) => {
    if (typeof m.data !== "string") return;
    const heard = p.read(m.data);
    if (!heard) return;
    if (heard.kind === "error") { errored = true; return; }
    if (heard.final) { if (heard.text) finals.push(heard.text); interim = ""; } else interim = heard.text;
  };
  try { await opened; } catch (e) { console.log(`${name}: socket FAILED ${message(e)}`); return false; }
  const pcm = pcmOf(new URL("./fixtures/talk-hello.wav", import.meta.url).pathname);
  const chunk = TALK_SAMPLE_RATE / 10 * 2;   // 100 ms of 16 bit mono
  for (let i = 0; i < pcm.length; i += chunk) {
    const part = pcm.slice(i, i + chunk);
    const own = "previousText" in shaped || "noContext" in shaped;   // a variant sets its own context; the default is what the session gives the page
    const frame = p.frame(part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength), { first, context: own ? undefined : sock.context });
    if (first && typeof frame === "string" && "previousText" in shaped && shaped.previousText) ws.send(JSON.stringify({ ...JSON.parse(frame), previous_text: shaped.previousText })); else ws.send(frame);
    first = false;
    await new Promise((r) => setTimeout(r, 100));
  }
  ws.send(p.closing);
  await new Promise((r) => setTimeout(r, 4000));
  ws.close();
  const words = [...finals, interim].join(" ").trim();
  console.log(`${name}${name === "elevenlabs" ? ` [${variant}]` : ""}: heard ${JSON.stringify(words)}${errored ? " (the provider reported an error)" : ""}`);
  return words !== "" && !errored;
}

const variants = process.argv.includes("--variants");
const want = process.argv.slice(2).filter((a) => ENV[a]);
const names = want.length > 0 ? want : Object.keys(ENV);
let bad = 0, ran = 0;
for (const name of names) {
  const key = process.env[ENV[name]!]?.trim();
  if (!key) { console.log(`${name}: skipped, ${ENV[name]} is not set`); continue; }
  ran += 1;
  if (variants && name === "elevenlabs") { for (const v of Object.keys(VARIANTS)) await one(name, key, v); continue; }
  if (!(await one(name, key))) bad += 1;
}
console.log(ran === 0 ? "nothing ran" : bad === 0 ? "all good" : `${bad} failed`);
process.exit(ran === 0 || bad > 0 ? 1 : 0);
