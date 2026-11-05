import test from "node:test";
import assert from "node:assert/strict";
import { accountName, modelName } from "./model-names.ts";

test("a model reads as a person says it, never as the vendor's slug", () => {
  assert.equal(modelName("claude-opus-5-5"), "Opus 5.5");
  assert.equal(modelName("claude-fable-5-1"), "Fable 5.1");
  assert.equal(modelName("claude-sonnet-5-5"), "Sonnet 5.5");
  assert.equal(modelName("claude-haiku-5-5"), "Haiku 5.5");
  assert.equal(modelName("gpt-6"), "GPT-6");
  assert.equal(modelName("gpt-5-codex"), "GPT-5 Codex");
  assert.equal(modelName("glm-5.3-flash"), "GLM 5.3 Flash");
  assert.equal(modelName("deepseek-v4.1-flash"), "DeepSeek V4.1 Flash");
  assert.equal(modelName("some-new_model"), "Some New Model");
  assert.equal(modelName(undefined), "");
  for (const slug of ["claude-opus-5-5", "claude-fable-5-1", "gpt-6", "glm-5.3", "deepseek-v4.1-flash"]) assert.doesNotMatch(modelName(slug), /claude|opus-|fable-|glm-|deepseek-/i, slug);
});

test("an account reads as its name: no engine, no handle underscores", () => {
  assert.equal(accountName("claude-code · Maya_Claude"), "Maya Claude");
  assert.equal(accountName("OpenAI · irfad@mylegalacademy.com"), "irfad@mylegalacademy.com");
  assert.equal(accountName("#Space_OCG"), "Space OCG");
  assert.equal(accountName("OpenCode Go · Space"), "Space");
  assert.equal(accountName(undefined), "");
});
