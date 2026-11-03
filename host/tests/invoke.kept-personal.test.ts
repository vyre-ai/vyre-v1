// The answer idempotency keeps for a repeated memory write never holds a person's own memory in words (owner ruling 3 Nov 2026): it is sealed under their key, events.db is not.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { withoutPersonalWords } from "../src/invoke.ts";
import { LogClient } from "../../kernel/src/log/index.ts";

test("person-layer words are blanked in the kept copy; shared words, ids and shapes stay", () => {
  const out = {
    fact: { factId: "fct_1", layer: "person", text: "Dana is allergic to cashews", status: "current" },
    shared: { factId: "fct_2", layer: "space", text: "Invoices go out on Monday" },
    hits: [{ factId: "fct_3", layer: "person", text: "Dana's PIN hint", title: "Fact" }],
    page: { pageId: "pag_1", layer: "person", title: "Dana's health" }, notes: "Sees Dr Shah",
  };
  assert.deepEqual(withoutPersonalWords(out), {
    fact: { factId: "fct_1", layer: "person", text: "", status: "current" },
    shared: { factId: "fct_2", layer: "space", text: "Invoices go out on Monday" },
    hits: [{ factId: "fct_3", layer: "person", text: "", title: "" }],
    page: { pageId: "pag_1", layer: "person", title: "" }, notes: "",
  });
  assert.equal(out.fact.text, "Dana is allergic to cashews", "the caller's own answer is untouched");
});

test("idempotency stores what `keep` gives and still answers the first caller in full", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-kept-"));
  const log = await LogClient.open({ path: path.join(dir, "events.db"), space: "sp_1" });
  try {
    const idem = log.idempotency();
    const run = async () => ({ fact: { factId: "fct_1", layer: "person", text: "Dana is allergic to cashews" } });
    const first = await idem.once("usr_dana", "memory.propose_fact", "k1", { text: "x" }, run, withoutPersonalWords);
    assert.equal(first.fact.text, "Dana is allergic to cashews");
    const again = await idem.once("usr_dana", "memory.propose_fact", "k1", { text: "x" }, run, withoutPersonalWords);
    assert.equal(again.fact.text, "", "a repeat gets the kept copy");
    await log.flush();
  } finally { await log.close(); }
  assert.ok(!fs.readdirSync(dir).some((f) => fs.readFileSync(path.join(dir, f)).includes(Buffer.from("cashews"))), "the words are in no file");
  fs.rmSync(dir, { recursive: true, force: true });
});
