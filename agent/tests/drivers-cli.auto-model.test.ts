// Model "Auto" on a CLI engine passes no model flag at all: the engine uses its own default. A fresh install's first "hello" on Codex (a ChatGPT sign-in, on this computer) was refused with `model` must be
// a non-empty string: an empty or meaningless name must never become `-m ""`, `-m auto` or `--model ""`. The exact command line is checked for each engine, for every way Auto is spelled, and a model that
// was picked is passed exactly as picked.
import test from "node:test";
import assert from "node:assert/strict";
import { CLI_ADAPTERS, cliModel, createCliDriver } from "../src/drivers/cli/index.ts";
import { driverDeps, newSpy, specOf, turnOf } from "../fixtures/golden-streams/rig.ts";

const FLAG = { claude_code: "--model", codex: "-m", grok: "-m" } as const;
/** The rig's agent has a model of its own; a chat on Auto has none, or one of the ways Auto is written. */
const withModel = (model: string | undefined) => { const { model: _own, ...rest } = specOf().agent; return { ...specOf(), agent: { ...rest, ...(model === undefined ? {} : { model }) } }; };
/** Opens a session on the engine, sends one turn so the process is started, and gives back the command line it was started with. */
async function started(driver: keyof typeof FLAG, model: string | undefined): Promise<string[]> {
  const spy = newSpy();
  const session = await createCliDriver(CLI_ADAPTERS[driver], driverDeps(spy)).open(withModel(model));
  const turn = turnOf("hello");
  try { for await (const _e of session.send({ ...turn, agent: { ...turn.agent, ...withModel(model).agent } })) void _e; } catch { /* the stand-in may end the stream its own way: the command line is what is checked */ }
  await session.close();
  assert.ok(spy.launches.length > 0, `${driver}: a process was started`);
  return spy.launches[0]!;
}
const AUTO_SPELLINGS: Array<string | undefined> = [undefined, "", "  ", "auto", "Auto", "codex/", "claude_code/", "grok/", "codex/auto"];

test("cliModel: Auto in any spelling is no model; a name loses its engine prefix and nothing else", () => {
  for (const m of AUTO_SPELLINGS) assert.equal(cliModel(m), null, JSON.stringify(m));
  assert.equal(cliModel("codex/gpt-6.1-sol"), "gpt-6.1-sol");
  assert.equal(cliModel("claude-sonnet-5-5"), "claude-sonnet-5-5");
  assert.equal(cliModel("grok/grok-4.6"), "grok-4.6");
});

for (const driver of ["claude_code", "codex", "grok"] as const) {
  test(`${driver} on Auto: the command line has no model flag and no empty argument; a picked model is passed once, exactly`, async () => {
    for (const model of AUTO_SPELLINGS) {
      const argv = await started(driver, model);
      assert.equal(argv.includes(FLAG[driver]), false, `${driver} with ${JSON.stringify(model)}: no ${FLAG[driver]} in ${JSON.stringify(argv)}`);
      assert.equal(argv.includes("--model"), false);
      assert.equal(argv.some((a, i) => a === "" && (argv[i - 1] === "-m" || argv[i - 1] === "--model")), false, "no empty model value");
    }
    const argv = await started(driver, `${driver}/model-x`);
    assert.deepEqual(argv.filter((a, i) => argv[i - 1] === FLAG[driver]), ["model-x"], "the picked model, once, without its prefix");
  });
}
