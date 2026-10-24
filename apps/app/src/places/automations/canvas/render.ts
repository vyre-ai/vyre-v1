// Canvas screen automations.canvas (builtin ui:AutomationCanvas).
// Paints the definition graph, inline validation, the lane a run took,
// and History through ui/HistoryTab. String markup, no renderer, no fetch.
// The draft in memory is the local copy. First paint is this string.

import { HistoryTabPlaceholder } from "../../../../../../ui/src/HistoryTab/Placeholder.tsx";
import type { Density, HistoryTabProps } from "../../../../../../ui/src/HistoryTab/props.ts";
import { TabStripPlaceholder } from "../../../../../../ui/src/TabStrip/Placeholder.tsx";
import {
  CHAIN_DEPTH_LIMIT,
  CONTROL_PALETTE,
  readPaths,
  stepTitle,
  rootIds,
  takenLane,
  triggerTitle,
  validateDefinition,
  WAIT_TIMEOUT_DEFAULT,
} from "./model.ts";
import type { CanvasIssue, CanvasNode, Editor } from "./model.ts";

export function densityFor(width: number): Density {
  return width <= 480 ? "compact" : "regular";
}

function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function alerts(issues: readonly CanvasIssue[]): string {
  return issues.map((issue) => `<p role="alert" data-issue="${issue.severity}">${esc(issue.message)}</p>`).join("");
}

function triggerRow(editor: Editor, issues: readonly CanvasIssue[]): string {
  if (editor.definition.triggers.length === 0) {
    const banner = issues.filter((issue) => issue.nodeId === undefined);
    return `<div data-triggers="0">${alerts(banner)}</div>`;
  }
  const chips = editor.definition.triggers.map((trigger, index) => {
    const nodeId = `trigger:${index}`;
    const mine = issues.filter((issue) => issue.nodeId === nodeId);
    const first = mine[0];
    const issue = first ? ` data-issue="${esc(first.message)}"` : "";
    return `<div data-trigger="${esc(trigger.key)}" data-trigger-index="${index}"${issue}><span>${esc(triggerTitle(trigger.key))}</span>${alerts(mine)}</div>`;
  }).join("");
  return `<div data-triggers="${editor.definition.triggers.length}">${chips}</div>`;
}

function palette(): string {
  const buttons = CONTROL_PALETTE.map((item) => `<button type="button" data-add="${item.key}">${esc(item.title)}</button>`).join("");
  return `<div data-palette="controls">${buttons}</div>`;
}

function historyPanel(editor: Editor, density: Density): string {
  const props: HistoryTabProps = {
    resourceType: "automation",
    resourceId: editor.automationId,
    versions: editor.versions,
    selectedVersionId: editor.selectedVersionId,
    density,
  };
  const box = HistoryTabPlaceholder(props);
  return `<div data-placeholder="${esc(box.label)}" data-density="${box.density}" data-label="${esc(box.text)}"><span data-label>${esc(box.text)}</span></div>`;
}

interface Paint {
  editor: Editor;
  issues: readonly CanvasIssue[];
  lit: ReadonlySet<string> | null;
}

function laneAttr(id: string, paint: Paint): string {
  if (!paint.lit) return "";
  return ` data-lane="${paint.lit.has(id) ? "lit" : "dim"}"`;
}

function renderNode(id: string, paint: Paint, seen: Set<string>): string {
  if (seen.has(id)) return "";
  const node = paint.editor.definition.nodes.find((item) => item.id === id);
  if (!node) return "";
  seen.add(id);
  const mine = paint.issues.filter((issue) => issue.nodeId === id && !claimedByBranch(node, issue.message));
  const runState = paint.editor.run?.steps.find((step) => step.stepId === id);
  const state = runState ? ` data-run-state="${runState.state}"` : "";
  const body = `${head(node)}${alerts(mine)}${branches(node, paint, seen)}${follow(node, paint, seen)}`;
  return `<div data-node="${esc(id)}" data-key="${esc(node.key)}"${laneAttr(id, paint)}${state} style="min-height:48px">${body}</div>`;
}

function claimedByBranch(node: CanvasNode, message: string): boolean {
  return (node.branches ?? []).some((branch) => message.startsWith(`Path ${branch.label} `) || message === `Path name ${branch.label} is used twice`);
}

function head(node: CanvasNode): string {
  const title = node.title ?? stepTitle(node.key);
  if (node.key === "wait") {
    const timeout = typeof node.input.timeout === "string" && node.input.timeout.length > 0 ? node.input.timeout : WAIT_TIMEOUT_DEFAULT;
    return `<h3>${esc(title)}</h3><span data-timeout="${esc(timeout)}">${esc(timeout)}</span>`;
  }
  if (node.key === "loop") {
    const items = typeof node.input.items === "string" ? node.input.items : "";
    return `<h3>${esc(title)}</h3><span data-items="${esc(items)}">${esc(items)}</span>`;
  }
  if (node.key === "stop") {
    const outcome = typeof node.input.outcome === "string" ? node.input.outcome : "";
    const extra = outcome.length > 0 ? `<span data-outcome="${esc(outcome)}">${esc(outcome)}</span>` : "";
    return `<h3>${esc(title)}</h3>${extra}`;
  }
  return `<h3>${esc(title)}</h3>`;
}

function branches(node: CanvasNode, paint: Paint, seen: Set<string>): string {
  const list = node.branches ?? [];
  if (list.length === 0) return "";
  const paths = readPaths(node.input);
  const taken = paint.editor.run?.steps.find((step) => step.stepId === node.id)?.taken;
  const cells = list.map((branch) => {
    const path = paths.find((item) => item.name === branch.label);
    const when = path?.when ?? branch.when ?? "";
    const claimed = paint.issues.filter((item) => item.nodeId === node.id && claimedByBranch(node, item.message) && item.message.includes(branch.label));
    const shown = claimed.find((item) => item.message === `Path ${branch.label} needs a condition`) ?? claimed[0];
    const issueAttr = shown ? ` data-issue="${esc(shown.message)}"` : "";
    let lane = "";
    if (paint.editor.run && node.key === "paths") {
      const on = taken === branch.label || taken === branch.to;
      lane = ` data-branch-lane="${on ? "lit" : "dim"}"`;
    }
    const condition = when.length > 0 ? `<span data-when="${esc(when)}">${esc(when)}</span>` : "";
    const inline = claimed.length > 0 ? alerts(claimed) : "";
    const child = renderNode(branch.to, paint, seen);
    return `<div data-branch="${esc(branch.label)}"${lane}${issueAttr}>${esc(branch.label)}${condition}${inline}${child}</div>`;
  }).join("");
  return `<div data-branches="${list.length}">${cells}</div>`;
}

function follow(node: CanvasNode, paint: Paint, seen: Set<string>): string {
  return (node.next ?? []).map((id) => renderNode(id, paint, seen)).join("");
}

/** Screen body for one automation. Width picks regular or compact density. */
export function renderCanvas(editor: Editor, frame: { width: number }): string {
  const density = densityFor(frame.width);
  const validation = validateDefinition(editor.definition, editor.kind);
  const tabs = TabStripPlaceholder({
    tabs: [
      { key: "canvas", title: "Canvas" },
      { key: "history", title: "History" },
    ],
    active: editor.tab,
  });
  const lit = editor.run ? takenLane(editor.definition, editor.run.steps) : null;
  const paint: Paint = { editor, issues: validation.issues, lit };
  const seen = new Set<string>();
  const roots = rootIds(editor.definition);
  const graph = editor.tab === "history"
    ? historyPanel(editor, density)
    : `${triggerRow(editor, validation.issues)}${palette()}${roots.map((id) => renderNode(id, paint, seen)).join("")}`;
  return `<section data-screen-id="automations.canvas" data-builtin="ui:AutomationCanvas" data-automation-id="${esc(editor.automationId)}" data-tab="${editor.tab}" data-ok="${validation.ok ? "true" : "false"}" data-chain-depth="${CHAIN_DEPTH_LIMIT}" data-width="${frame.width}" data-density="${density}" style="min-height:320px"><h2>${esc(editor.name)}</h2>${tabs}${graph}</section>`;
}
