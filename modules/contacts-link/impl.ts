// contacts-link module entry (lane L5). The host loads the generated stubs while manifests/contacts-link.ts says `status: 'stub'`; the last
// packet of the module flips it to live, after the contract tests pass against these handlers.
//
// Contact and company records are stored by the records module; this module reads and writes them through records.get, records.query and
// records.update, and keeps its own address index, suppression list and dismissed duplicate suggestions.
import type { Handler } from "../../host/src/invoke.ts";
import {
  addressAdd, addressList, addressRemove, addressSetPrimary, applyOptout, deliverability, dndScreen, duplicatesDismiss, duplicatesList, preferencesGet, preferencesSet, resolve,
  routeOwner, suppressionAdd, suppressionCheck, suppressionImport, suppressionList, suppressionRemove,
} from "./handlers/index.ts";

export const handlers: Record<string, Handler> = {
  "contacts.resolve": (ctx, input) => resolve(ctx, input),
  "contacts.address.list": (ctx, input) => addressList(ctx, input),
  "contacts.address.add": (ctx, input) => addressAdd(ctx, input),
  "contacts.address.remove": (ctx, input) => addressRemove(ctx, input),
  "contacts.address.set_primary": (ctx, input) => addressSetPrimary(ctx, input),
  "contacts.preferences.get": (ctx, input) => preferencesGet(ctx, input),
  "contacts.preferences.set": (ctx, input) => preferencesSet(ctx, input),
  "contacts.deliverability": (ctx, input) => deliverability(ctx, input),
  "contacts.route_owner": (ctx, input) => routeOwner(ctx, input),
  "contacts.suppression.list": (ctx, input) => suppressionList(ctx, input),
  "contacts.suppression.check": (ctx, input) => suppressionCheck(ctx, input),
  "contacts.suppression.add": (ctx, input) => suppressionAdd(ctx, input),
  "contacts.suppression.remove": (ctx, input) => suppressionRemove(ctx, input),
  "contacts.suppression.import": (ctx, input) => suppressionImport(ctx, input),
  "contacts.apply_optout": (ctx, input) => applyOptout(ctx, input),
  "contacts.dnd_screen": (ctx, input) => dndScreen(ctx, input),
  "contacts.duplicates.list": (ctx, input) => duplicatesList(ctx, input),
  "contacts.duplicates.dismiss": (ctx, input) => duplicatesDismiss(ctx, input),
};

export const projections = { inline: {}, consumers: {} };
