// Harbor Studio (harbor.vyre.run): a photography studio Space. Copied from the prototype's seedFor("harbor"): three people, Scheduler, Proofer and the assistant, the studio and galleries
// channels, two Needs you items and the Moreno chats.
import type { SpaceFixture } from "./types.ts";

export const harbor: SpaceFixture = {
  space: { key: "harbor", protoId: "hb", name: "Harbor Studio", address: "harbor.vyre.run", team: true, role: "Member", unread: 2 },
  me: "usr_june",
  people: [
    { id: "usr_theo", name: "Theo Lindqvist", role: "Owner", online: true },
    { id: "usr_june", name: "June Okafor", role: "Member" },
    { id: "usr_ines", name: "Ines Costa", role: "Admin" },
  ],
  agents: [
    { id: "agt_scheduler", name: "Scheduler", role: "Books sessions and sends reminders", pinned: true, model: "sonnet" },
    { id: "agt_proofer", name: "Proofer", role: "Sends galleries and collects picks", pinned: true, model: "opus" },
    { id: "agt_assistant", name: "Assistant", role: "Your assistant in this Space", pinned: false, model: "opus" },
  ],
  channels: [
    { id: "ch_studio", name: "studio", topic: "Shoots, schedules and gear", members: ["usr_theo", "usr_june"], agents: ["agt_scheduler"], lead: "agt_scheduler" },
    { id: "ch_galleries", name: "galleries", topic: "Proofs and client picks", members: ["usr_theo", "usr_ines"], agents: ["agt_proofer"], unread: true, mentions: 1 },
  ],
  needs: [
    { id: "n1", agent: "agt_proofer", kind: "Approve", title: "Send the Moreno gallery", sub: "84 photos, link lasts 14 days", chat: "h2", at: "9:05" },
    { id: "n2", agent: "agt_scheduler", kind: "Review", title: "Saturday call sheet", sub: "Draft for the Moreno shoot", chat: "h1", at: "8:41" },
  ],
  chats: [
    { id: "h1", title: "Moreno shoot Saturday", with: "agt_scheduler", at: "8:41", day: 0, unread: true },
    { id: "h2", title: "Moreno gallery", with: "agt_proofer", at: "9:05", day: 0, unread: true },
    { id: "hd1", title: "Theo Lindqvist", with: "usr_theo", at: "8:30", day: 0, online: true },
    { id: "h3", title: "Studio gear list", with: "agt_assistant", at: "Yesterday", day: 1, starred: true },
  ],
};
