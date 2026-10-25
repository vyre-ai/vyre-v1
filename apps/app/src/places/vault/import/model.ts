// Import (spec 2.17): bring items from 1Password, Bitwarden, LastPass or Chrome in one step. A file is read first, the preview says what would be added and what is already there, and only
// then does anything change. The words and the small rules live here so the sheet and the tests agree.
import type { CapMap } from "../../../../../../generated/types.ts";

export type Source = CapMap["vault.import_parse"]["in"]["source"];
export type Parsed = CapMap["vault.import_parse"]["out"]["items"][number];
export type Dedupe = CapMap["vault.import"]["in"]["dedupe"];

export interface SourceDef { key: Source; name: string; file: string; accept: string }
export const SOURCES: readonly SourceDef[] = [
  { key: "onepassword", name: "1Password", file: "An export from 1Password (.1pux or .csv)", accept: ".1pux,.csv" },
  { key: "bitwarden", name: "Bitwarden", file: "An export from Bitwarden (.json or .csv)", accept: ".json,.csv" },
  { key: "lastpass", name: "LastPass", file: "An export from LastPass (.csv)", accept: ".csv" },
  { key: "chrome", name: "Chrome passwords", file: "The passwords file from Chrome (.csv)", accept: ".csv" },
];

export const DEDUPE: readonly { key: Dedupe; label: string; note: string }[] = [
  { key: "skip", label: "Skip duplicates", note: "Leave what is already in the Vault as it is." },
  { key: "overwrite", label: "Overwrite", note: "Replace the Vault's copy with the imported one." },
  { key: "keep_both", label: "Keep both", note: "Add the imported item next to the existing one." },
];

export const KIND_WORDS: Readonly<Record<Parsed["kind"], string>> = {
  login: "Login", api_key: "API key", env: ".env", card: "Card", note: "Note", totp: "One-time code", ssh_key: "SSH key", ai_subscription: "AI provider", other: "Other",
};

export function previewLine(p: Parsed): string {
  const bits = [KIND_WORDS[p.kind], p.fieldKeys.length ? `${p.fieldKeys.length} ${p.fieldKeys.length === 1 ? "field" : "fields"}` : "no fields"];
  if (p.duplicateOf) bits.push("already in your Vault");
  if (p.warnings.length) bits.push(p.warnings.join(", "));
  return bits.join(" · ");
}

export const duplicates = (items: readonly Parsed[]): number => items.reduce((n, p) => n + (p.duplicateOf ? 1 : 0), 0);

/** What will happen, in a sentence, before the button is pressed. */
export function planWords(items: readonly Parsed[], dedupe: Dedupe): string {
  const dup = duplicates(items);
  const fresh = items.length - dup;
  if (items.length === 0) return "There is nothing in that file to import.";
  if (dup === 0) return `${fresh} ${fresh === 1 ? "item" : "items"} will be added.`;
  const tail = dedupe === "skip" ? `${dup} already here will be skipped` : dedupe === "overwrite" ? `${dup} already here will be replaced` : `${dup} already here will be kept and added again`;
  return `${fresh} new, ${tail}.`;
}

export function resultWords(r: { created: number; updated: number; skipped: number }): string {
  const parts = [`Added ${r.created}`];
  if (r.updated) parts.push(`replaced ${r.updated}`);
  if (r.skipped) parts.push(`skipped ${r.skipped}`);
  return `${parts.join(", ")}.`;
}
