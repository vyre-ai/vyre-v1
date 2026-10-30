// The local embedding model run from Node: the tokenizer, the pooling and the states a search sees while it loads, when it is ready and when it fails. The ONNX runtime and the model files are stand-ins here;
// the real model was run once by hand and is described in the pull request.
import test from "node:test";
import assert from "node:assert/strict";
import { basicWords, createLocalEmbedder, encode, vocabOf, wordpiece } from "../local-embedder.ts";
import type { ModelFiles, OrtLike } from "../local-embedder.ts";

const VOCAB = ["[PAD]", "[UNK]", "[CLS]", "[SEP]", "bank", "rec", "##on", "##cil", "##iation", "the", "chase", "feed", ",", "didn", "'", "t", "match"];
const tokenizerJson = JSON.stringify({ model: { vocab: Object.fromEntries(VOCAB.map((t, i) => [t, i])) } });
const vocab = vocabOf(tokenizerJson);
test("the tokenizer lowercases, strips accents, splits punctuation and cuts words into pieces", () => {
  assert.deepEqual(basicWords("The Chase feed, didn't match"), ["the", "chase", "feed", ",", "didn", "'", "t", "match"]);
  assert.deepEqual(basicWords("Café  BANK"), ["cafe", "bank"]);
  assert.deepEqual(wordpiece("reconciliation", vocab).length, 4, "rec + ##on + ##cil + ##iation");
  assert.deepEqual(wordpiece("xyzzy", vocab), [vocab.unk]);
  assert.deepEqual(encode("the bank", vocab), [vocab.cls, 9, 4, vocab.sep]);
  const long = encode("bank ".repeat(500), vocab, 16);
  assert.equal(long.length, 16);
  assert.equal(long.at(-1), vocab.sep, "a cut text still ends in [SEP]");
});

/** A runtime whose hidden state for a token is a one-hot of its id modulo 8, so a pooled vector tells which tokens were in the text. */
function fakeOrt(): OrtLike & { sessions: number } {
  const ort = {
    sessions: 0,
    InferenceSession: { async create() { ort.sessions++; return { async run(feeds: Record<string, { data: unknown; dims: readonly number[] }>) {
      const ids = feeds["input_ids"]!.data as BigInt64Array;
      const [B, T] = feeds["input_ids"]!.dims as [number, number];
      const out = new Float32Array(B * T * 384);
      for (let i = 0; i < B * T; i++) out[i * 384 + Number(ids[i]! % 8n)] = 1;
      return { last_hidden_state: { data: out, dims: [B, T, 384] } };
    } }; } },
    Tensor: class { type: string; data: BigInt64Array; dims: number[]; constructor(type: string, data: BigInt64Array, dims: number[]) { this.type = type; this.data = data; this.dims = dims; } },
  };
  return ort as unknown as OrtLike & { sessions: number };
}


const files = (fail: () => boolean = () => false): ModelFiles & { loads: number } => {
  const f = { name: "stand-in@1", loads: 0, async load() { f.loads++; if (fail()) throw new Error("offline"); return { model: new Uint8Array([1]), tokenizer: tokenizerJson }; } };
  return f;
};
const settle = async (e: { status(): { state: string } }, want: string): Promise<void> => { for (let i = 0; i < 100 && e.status().state !== want; i++) await new Promise<void>((r) => setTimeout(r, 5)); };

test("the embedder is not set up until first used, then loading, then ready; its vectors are unit length and a blank text is a zero vector", async () => {
  {
    const mf = files();
    const ort = fakeOrt();
    const e = createLocalEmbedder({ files: mf, ort: async () => ort, threads: 1 });
    assert.equal(e.dim, 384);
    assert.equal(e.name, "stand-in@1");
    assert.equal(mf.loads, 0, "nothing is loaded until the model is used");
    assert.equal(e.status().state, "loading", "asking for the status is the first use: it starts the load");
    await assert.rejects(() => e.embed(["bank"]), /not ready/);
    await settle(e, "ready");
    assert.equal(e.status().state, "ready");
    assert.equal(ort.sessions, 1);
    const [a, blank, b] = await e.embed(["the bank", "   ", "the bank"]);
    assert.ok(Math.abs(Math.hypot(...a!) - 1) < 1e-5, "unit length");
    assert.deepEqual([...blank!].every((x) => x === 0), true);
    assert.deepEqual([...a!], [...b!], "the same text, the same vector");
  }
});

test("a failed load says so in plain words, is not retried at once, and is retried after ten minutes", async () => {
  const clock = { t: 1_000 };
  let fail = true;
  const e = createLocalEmbedder({ files: files(() => fail), ort: async () => fakeOrt(), now: () => clock.t });
  e.status();
  await settle(e, "failed");
  const st = e.status();
  assert.equal(st.state, "failed");
  assert.match(st.detail ?? "", /keyword search is in use/);
  fail = false;
  clock.t += 9 * 60_000;
  assert.equal(e.status().state, "failed", "not yet");
  clock.t += 2 * 60_000;
  assert.equal(e.status().state, "loading", "ten minutes on, it tries again");
  await settle(e, "ready");
  assert.equal(e.status().state, "ready");
});
