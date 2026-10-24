// Plan mode (spec "Vyre is the agent's native environment"): a per-thread switch. The agent may read and plan; it changes nothing until a person approves the plan.
// Approved steps then run and tick off. A rejected plan stays in plan mode. An agent never approves its own plan.
export interface PlanStep { text: string; done: boolean }
export type PlanState = "none" | "proposed" | "approved" | "rejected";
export interface PlanActor { kind: "person" | "agent"; id: string }

export type PlanEvent =
  | { type: "plan.proposed"; threadId: string; planId: string; steps: number }
  | { type: "plan.approved"; threadId: string; planId: string; by: string }
  | { type: "plan.rejected"; threadId: string; planId: string; by: string }
  | { type: "plan.step_done"; threadId: string; planId: string; index: number };

export class PlanError extends Error {
  readonly code: "not_a_person" | "no_plan" | "wrong_state" | "bad_step";
  constructor(code: PlanError["code"], message: string) { super(message); this.name = "PlanError"; this.code = code; }
}

export interface PlanMode {
  /** True while writes are blocked. */
  readonly planMode: boolean;
  readonly state: PlanState;
  readonly steps: readonly PlanStep[];
  /** The person turns plan mode on or off for the thread. Turning it on discards an approved plan's authority. */
  setPlanMode(on: boolean, by: PlanActor): void;
  /** plan_propose: store a plan for review. Allowed in plan mode, and outside it (a plan card the person can still approve or edit). */
  propose(steps: readonly string[], by: PlanActor): string;
  /** The person edits the steps before approving. */
  edit(steps: readonly string[], by: PlanActor): void;
  /** approve_plan: only a person. Leaves plan mode. */
  approve(by: PlanActor): void;
  reject(by: PlanActor): void;
  /** Tick off an approved step. */
  stepDone(index: number): void;
}

export function createPlanMode(threadId: string, opts: { initial?: boolean; emit?: (e: PlanEvent) => void } = {}): PlanMode {
  let on = opts.initial === true;
  let state: PlanState = "none";
  let steps: PlanStep[] = [];
  let planId = "";
  let n = 0;
  const emit = opts.emit ?? ((): void => {});
  const person = (by: PlanActor): void => { if (by.kind !== "person") throw new PlanError("not_a_person", "only a person approves a plan or changes plan mode"); };
  const clean = (list: readonly string[]): PlanStep[] => {
    const out = list.map((t) => t.trim()).filter((t) => t !== "").map((text) => ({ text, done: false }));
    if (out.length === 0) throw new PlanError("bad_step", "a plan needs at least one step");
    return out;
  };

  return {
    get planMode() { return on; },
    get state() { return state; },
    get steps() { return steps.map((s) => ({ ...s })); },
    setPlanMode(next, by) {
      person(by);
      on = next;
      if (next && state === "approved") state = "none";
    },
    propose(list) {
      steps = clean(list);
      planId = `plan_${++n}`;
      state = "proposed";
      emit({ type: "plan.proposed", threadId, planId, steps: steps.length });
      return planId;
    },
    edit(list, by) {
      person(by);
      if (state !== "proposed") throw new PlanError("wrong_state", "only a proposed plan can be edited");
      steps = clean(list);
    },
    approve(by) {
      person(by);
      if (state === "none") throw new PlanError("no_plan", "there is no plan to approve");
      if (state !== "proposed") throw new PlanError("wrong_state", "this plan is not waiting for approval");
      state = "approved";
      on = false;
      emit({ type: "plan.approved", threadId, planId, by: by.id });
    },
    reject(by) {
      person(by);
      if (state !== "proposed") throw new PlanError("wrong_state", "this plan is not waiting for approval");
      state = "rejected";
      emit({ type: "plan.rejected", threadId, planId, by: by.id });
    },
    stepDone(index) {
      if (state !== "approved") throw new PlanError("wrong_state", "steps run only after the plan is approved");
      const step = steps[index];
      if (!step) throw new PlanError("bad_step", "no such step");
      if (step.done) return;
      step.done = true;
      emit({ type: "plan.step_done", threadId, planId, index });
    },
  };
}
