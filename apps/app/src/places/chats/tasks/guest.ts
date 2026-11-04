// A task given to a guest: what the guest will be able to see, said before it is saved. No React here.
import type { useMenu } from "../../../../../../ui/src/Menu/index.tsx";

/** What a guest sees of a task given to them, in plain words. */
export const guestNote = (name: string): string => `${name} is a guest. Giving them this task lets them see the task, its chat and its files.`;

type Show = ReturnType<typeof useMenu>["show"];

/** Give now, or, for a guest, ask first: the menu says what they will see and offers to go ahead or cancel. */
export function giveWithCare(show: Show, seat: { name: string; guest?: boolean | undefined }, at: { x: number; y: number }, go: () => void): void {
  if (seat.guest !== true) { go(); return; }
  show([{ head: guestNote(seat.name) }, { label: `Give it to ${seat.name}`, onSelect: go }, { label: "Cancel", onSelect: () => undefined }], at.x, at.y, "other", { label: "Guest" });
}
