// One handler per home capability (8). The digest and See all live in digest.ts, Projects at risk in risk.ts, today's routines and the checklist in today.ts.
import { activity, digest, markSeen, writeDigest } from "./digest.ts";
import { atRisk } from "./risk.ts";
import { checklist, dismissChecklist, routinesToday } from "./today.ts";

export const handlers = {
  "home.activity": activity,
  "home.at_risk": atRisk,
  "home.checklist": checklist,
  "home.digest": digest,
  "home.dismiss_checklist": dismissChecklist,
  "home.mark_digest_seen": markSeen,
  "home.routines_today": routinesToday,
  "home.write_digest": writeDigest,
};
