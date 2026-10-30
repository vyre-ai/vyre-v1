// Parent, child, and attempt lines for the run inspector. Empty input stays empty.
export interface LineageChild {
  runId: string;
  attempt?: number;
  lane?: string;
  item?: string;
}

/** Child line. Lane or item only when that field is present. Otherwise the id and attempt. */
export function childRunLine(child: LineageChild): string {
  const attempt = typeof child.attempt === "number" ? `, attempt ${child.attempt}` : "";
  if (child.lane && child.lane.length > 0) return `Lane ${child.lane} · child Run ${child.runId}${attempt}`;
  if (child.item !== undefined && String(child.item).length > 0) return `Item ${child.item} · child Run ${child.runId}${attempt}`;
  return typeof child.attempt === "number" ? `Child ${child.runId}, attempt ${child.attempt}` : `Child ${child.runId}`;
}

export function attemptLine(step: { step: string; state: string; attempt?: number; branch?: string }): string {
  const parts = [step.step, step.state];
  if (typeof step.attempt === "number") parts.push(`attempt ${step.attempt}`);
  if (step.branch) parts.push(step.branch);
  return parts.join(" · ");
}

/** One parallel or loop step can hold the child Runs. More than one container is not guessed. */
export function containerForChildren(nodes: readonly { id: string; key: string }[]): string | null {
  const containers = nodes.filter((node) => node.key === "parallel" || node.key === "loop");
  return containers.length === 1 ? containers[0]!.id : null;
}

export interface LineageLines {
  parent?: string;
  attempt?: string;
  children: { id: string; text: string }[];
}

export function lineageLines(parentRun: string | undefined, steps: readonly { attempt?: number }[], children: readonly LineageChild[]): LineageLines | null {
  const kids = children.filter((child) => child.runId.length > 0);
  const hasParent = typeof parentRun === "string" && parentRun.length > 0;
  if (!hasParent && kids.length === 0) return null;
  const attempts = [...steps.map((step) => step.attempt), ...kids.map((child) => child.attempt)].filter((n): n is number => typeof n === "number");
  const attempt = attempts.length > 0 ? Math.max(...attempts) : undefined;
  return {
    ...(hasParent ? { parent: `Parent ${parentRun}` } : {}),
    ...(attempt !== undefined ? { attempt: `Attempt ${attempt}` } : {}),
    children: kids.map((child) => ({
      id: child.runId,
      text: childRunLine(child),
    })),
  };
}
