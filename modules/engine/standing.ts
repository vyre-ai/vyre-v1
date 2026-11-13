// Who has standing in the Space (lane f-guest, 14 Nov 2026). No agent turn starts for a person who has none: a guest has no AI account in the Space and must not spend a member's or steer an agent. Standing is what the
// kernel says now, never the name of a role: a role cloned from Guest is an outsider too, and a guest promoted to member is a member on their next message. The question is put to the real pipeline as the person: a read
// that needs View on the Space (chat.history.search, with no words so it reads nothing) is refused with a permission error to someone who has none. Nothing is kept: a kept answer would have to be dropped by an event
// on a consumer of its own, which can run after the message it should have been dropped for.
type Call = (cap: string, input: unknown) => Promise<unknown>;

/** Does this person lack View on the Space? Any answer but a permission refusal counts as standing, as before this rule. */
export async function isOutsider(asPerson: Call): Promise<boolean> {
  try {
    await asPerson("chat.history.search", { q: "" });
    return false;
  } catch (e) {
    const err = e as { code?: unknown; error?: { code?: unknown }; message?: unknown };
    return /^permission\./.test(String(err.code ?? err.error?.code ?? ""));
  }
}
