// Block registry (ARCH 6.8). The client renders only through blockRenderers[type@v].
// The fourteen types are the agent's native environment (spec native, ARCH 6.8).
// A missing key, including a newer v of a known type, renders GenericBlock.

import { GenericBlock, applyFallback } from "./GenericBlock.tsx";
import type { Block } from "../kit/types.ts";

export const NATIVE_BLOCK_TYPES = [
  "terminal",
  "changeset",
  "question",
  "plan",
  "deploy",
  "mount",
  "record_card",
  "diff",
  "file",
  "screenshot",
  "tab_opened",
  "memory_saved",
  "vault_used",
  "model_switch",
] as const;

export type NativeBlockType = (typeof NATIVE_BLOCK_TYPES)[number];

export const NATIVE_BLOCK_V = 1;

export const BLOCK_FALLBACKS: { readonly [K in NativeBlockType]: string } = {
  terminal: "Ran commands on {{host}}",
  changeset: "Docs changed {{count}} files",
  question: "{{q}}",
  plan: "{{title}}",
  deploy: "{{name}} {{status}}",
  mount: "Mounted {{name}} from {{from}}",
  record_card: "{{title}}",
  diff: "{{title}}",
  file: "{{name}}",
  screenshot: "{{caption}}",
  tab_opened: "Opened {{file}} beside the chat",
  memory_saved: "Saved to your layer, Propose for team",
  vault_used: "Used {{name}} by name, never shown",
  model_switch: "{{title}}",
};

const SAMPLE_DATA: { readonly [K in NativeBlockType]: Readonly<Record<string, string | number>> } = {
  terminal: { host: "Intake computer" },
  changeset: { count: 3 },
  question: { q: "Which inbox?" },
  plan: { title: "Reply to Maya" },
  deploy: { name: "Booking widget", status: "live" },
  mount: { name: "Marketing", from: "Google Drive" },
  record_card: { title: "Maya Chen" },
  diff: { title: "client-intake.md" },
  file: { name: "client-intake.pdf" },
  screenshot: { caption: "Signup form" },
  tab_opened: { file: "client-intake.pdf" },
  memory_saved: { layer: "person" },
  vault_used: { name: "TWILIO_KEY" },
  model_switch: { title: "Summarise the call" },
};

export function isNativeBlockType(type: string): type is NativeBlockType {
  return (NATIVE_BLOCK_TYPES as readonly string[]).includes(type);
}

export function blockKey(type: string, v: number): string {
  return `${type}@${v}`;
}

function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function renderRegistered(block: Block, fallback: string): string {
  const title = applyFallback(fallback, block.data) || block.type;
  return [
    `<div data-block-type="${esc(block.type)}" data-block-v="${block.v}" data-label="${esc(title)}" data-trace-id="${esc(block.traceId)}">`,
    `<span data-label>${esc(title)}</span>`,
    `</div>`,
  ].join("");
}

function renderers(): Record<string, (block: Block) => string> {
  const out: Record<string, (block: Block) => string> = {};
  for (const type of NATIVE_BLOCK_TYPES) {
    const fallback = BLOCK_FALLBACKS[type];
    out[blockKey(type, NATIVE_BLOCK_V)] = (block) => renderRegistered(block, fallback);
  }
  return out;
}

/** Registered renderers. Lookup is type@v. There is no entry for an unknown type or a newer v. */
export const blockRenderers: Readonly<Record<string, (block: Block) => string>> = renderers();

export function renderBlock(block: Block): string {
  const render = blockRenderers[blockKey(block.type, block.v)];
  if (render) return render(block);
  const fallback = isNativeBlockType(block.type) ? BLOCK_FALLBACKS[block.type] : undefined;
  return GenericBlock({ block, ...(fallback !== undefined ? { fallback } : {}) });
}

export function sampleNativeBlocks(): Block[] {
  return NATIVE_BLOCK_TYPES.map((type) => ({
    type,
    v: NATIVE_BLOCK_V,
    id: `sample-${type}`,
    data: SAMPLE_DATA[type],
    state: "done",
    traceId: `tr_${type}`,
  }));
}

/** A type the registry does not know. renderBlock returns GenericBlock. */
export const unknownBlockSample: Block = {
  type: "comet",
  v: 1,
  id: "sample-comet",
  data: { n: 1 },
  traceId: "tr_comet",
};
