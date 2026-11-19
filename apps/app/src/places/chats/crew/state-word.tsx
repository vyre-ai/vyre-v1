// A helper's state beside its name: the words ("Working", "Needs you", "Done", "Stopped"), except Failed, which is the shared triangle mark (owner, 19 Nov 2026: indicators, not words; the word is its tip and
// its accessible name). A filter menu keeps the word, since a menu item is a choice and not a status.
import type { ReactElement } from "react";
import { StateMark } from "../../../../../../ui/src/Status/StateMark.tsx";
import { stateWord } from "./model.ts";
import type { MemberState } from "./model.ts";

/** The state as text for a parent <Text>: the word, or the mark for Failed. */
export function stateWordOrMark(state: MemberState, testID?: string): ReactElement | string {
  return state === "failed" ? <StateMark state="failed" size={14} {...(testID ? { testID } : {})} /> : stateWord(state);
}
