// One handler per vault-requests capability (spec 2.17). They live in request.ts.
import {
  connectAskAdmin,
  connectDisconnect,
  connectGet,
  connectOptions,
  connectReopen,
  connectService,
  connectSubmit,
} from "./connect.ts";
import {
  requestCreate,
  requestsCancel,
  requestsDecline,
  requestsFulfil,
  requestsGet,
  requestsList,
} from "./request.ts";

export const handlers = {
  "vault.connect": connectService,
  "vault.connect_card.ask_admin": connectAskAdmin,
  "vault.connect_card.disconnect": connectDisconnect,
  "vault.connect_card.get": connectGet,
  "vault.connect_card.options": connectOptions,
  "vault.connect_card.reopen": connectReopen,
  "vault.connect_card.submit": connectSubmit,
  "vault.request": requestCreate,
  "vault.requests.cancel": requestsCancel,
  "vault.requests.decline": requestsDecline,
  "vault.requests.fulfil": requestsFulfil,
  "vault.requests.get": requestsGet,
  "vault.requests.list": requestsList,
};
