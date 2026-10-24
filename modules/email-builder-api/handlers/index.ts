// Handlers of email-builder-api: designs and versions, compile and preview, checks, test send, merge fields, snippets and the Ask diff.

import { compileHandlers } from "./compile.ts";

export const handlers = compileHandlers;

export { configureEmailBuilder, compileHtml, compileText, runChecks, diffDocs, applyChanges, validateDoc, cleanInline, cleanHtml, htmlToText } from "./compile.ts";
export type { AskDriver, Block, EmailDoc, Change, CheckResult } from "./compile.ts";
