// One handler per spaces capability. The switcher tile, stars, follows and the checklist are live; profile, matrix, export, leave, transfer, delete and address are later packets.
import type { SpacesCtx } from "../projections.ts";
import { raise } from "../projections.ts";
import { followsList, followsToggle, starsList, starsToggle } from "./stars.ts";
import { onboardingComplete, onboardingDismiss, onboardingGet, switcher } from "./switcher.ts";

async function later(ctx: SpacesCtx, _input: unknown): Promise<never> {
  raise(ctx.trace.traceId, "internal.not_implemented", "this capability is a later packet");
}

export const handlers = {
  "follows.list": followsList,
  "follows.toggle": followsToggle,
  "spaces.delete": later,
  "spaces.export": later,
  "spaces.get": later,
  "spaces.leave": later,
  "spaces.matrix": later,
  "spaces.onboarding.complete": onboardingComplete,
  "spaces.onboarding.dismiss": onboardingDismiss,
  "spaces.onboarding.get": onboardingGet,
  "spaces.switch_address": later,
  "spaces.switcher": switcher,
  "spaces.transfer_ownership": later,
  "spaces.update": later,
  "stars.list": starsList,
  "stars.toggle": starsToggle,
};
