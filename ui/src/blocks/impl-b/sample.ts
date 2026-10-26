// Sample blocks for part two: the data shapes in generated/registry.json blocks[].data, with ids that match the registry patterns.
// Tests and the screenshot mount use these; nothing in the app imports this file.

import type { Block, BlockState } from "../../kit/types.ts";

function block(type: string, id: string, data: unknown, state: BlockState = "done"): Block {
  return { type, v: 1, id, data, state, traceId: `tr_${type}_${id}` };
}

export const SAMPLE_MEMORY = block("memory_saved", "blk_mem1", {
  factId: "fct_a1b2c3",
  layer: "person",
  agentId: "agt_a1b2c3",
  text: "Elena prefers the afternoon consult slot.",
  canPromote: true,
});

export const SAMPLE_VAULT_USED = block("vault_used", "blk_vlt1", {
  itemId: "vit_a1b2c3",
  name: "TWILIO_KEY",
  handle: "#Intake_Twilio.api_key",
  fields: ["api_key"],
  outcome: "used",
  where: "computer",
});

export const SAMPLE_ACCESS_REQUEST = block("access_request", "blk_acc1", {
  requestId: "arq_a1b2c3",
  requester: "usr_a1b2c3",
  resource: { type: "folder", id: "fld_a1b2c3" },
  resourceTitle: "Clients",
  level: "edit",
  note: "I need to attach the signed engagement letters.",
  state: "waiting",
});

export const SAMPLE_SECRET_INPUT = block(
  "secret_input",
  "blk_sec1",
  {
    name: "Lawmatics",
    kind: "api_key",
    folderId: "vfd_a1b2c3",
    fields: ["api_key"],
    hint: "Settings, then API, then Create key.",
  },
  "waiting",
);

export const SAMPLE_MODEL_SWITCH = block("model_switch", "blk_mdl1", {
  threadId: "thr_a1b2c3",
  agentId: "agt_a1b2c3",
  scope: "sub_task",
  from: { provider: "anthropic", model: "Sonnet", effort: "Medium" },
  to: { provider: "anthropic", model: "Haiku", effort: "Low" },
  reason: "Check the bounce list for Elena's address",
});

export const SAMPLE_HELPER = block("helper", "blk_hlp1", {
  threadId: "thr_b2c3d4",
  parentThreadId: "thr_a1b2c3",
  title: "Check the bounce list",
  status: "running",
  agentId: "agt_a1b2c3",
  model: "Haiku",
  path: [
    { title: "Intake", threadId: "thr_a1b2c3" },
    { title: "Check the bounce list", threadId: "thr_b2c3d4" },
  ],
});

export const SAMPLE_DIFF_CARD = block("diff_card", "blk_dif1", {
  diffId: "dif_a1b2c3",
  kind: "role",
  title: "Let Paralegals attach files to Clients",
  changes: [
    { path: "roles/paralegal/clients.files", before: "view", after: "edit" },
    { path: "roles/paralegal/clients.delete", before: false, after: false },
  ],
  affects: "4 people with the Paralegal role",
});

export function sampleBlocksB(): Block[] {
  return [SAMPLE_MEMORY, SAMPLE_VAULT_USED, SAMPLE_ACCESS_REQUEST, SAMPLE_SECRET_INPUT, SAMPLE_MODEL_SWITCH, SAMPLE_HELPER, SAMPLE_DIFF_CARD];
}
