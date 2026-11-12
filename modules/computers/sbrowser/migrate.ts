// Dex keeps his logins (6 Nov design, "Migration"): the two halves of the move of an old agent computer that belong to the Space browser, bound into the migration port of capacity's migrate.ts.
//   ensureBrowserProfile   the agent's profile exists (it is made when it first browses, so this is its name, checked), safe to repeat;
//   importChromeData       Chrome's user-data of the old computer (a tar whose root entry is the folder `chrome`) replaces what the profile holds; the profile's browser is stopped first. Safe to repeat.
import { bindMigrationPort } from "../migrate.ts";
import { raise } from "../projections.ts";
import { profileIdOf } from "./policy.ts";
import { spaceBrowser } from "./port.ts";

bindMigrationPort("ensureBrowserProfile", async (ctx, a) => {
  const profileId = profileIdOf(a.agentId);
  if (!profileId) raise(ctx, "validation.bad_input", "This agent cannot have a browser profile: its id is not valid.");
  if (!spaceBrowser()) raise(ctx, "provider.unavailable", "The Space browser is not running on this host.");
  return { profileId };
});

bindMigrationPort("importChromeData", async (ctx, a) => {
  const sb = spaceBrowser();
  if (!sb) raise(ctx, "provider.unavailable", "The Space browser is not running on this host.");
  if (a.profileId !== profileIdOf(a.agentId)) raise(ctx, "validation.bad_input", "That is not this agent's profile.");
  try { return await sb.importChrome(a.profileId, a.data.tar); } catch (e) {
    // a Space browser that cannot start (its image missing or broken) says so in plain words in the move's row and the log; the code and reason stay, so the move is still tried again later
    const x = e as { code?: unknown; reason?: unknown; message?: unknown };
    if (x?.code !== "unavailable" || x.reason) throw e;   // busy and held refusals carry a reason and are not start failures
    throw Object.assign(new Error(`The Space browser could not start, so the sign-ins from the older desktop have not moved yet (${String(x.message ?? "").slice(0, 160)}). It will be tried again.`), { code: "unavailable", ...(x.reason ? { reason: x.reason } : {}) });
  }
});

// The move never writes over a profile that holds sign-ins. `profileUsed` starts nothing; a throw reaches the move as "not now" (no Space browser) or a bad input, never as "not used".
bindMigrationPort("profileInUse", async (ctx, a) => {
  const sb = spaceBrowser();
  if (!sb) raise(ctx, "provider.unavailable", "The Space browser is not running on this host.");
  if (a.profileId !== profileIdOf(a.agentId)) raise(ctx, "validation.bad_input", "That is not this agent's profile.");
  return sb.profileUsed(a.profileId);
});
