// Handler table of the engine capabilities that the first engine packet left over (P-L2_13b). handlers/index.ts spreads it into the module table.
// engine.warm, engine.placement.decide and engine.pool.status wrap the logic of P-L2_04 (agent/src/pool, agent/src/placement); they live in ../place.ts.
import { defaultsGet, defaultsSet, policyGet, policySet, runtimeOptIn, subscriptionShareSet, usePolicyExport } from "./config.ts";
import { modelsList, providersList } from "./models.ts";
import { placementDecide, poolStatus, warm } from "../place.ts";
import { reviewList, reviewMark } from "./review.ts";
import { engineHealth, leaseAcquire, leaseHeartbeat, leaseRelease, queueList, queuePeek, routePreview } from "./threads.ts";
import { turnAppend, turnEnqueue, turnFallback, turnFinish, turnGet, turnRetry, turnStart, turnWait, turnsList } from "./turns.ts";

export const extraHandlers = {
  "engine.placement.decide": placementDecide,
  "engine.pool.status": poolStatus,
  "engine.warm": warm,
  "engine.models.list": modelsList,
  "engine.providers.list": providersList,
  "engine.defaults.get": defaultsGet,
  "engine.defaults.set": defaultsSet,
  "engine.policy.get": policyGet,
  "engine.policy.set": policySet,
  "engine.subscription_share.set": subscriptionShareSet,
  "engine.runtime.opt_in": runtimeOptIn,
  "engine.use_policy.export": usePolicyExport,
  "engine.review.list": reviewList,
  "engine.review.mark": reviewMark,
  "engine.turn.enqueue": turnEnqueue,
  "engine.turn.start": turnStart,
  "engine.turn.append": turnAppend,
  "engine.turn.wait": turnWait,
  "engine.turn.finish": turnFinish,
  "engine.turn.fallback": turnFallback,
  "engine.turn.get": turnGet,
  "engine.turns.list": turnsList,
  "engine.turn.retry": turnRetry,
  "engine.lease.acquire": leaseAcquire,
  "engine.lease.heartbeat": leaseHeartbeat,
  "engine.lease.release": leaseRelease,
  "engine.queue.list": queueList,
  "engine.queue.peek": queuePeek,
  "engine.route.preview": routePreview,
  "engine.health": engineHealth,
};

export { bindSandboxStopper, flagOn, readPolicy, wrappedRuntimeKey } from "./config.ts";
