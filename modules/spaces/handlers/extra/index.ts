// The thirteen spaces capabilities without a packet of their own (P-L7_07b). The host maps these over the `later` entries of ../index.ts when spaces goes live.
import { deleteCancel, deleteDue, deleteSpace, exportAll, exportLatest, get, image, leave, matrix, setTimezone, switchAddress, transferOwnership, update } from "./core.ts";

export { configureSpaceAdmin } from "./core.ts";
export type { ExtraCtx, SpaceAdminDrivers } from "./core.ts";

export const extraHandlers = {
  "spaces.get": get,
  "spaces.update": update,
  "spaces.timezone.set": setTimezone,
  "spaces.image": image,
  "spaces.matrix": matrix,
  "spaces.export": exportAll,
  "spaces.export_latest": exportLatest,
  "spaces.leave": leave,
  "spaces.transfer_ownership": transferOwnership,
  "spaces.delete": deleteSpace,
  "spaces.delete_cancel": deleteCancel,
  "spaces.delete_due": deleteDue,
  "spaces.switch_address": switchAddress,
};
