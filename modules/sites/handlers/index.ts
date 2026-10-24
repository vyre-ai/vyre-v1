import { deployHandlers } from "./deploy.ts";
import { domainHandlers } from "./domains.ts";

export { deployHandlers, domainHandlers };

export const coreHandlers = {
  ...deployHandlers,
  ...domainHandlers,
};
