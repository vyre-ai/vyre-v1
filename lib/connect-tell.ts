// What an agent is told after it asks to connect a service (vault_connect): one line, what to do next, and nothing a person is spared. The words handle, folder, clearance and role never appear here; the card carries what a
// person must know. Kept in lib so the handler and the tests that hold its length read the same words.
export type ConnectStatus = "connected" | "waiting_person" | "waiting_admin" | "declined";

export const TELL = {
  connected: (t: string) => `${t} is connected. Say so in one line and carry on with the question.`,
  waiting_person: (t: string) =>
    `The person has a card to connect ${t}. Say one short line, nothing more, and wait: you are told when it is done.`,
  waiting_admin: (t: string) =>
    `The person cannot connect ${t} themselves and the card offers to ask an admin. Say one short line and wait.`,
  declined: (t: string) =>
    `The person chose not to connect ${t} now. Carry on without it and do not ask again unless they do.`,
} as const;
