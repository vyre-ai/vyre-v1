// health handlers: check runner and server services.
import { checkHandlers } from './checks.ts';
import { serviceHandlers } from './services.ts';

export const handlers = {
  ...checkHandlers,
  ...serviceHandlers,
};
