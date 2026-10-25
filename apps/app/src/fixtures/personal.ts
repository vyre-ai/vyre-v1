// Personal (only on this computer): one person, the assistant and three chats. Copied from the prototype's seedFor("personal").
import type { SpaceFixture } from "./types.ts";

export const personal: SpaceFixture = {
  space: { key: "personal", protoId: "me", name: "Personal", address: "on this computer", team: false },
  me: "usr_irfad",
  people: [{ id: "usr_irfad", name: "Irfad Imtiaz", role: "Owner" }],
  agents: [{ id: "agt_assistant", name: "Assistant", role: "Your assistant", pinned: true, model: "opus" }],
  channels: [],
  needs: [],
  chats: [
    { id: "m1", title: "Plan the week", with: "agt_assistant", at: "8:05", day: 0 },
    { id: "m2", title: "Flights to Kuala Lumpur", with: "agt_assistant", at: "Yesterday", day: 1, starred: true },
    { id: "m3", title: "Tax papers checklist", with: "agt_assistant", at: "Mon", day: 2 },
  ],
};
