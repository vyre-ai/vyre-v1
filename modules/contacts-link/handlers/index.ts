// One handler per contacts-link capability: the match rule and addresses (match.ts), duplicates (match.ts), preferences, deliverability and
// owner routing (prefs.ts), the suppression list and opt-outs (suppression.ts), and Do-not-contact screening (dnd.ts).
import { addressAdd, addressList, addressRemove, addressSetPrimary, duplicatesDismiss, duplicatesList, resolve } from "./match.ts";
import { deliverability, preferencesGet, preferencesSet, routeOwner } from "./prefs.ts";
import { applyOptout, suppressionAdd, suppressionCheck, suppressionImport, suppressionList, suppressionRemove } from "./suppression.ts";
import { dndScreen } from "./dnd.ts";

export {
  addressAdd, addressList, addressRemove, addressSetPrimary, applyOptout, deliverability, dndScreen, duplicatesDismiss, duplicatesList, preferencesGet, preferencesSet, resolve,
  routeOwner, suppressionAdd, suppressionCheck, suppressionImport, suppressionList, suppressionRemove,
};
