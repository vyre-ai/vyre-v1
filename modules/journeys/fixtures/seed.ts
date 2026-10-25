// People and builders for the journeys tests.
import type { Stage, TaskTemplate } from "../projections.ts";

export const NOW = 1_760_000_000_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export interface Caller { id: string; kind?: "person" | "agent" | "actor" | "service"; actingFor?: string }
export const alice: Caller = { id: "usr_alice", kind: "person" };
export const bob: Caller = { id: "usr_bob", kind: "person" };
export const engine: Caller = { id: "svc_engine", kind: "service" };

export const task = (key: string, over: Partial<TaskTemplate> = {}): TaskTemplate => ({ key, title: `Do ${key}`, assigned: { kind: "person", id: "usr_alice" }, required: true, ...over });
export const stage = (key: string, order: number, over: Partial<Stage> = {}): Stage => ({ key, title: key[0]!.toUpperCase() + key.slice(1), order, exit: { requireTasks: true }, tasks: [], automations: [], ...over });

/** intake -> review -> done, with a required task in intake and an optional one in review. */
export function threeStages(over: { intake?: Partial<Stage>; review?: Partial<Stage> } = {}): Stage[] {
  return [
    stage("intake", 0, { tasks: [task("collect_documents"), task("welcome_call", { required: false })], ...over.intake }),
    stage("review", 1, { tasks: [task("check_file", { assigned: { kind: "agent", id: "agt_checker" }, keyId: "vit_key1", backupKeyId: "vit_key2" })], ...over.review }),
    stage("done", 2, { final: true, exit: { requireTasks: false } }),
  ];
}
export const newJourney = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ name: "Client intake", subjectType: "contact", stages: threeStages(), ...over });
