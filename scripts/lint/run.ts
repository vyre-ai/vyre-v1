// Runs the six ARCHITECTURE-V1 10.1 lints on the changed file set. Budget: 10 s total.
//   node scripts/lint/run.ts [--base <ref>] [--files a b]

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Finding } from "./finding.ts";
import { appliesUiRows, checkUiRows } from "./ui-rows.ts";
import { appliesMenuIcons, checkMenuIcons } from "./menu-icons.ts";
import { appliesNoRawContextMenu, checkNoRawContextMenu } from "./no-raw-context-menu.ts";
import { appliesListSections, checkListSections } from "./list-sections.ts";
import { appliesNoContentInLogs, checkNoContentInLogs } from "./no-content-in-logs.ts";
import { appliesNoEmDashOrSectionSign, checkNoEmDashOrSectionSign } from "./no-em-dash-or-section-sign.ts";

export const BUDGET_MS = 10_000;

export type SourceFile = { file: string; source: string };

export type Rule = {
  id: string;
  applies: (file: string) => boolean;
  check: (file: string, source: string) => Finding[];
};

export const rules: Rule[] = [
  { id: "ui-rows", applies: appliesUiRows, check: checkUiRows },
  { id: "menu-icons", applies: appliesMenuIcons, check: checkMenuIcons },
  { id: "no-raw-context-menu", applies: appliesNoRawContextMenu, check: checkNoRawContextMenu },
  { id: "list-sections", applies: appliesListSections, check: checkListSections },
  { id: "no-content-in-logs", applies: appliesNoContentInLogs, check: checkNoContentInLogs },
  { id: "no-em-dash-or-section-sign", applies: appliesNoEmDashOrSectionSign, check: checkNoEmDashOrSectionSign },
];

/** Rules run only on `changed`. Files absent from that list are ignored. */
export function lintChanged(files: readonly SourceFile[], changed: readonly string[]): Finding[] {
  const want = new Set(changed);
  const out: Finding[] = [];
  for (const file of files) {
    if (!want.has(file.file)) continue;
    for (const rule of rules) {
      if (!rule.applies(file.file)) continue;
      out.push(...rule.check(file.file, file.source));
    }
  }
  return out;
}

export function gitChanged(repo: string, base?: string): string[] {
  const args = base
    ? ["diff", "--name-only", "--no-renames", `${base}...HEAD`]
    : ["diff", "--name-only", "--no-renames", "HEAD"];
  const diff = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  if (diff.status !== 0) return [];
  return diff.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

function directRun(): boolean {
  if (process.argv.includes("--test")) return false;
  const arg = process.argv[1];
  if (!arg) return false;
  return import.meta.url === pathToFileURL(path.resolve(arg)).href;
}

function main(): void {
  const args = process.argv.slice(2);
  let base: string | undefined;
  const only: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--base") base = args[++i];
    else if (args[i] === "--files") {
      while (args[i + 1] && !args[i + 1].startsWith("--")) only.push(args[++i]);
    } else if (args[i] === "--help") {
      console.log("usage: node scripts/lint/run.ts [--base <ref>] [--files <path>...]");
      return;
    }
  }
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const names = only.length ? only : gitChanged(repo, base);
  const files: SourceFile[] = [];
  for (const file of names) {
    const abs = path.join(repo, file);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    const source = fs.readFileSync(abs, "utf8");
    if (source.includes("\0")) continue;
    files.push({ file, source });
  }
  const t0 = Date.now();
  const hits = lintChanged(files, names);
  const ms = Date.now() - t0;
  for (const hit of hits) console.log(`${hit.rule} ${hit.file}:${hit.line}:${hit.column}: ${hit.message}`);
  if (ms > BUDGET_MS) {
    console.error(`lint exceeded 10 s (${ms} ms)`);
    process.exit(1);
  }
  if (hits.length) process.exit(1);
  console.log(`lint ${names.length} changed files, 0 findings, ${ms} ms`);
}

if (directRun()) main();
