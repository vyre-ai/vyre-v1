// no-raw-context-menu: menus are built only through ui/Menu. A native contextmenu listener
// outside that component is a raw context menu (V1-SPEC 3.0, ARCHITECTURE-V1 10.1).

import { finding } from "./finding.ts";
import type { Finding } from "./finding.ts";
import { isCode, isMenuImplementation, skipped } from "./paths.ts";

const RULE = "no-raw-context-menu";
const NATIVE = /\bonContextMenu\b|\bcontextmenu\b|addEventListener\(\s*['"]contextmenu['"]|\.oncontextmenu\b/i;

export function appliesNoRawContextMenu(file: string): boolean {
  if (skipped(file)) return false;
  return isCode(file);
}

export function checkNoRawContextMenu(file: string, source: string): Finding[] {
  const code = stripComments(source);
  const hit = NATIVE.exec(code);
  if (!hit || hit.index === undefined) return [];
  if (isMenuImplementation(file) && /preventDefault\s*\(/.test(code)) return [];
  return [finding(RULE, file, source, hit.index, "native contextmenu is not allowed; build the menu with ui/Menu")];
}

function stripComments(source: string): string {
  const block = source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
  return block.replace(/(^|[^:])\/\/[^\n]*/g, (comment, lead) => lead + " ".repeat(comment.length - lead.length));
}
