// One handler per vault-requests capability (spec 2.17). They live in request.ts.
import {
  connectAskAdmin,
  connectDisconnect,
  connectGet,
  connectMayDiscard,
  connectOptions,
  connectReopen,
  connectService,
  connectSubmit,
} from "./connect.ts";
import { CONNECT_OFF_CODE, CONNECT_OFF_MESSAGE, gateConnect } from "../../../lib/connect-switch.ts";
import { raise } from "../projections.ts";
import type { VaultReqCtx } from "../projections.ts";
import {
  requestCreate,
  requestsCancel,
  requestsDecline,
  requestsFulfil,
  requestsGet,
  requestsList,
} from "./request.ts";

// the connect capabilities refuse for every caller while VYRE_CONNECT_CARD is off (lib/connect-switch.ts), before anything is read, written or emitted
const off = (ctx: VaultReqCtx): never => raise(ctx.trace.traceId, CONNECT_OFF_CODE, CONNECT_OFF_MESSAGE);
const gated = <I, R>(h: (ctx: VaultReqCtx, input: I) => R): ((ctx: VaultReqCtx, input: I) => R) =>
  gateConnect(h, (ctx) => off(ctx));

export const handlers = {
  "vault.connect": gated(connectService),
  "vault.connect_card.ask_admin": gated(connectAskAdmin),
  "vault.connect_card.disconnect": gated(connectDisconnect),
  "vault.connect_card.get": gated(connectGet),
  "vault.connect_card.may_discard": gated(connectMayDiscard),
  "vault.connect_card.options": gated(connectOptions),
  "vault.connect_card.reopen": gated(connectReopen),
  "vault.connect_card.submit": gated(connectSubmit),
  "vault.request": requestCreate,
  "vault.requests.cancel": requestsCancel,
  "vault.requests.decline": requestsDecline,
  "vault.requests.fulfil": requestsFulfil,
  "vault.requests.get": requestsGet,
  "vault.requests.list": requestsList,
};
