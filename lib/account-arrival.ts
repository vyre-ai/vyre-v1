// Did an event mean an AI account became available? provider.added always does. A shared subscription does only when the share was turned ON: engine.subscription_share_changed is also emitted for turning it off, which
// takes an account away. One answer for every consumer that goes on when an account arrives (goals, the engine's sign-in resume, the routines' resume).
export const accountMayHaveArrived = (e: { name: string; payload?: Record<string, unknown> | undefined }): boolean =>
  e.name !== "engine.subscription_share_changed" || e.payload?.["enabled"] === true;
