// Golden flow 8: Memory promotion. Steps live in golden/steps/08-memory-promotion.ts (L11).
import { defineFlow } from "../harness/index.ts";

export default defineFlow({
  n: 8,
  name: "memory-promotion",
  title: "Memory promotion",
  needs: ["memory", "tasks"],
  events: ["memory.fact_proposed", "memory.fact_accepted", "memory.promotion_requested", "memory.promoted"],
});
