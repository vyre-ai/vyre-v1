// GenericBlock (ARCH 6.8). Unknown or newer type@v.
// Title comes from the fallback template. Data is one collapsed JSON line. The trace id can be copied.

import type { Block } from "../kit/types.ts";

export interface GenericBlockProps {
  block: Block;
  /** Text template from BlockTypeDef.fallback. Missing for a type the client has never registered. */
  fallback?: string;
}

function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Fill `{{field}}` from block data. Non-scalars become empty. */
export function applyFallback(template: string | undefined, data: unknown): string {
  if (!template) return "";
  const rec = isRecord(data) ? data : {};
  const filled = template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_all, key: string) => {
    const value = rec[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
    return "";
  });
  return filled.replace(/\s+/g, " ").trim();
}

/** One line of JSON, cut off so a large payload stays a single collapsed row. */
export function collapseJson(data: unknown): string {
  let text = "";
  try {
    const raw = JSON.stringify(data);
    text = typeof raw === "string" ? raw : "";
  } catch {
    text = "";
  }
  if (text.length <= 180) return text;
  return `${text.slice(0, 177)}...`;
}

export function genericTitle(props: GenericBlockProps): string {
  const fromTemplate = applyFallback(props.fallback, props.block.data);
  if (fromTemplate.length > 0) return fromTemplate;
  return props.block.type;
}

export function GenericBlock(props: GenericBlockProps): string {
  const title = genericTitle(props);
  const json = collapseJson(props.block.data);
  const trace = props.block.traceId;
  return [
    `<div data-placeholder="GenericBlock" data-block="generic" data-label="${esc(title)}" data-trace-id="${esc(trace)}" aria-label="${esc(title)}">`,
    `<span data-label>${esc(title)}</span>`,
    `<pre data-json>${esc(json)}</pre>`,
    `<button type="button" data-copy-trace="${esc(trace)}">Copy trace id</button>`,
    `</div>`,
  ].join("");
}
