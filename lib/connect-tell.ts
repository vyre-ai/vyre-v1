// What an agent is told after it asks to connect a service (vault_connect): one line, what to do next, and nothing a person is spared. The words handle, folder, clearance and role never appear here; the card carries what a
// person must know. Kept in lib so the handler and the tests that hold its length read the same words.
export type ConnectStatus = "connected" | "waiting_person" | "waiting_admin" | "declined" | "no_connector";

export const TELL = {
  connected: (t: string) => `${t} is connected. Say so in one line and carry on with the question.`,
  waiting_person: (t: string) =>
    `The person has a card to connect ${t}. Say one short line, nothing more, and wait: you are told when it is done.`,
  waiting_admin: (t: string) =>
    `The person cannot connect ${t} themselves and the card offers to ask an admin. Say one short line and wait.`,
  declined: (t: string) =>
    `The person chose not to connect ${t} now. Carry on without it; they can press Connect on the card if they want it.`,
  no_connector: (t: string) =>
    `No connector for ${t} yet. Build one from its docs (connectors_init, connectors_define, connectors_publish), then call vault_connect again. One line to the person.`,
} as const;
