// Ask Vyre in Records opens the shared Ask pane of the shell (shell/ask/pane.ts) beside the page: never a navigation. No React here.
import { openAskPane } from "../../../shell/ask/pane.ts";
import { ASK_SCOPE, askContext, askHint, askScopeId } from "./model.ts";
import type { AskAbout } from "./model.ts";

/** The Records pane: one thread per record type, one for the Record types page, one for the place (the scopes it always had), with the Records focus skill and what it may propose. */
export function openRecordsAsk(about: AskAbout, typeTitle?: string): void {
  const scopeId = askScopeId(about);
  const title = about.making !== undefined ? (about.making ? `New type ${about.making}` : "A new record type") : about.page === "types" ? "Record types" : about.type ? typeTitle ?? about.type : undefined;
  openAskPane({ thing: scopeId === "place" && about.making === undefined ? null : { kind: ASK_SCOPE, id: scopeId, ...(title ? { title } : {}) }, hint: askHint(about), context: askContext(about, typeTitle) }, "records");
}
