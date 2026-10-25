// One handler per vault-requests capability (spec 2.17). They live in request.ts.
import { requestCreate, requestsCancel, requestsDecline, requestsFulfil, requestsGet, requestsList } from "./request.ts";

export const handlers = {
  "vault.request": requestCreate,
  "vault.requests.cancel": requestsCancel,
  "vault.requests.decline": requestsDecline,
  "vault.requests.fulfil": requestsFulfil,
  "vault.requests.get": requestsGet,
  "vault.requests.list": requestsList,
};
