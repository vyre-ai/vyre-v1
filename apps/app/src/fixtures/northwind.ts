// Northwind (northwind.vyre.run): a small team Space. Copied from the prototype's seed(): four people besides the owner, six agents, five channels, eight Needs you items, nine chats.
import type { SpaceFixture } from "./types.ts";

export const northwind: SpaceFixture = {
  space: { key: "northwind", protoId: "nw", name: "Northwind", address: "northwind.vyre.run", team: true, role: "Owner" },
  me: "usr_irfad",
  people: [
    { id: "usr_irfad", name: "Irfad Imtiaz", role: "Owner" },
    { id: "usr_maya", name: "Maya Chen", role: "Admin", online: true },
    { id: "usr_omar", name: "Omar Haddad", role: "Member", online: true },
    { id: "usr_lena", name: "Lena Ortiz", role: "Member" },
    { id: "usr_sam", name: "Sam Patel", role: "Member" },
  ],
  agents: [
    { id: "agt_intake", name: "Intake", role: "Books consults and gathers client details", pinned: true, model: "opus" },
    { id: "agt_billing", name: "Billing", role: "Invoices and collections", pinned: true, model: "sonnet" },
    { id: "agt_research", name: "Research", role: "Market and competitor research", pinned: true, model: "gpt5" },
    { id: "agt_docs", name: "Docs", role: "Drafts letters and agreements", pinned: true, model: "opus" },
    { id: "agt_scout", name: "Scout", role: "Public records lookups", pinned: false, model: "kimi" },
    { id: "agt_assistant", name: "Assistant", role: "Your assistant in this Space", pinned: false, model: "opus" },
  ],
  channels: [
    { id: "ch_intake", name: "intake", topic: "New clients and consult bookings", members: ["usr_maya", "usr_omar", "usr_lena"], agents: ["agt_intake"], lead: "agt_intake", unread: true, mentions: 1 },
    { id: "ch_billing", name: "billing", topic: "Invoices, payments, collections", members: ["usr_lena", "usr_sam"], agents: ["agt_billing"] },
    { id: "ch_pruitt", name: "pruitt-matter", topic: "Everything for Marcus Pruitt", members: ["usr_maya", "usr_lena"], agents: ["agt_intake"], project: true },
    { id: "ch_atp", name: "atp-q4", topic: "ATP quarterly worksheets", members: ["usr_sam"], agents: ["agt_research"], project: true },
    { id: "ch_rivera", name: "rivera-matter", topic: "Everything for Elena Rivera", members: ["usr_maya"], agents: ["agt_docs", "agt_research"], private: true },
  ],
  needs: [
    { id: "n1", agent: "agt_billing", kind: "Approve", title: "Send 12 invoices", sub: "$18,420 total, due Friday", chat: "c3", at: "9:12" },
    { id: "n2", agent: "agt_docs", kind: "Review", title: "Rivera engagement letter", sub: "Draft from the standard template", chat: "c4", at: "8:50" },
    { id: "n3", agent: "agt_scout", kind: "Blocked", title: "County records search", sub: "Needs a login for the county site", chat: "c6", at: "8:31" },
    { id: "n4", agent: "agt_intake", kind: "Review", title: "Pruitt intake summary", sub: "Form came back, 2 fields unclear", chat: "c1", at: "9:10" },
    { id: "n5", agent: "agt_research", kind: "Approve", title: "Send the ATP reminder to Harlow & Price", sub: "Quarterly worksheet, due Nov 12", chat: "c2", at: "Yesterday" },
    { id: "n6", agent: "agt_assistant", kind: "Review", title: "Problem report from Omar", sub: "The intake form would not send", chat: "c7", at: "9:36" },
    { id: "n7", agent: "agt_billing", kind: "Blocked", title: "Month-end export is waiting on a sign-in", sub: "The wait outlived your Claude sign-in", chat: "c3", at: "9:14" },
    { id: "n8", agent: "agt_docs", kind: "Approve", title: "Send the Pruitt fee letter", sub: "Withdrawn", chat: "c4", at: "8:10" },
  ],
  chats: [
    { id: "c1", title: "Rivera intake", with: "agt_intake", at: "9:31", day: 0 },
    { id: "c3", title: "October invoices", with: "agt_billing", at: "9:12", day: 0, unread: true },
    { id: "c4", title: "Rivera engagement letter", with: "agt_docs", at: "8:50", day: 0, unread: true },
    { id: "d1", title: "Maya Chen", with: "usr_maya", at: "8:40", day: 0, unread: true, online: true },
    { id: "c6", title: "County records search", with: "agt_scout", at: "8:20", day: 0 },
    { id: "c2", title: "Competitor pricing", with: "agt_research", at: "Yesterday", day: 1, starred: true },
    { id: "d2", title: "Omar Haddad", with: "usr_omar", at: "Yesterday", day: 1, online: true },
    { id: "c5", title: "Weekly lead report", with: "agt_intake", at: "Mon", day: 2 },
    { id: "c7", title: "Plan the Q4 offsite", with: "agt_assistant", at: "Mon", day: 2 },
  ],
};
