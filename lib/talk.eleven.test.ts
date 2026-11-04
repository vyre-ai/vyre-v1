// The ElevenLabs half of the Talk provider seam: the socket address, audio framing, the commit frame and what its messages mean.
import test from "node:test";
import assert from "node:assert/strict";
import { talkProvider } from "./talk.ts";

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
