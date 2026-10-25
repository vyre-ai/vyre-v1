// Sample blocks for part one: the data shapes in generated/registry.json blocks[].data, with ids that match the registry patterns.
// Tests and the screenshot mount use these; nothing in the app imports this file.

import type { Block, BlockState } from "../../kit/types.ts";

function block(type: string, id: string, data: unknown, state: BlockState = "done"): Block {
  return { type, v: 1, id, data, state, traceId: `tr_${type}_${id}` };
}

export const SAMPLE_TERMINAL = block("terminal", "blk_term1", {
  terminalId: "trm_a1b2c3",
  title: "Checked the form fields",
  host: "agent_computer",
  hostTitle: "Intake computer",
  commands: [
    { command: "vyre records get rivera --fields intake", exitCode: 0, startedAt: 1760000000000, durationMs: 840 },
    { command: "vyre forms check rivera-intake.json", exitCode: 0, startedAt: 1760000001000, durationMs: 1210 },
  ],
  tail: "Elena Rivera · Contact · Consult booked Tue 14:00\nmissing: id_scan, date_of_birth",
  state: "idle",
  exitCode: 0,
});

export const SAMPLE_CHANGESET = block("changeset", "blk_chg1", {
  changesetId: "chg_a1b2c3",
  folderId: "fld_a1b2c3",
  folderName: "Projects/Rivera matter",
  fileCount: 3,
  added: 29,
  removed: 5,
  state: "open",
});

export const SAMPLE_QUESTION = block(
  "question",
  "blk_q1",
  {
    threadId: "thr_a1b2c3",
    blockId: "blk_q1",
    prompt: "Which consult length should the form offer?",
    mode: "single",
    allowOther: true,
    options: [
      { key: "30", label: "30 minutes" },
      { key: "45", label: "45 minutes" },
      { key: "60", label: "60 minutes", detail: "Matches the engagement letter" },
    ],
  },
  "waiting",
);

export const SAMPLE_PLAN = block(
  "plan",
  "blk_plan1",
  {
    threadId: "thr_a1b2c3",
    blockId: "blk_plan1",
    planId: "pln_a1b2c3",
    docFileId: "fil_a1b2c3",
    title: "Prepare the Rivera intake",
    state: "proposed",
    steps: [
      { stepId: "stp_a1", text: "Mount the Marketing folder from Google Drive for the welcome kit", state: "todo" },
      { stepId: "stp_a2", text: "Fill the engagement letter from the Rivera record", state: "todo" },
      { stepId: "stp_a3", text: "Send Elena the intake form and book the consult", state: "todo" },
      { stepId: "stp_a4", text: "Deploy a booking widget preview for the firm site", state: "todo" },
    ],
  },
  "waiting",
);

export const SAMPLE_DEPLOY = block("deploy", "blk_dep1", {
  siteId: "sit_a1b2c3",
  deploymentId: "dpl_a1b2c3",
  env: "preview",
  state: "ready",
  url: "https://booking-rivera.preview.vyre.run",
  checks: [
    { name: "Build", ok: true },
    { name: "Links", ok: true },
    { name: "Forms", ok: true },
  ],
  canPromote: true,
});

export const SAMPLE_MOUNT = block("mount", "blk_mnt1", {
  mountId: "mnt_a1b2c3",
  folderId: "fld_b1c2d3",
  name: "Marketing",
  provider: "Google Drive",
  state: "Read-only · synced",
  lagSeconds: 120,
});

export const SAMPLE_RECORD = block("record_card", "blk_rec1", {
  recordId: "rec_a1b2c3",
  type: "contact",
  title: "Elena Rivera",
  status: "Consult booked",
  summary: "Referred by Maya Chen. Intake form sent, ID scan still missing.",
  fields: [
    { key: "email", title: "Email", value: "elena@rivera.example" },
    { key: "phone", title: "Phone", value: "(415) 555-0142" },
    { key: "consult", title: "Consult", value: "Tue 14:00" },
    { key: "owner", title: "Owner", value: ["Maya Chen", "Omar Haddad"] },
    { key: "hidden", title: "Sealed", value: { sealed: true } },
  ],
});

/** The seven types in the order a chat shows them. */
export function sampleBlocksA(): Block[] {
  return [SAMPLE_PLAN, SAMPLE_QUESTION, SAMPLE_TERMINAL, SAMPLE_CHANGESET, SAMPLE_MOUNT, SAMPLE_DEPLOY, SAMPLE_RECORD];
}
