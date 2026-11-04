// The ElevenLabs half of the Talk provider seam: the socket address, audio framing, the commit frame and what its messages mean.
import test from "node:test";
import assert from "node:assert/strict";
import { contextLine, talkProvider } from "./talk.ts";

const p = talkProvider("elevenlabs")!;

test("the socket address carries the model, the audio format and the token, and leaves the language out for Automatic", () => {
  const auto = p.socket({ model: "scribe_v2_realtime", language: "multi", token: "tkn" });
  assert.ok(auto.url.startsWith("wss://api.elevenlabs.io/v1/speech-to-text/realtime?"));
  assert.match(auto.url, /model_id=scribe_v2_realtime/);
  assert.match(auto.url, /audio_format=pcm_16000/);
  assert.match(auto.url, /token=tkn/);
  assert.doesNotMatch(auto.url, /language_code/);
  assert.deepEqual(auto.protocols, []);
  assert.match(p.socket({ model: "scribe_v2_realtime", language: "es", token: "t" }).url, /language_code=es/);
});

test("audio goes up as a base64 JSON frame and closing is a commit; raw bytes stay raw for Deepgram", () => {
  const pcm = new Uint8Array([1, 2, 3, 250]).buffer;
  assert.deepEqual(JSON.parse(p.frame(pcm) as string), { message_type: "input_audio_chunk", audio_base_64: "AQID+g==", commit: false, sample_rate: 16000 });
  assert.equal(JSON.parse(p.closing).commit, true);
  assert.equal(talkProvider("deepgram")!.frame(pcm), pcm);
});

test("partial and committed transcripts are words, an error kind is an error, anything else is nothing", () => {
  assert.deepEqual(p.read('{"message_type":"partial_transcript","text":"hel"}'), { kind: "words", text: "hel", final: false });
  assert.deepEqual(p.read('{"message_type":"committed_transcript","text":"hello"}'), { kind: "words", text: "hello", final: true });
  assert.deepEqual(p.read('{"message_type":"auth_error"}'), { kind: "error" });
  assert.equal(p.read('{"message_type":"session_started"}'), null);
  assert.equal(p.read("nope"), null);
});

test("boosted words: trimmed, listed once, product first, kept short; Nova 3 takes keyterm, Nova 2 keywords, ElevenLabs keyterms", async () => {
  const { boostTerms } = await import("./talk.ts");
  const terms = boostTerms({ product: "Vyre", space: " Hart & Reyes ", agents: ["Intake", "vyre"], people: ["Maya Chen", "A", "x".repeat(60), "Dana, Wine"] });
  assert.deepEqual(terms, ["Vyre", "Hart Reyes", "Intake", "Maya Chen", "Dana Wine"]);
  assert.equal(boostTerms({ product: "Vyre", people: Array.from({ length: 100 }, (_, i) => `Person ${i}`) }).length, 40);
  const dg = talkProvider("deepgram")!;
  assert.deepEqual(new URL(dg.socket({ model: "nova-3", language: "en", token: "t", terms: ["Vyre", "Maya Chen"] }).url).searchParams.getAll("keyterm"), ["Vyre", "Maya Chen"]);
  assert.deepEqual(new URL(dg.socket({ model: "nova-2", language: "en", token: "t", terms: ["Vyre"] }).url).searchParams.getAll("keywords"), ["Vyre:2"]);
  const eleven = p.socket({ model: "scribe_v2_realtime", language: "en", token: "t", terms: ["Vyre", "Maya Chen"] });
  assert.deepEqual(new URL(eleven.url).searchParams.getAll("keyterms"), ['["Vyre","Maya Chen"]'], "one JSON array, not a repeated parameter");
  assert.equal(eleven.context, "Words that may come up: Vyre, Maya Chen.");
  assert.equal(p.socket({ model: "scribe_v2_realtime", language: "en", token: "t" }).context, undefined);
  assert.equal(dg.socket({ model: "nova-3", language: "en", token: "t", terms: ["Vyre"] }).context, undefined, "Deepgram has no context line");
});

test("the context line goes on the first audio chunk only, and only ElevenLabs frames it", () => {
  const pcm = new Uint8Array([1, 2]).buffer;
  const first = JSON.parse(p.frame(pcm, { first: true, context: "Vyre." }) as string);
  const second = JSON.parse(p.frame(pcm, { first: false, context: "Vyre." }) as string);
  assert.equal(first.previous_text, "Vyre.");
  // the exact shape the live variants test sent (and that got "Vyre voice"): the audio frame with previous_text added last
  const plain = JSON.parse(p.frame(pcm) as string);
  assert.equal(p.frame(pcm, { first: true, context: contextLine(["Vyre"]) }), JSON.stringify({ ...plain, previous_text: "Words that may come up: Vyre." }));
  assert.deepEqual(Object.keys(JSON.parse(p.frame(pcm, { first: true, context: "x" }) as string)), ["message_type", "audio_base_64", "commit", "sample_rate", "previous_text"]);
  assert.equal("previous_text" in second, false);
  assert.equal("previous_text" in JSON.parse(p.frame(pcm, { first: true }) as string), false, "no context, no field");
  assert.equal(talkProvider("deepgram")!.frame(pcm, { first: true, context: "Vyre." }), pcm, "Deepgram audio stays raw bytes");
});
