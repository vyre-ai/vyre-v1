// @vyre/lib public entry. Pure helpers: no I/O beyond node builtins (lib/acme is the only node-specific folder and is imported by path, not from here).
export { mintUuid, mintId, isUuid, timeOf } from "./ids.ts";
export { canonical } from "./canonical.ts";
export { segments, spaceOf, covers, containedPrefix } from "./urn.ts";
export { formatHlc, parseHlc, compareHlc, tickHlc, receiveHlc, clampHlc, MAX_SKEW_MS } from "./hlc.ts";
export type { Hlc, ClampResult } from "./hlc.ts";
export { frontmatter, headings, links, toPlain, excerpt, escapeMd, slug } from "./md.ts";
export { diffLines, diffWords, diffStats, sideOf } from "./diff.ts";
export type { DiffOp } from "./diff.ts";
export { route, nextDepth, DEFAULT_AGENT_HOPS } from "./route.ts";
export type { RouteThread, RouteMessage, RouteResult, RouteReason, RouteAgent, RouteMention } from "./route.ts";
export { parseExpr, evalExpr, exprNames } from "./expr/expr.ts";
export { LanguageError } from "./expr/errors.ts";
export { holds, isEmpty, fieldState, fieldStates, stagesFor, stageNamesOf, defaultEvaluator } from "./expr/conditions.ts";
