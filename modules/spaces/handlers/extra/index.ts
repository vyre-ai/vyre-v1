// The eight spaces capabilities without a packet of their own (P-L7_07b). The host maps these over the `later` entries of ../index.ts when spaces goes live.
import { deleteSpace, exportAll, get, leave, matrix, switchAddress, transferOwnership, update } from "./core.ts";

export { configureSpaceAdmin } from "./core.ts";
export type { ExtraCtx, SpaceAdminDrivers } from "./core.ts";

export const extraHandlers = {
  "spaces.get": get,
  "spaces.update": update,
  "spaces.matrix": matrix,
  "spaces.export": exportAll,
  "spaces.leave": leave,
  "spaces.transfer_ownership": transferOwnership,
  "spaces.delete": deleteSpace,
  "spaces.switch_address": switchAddress,
};
