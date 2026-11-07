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
  return sb.importChrome(a.profileId, a.data.tar);
});
