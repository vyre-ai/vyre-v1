// The Northwind sample the shots and tests use: the lists the prototype's Home sidebar shows.
import type { HomeSidebarData } from "./model.ts";

export const SAMPLE_HOME_SIDEBAR: HomeSidebarData = {
  counts: { myWork: 5, assigned: 3, runs: 3 },
  starred: [
    { id: "s1", title: "dev server", note: "Running · compiled /intake in 412", kind: "terminal", target: { place: "chats", hash: "terminal:dev" } },
    { id: "s2", title: "Morning lead sweep", kind: "automation", target: { place: "automations", hash: "morning-lead-sweep" } },
    { id: "s3", title: "rivera-engagement-letter.docx", kind: "file", target: { place: "files", hash: "rivera-engagement-letter.docx" } },
    { id: "s4", title: "Rivera matter", kind: "project", target: { place: "records", hash: "rivera-matter" } },
    { id: "s5", title: "Morning briefing", kind: "assistant", target: { place: "chats", hash: "morning-briefing" } },
  ],
  following: [
    { id: "f1", title: "Rivera matter", kind: "project", target: { place: "records", hash: "rivera-matter" } },
    { id: "f2", title: "Pruitt engagement", kind: "project", target: { place: "records", hash: "pruitt-engagement" } },
    { id: "f3", title: "ATP · Harlow & Price", kind: "project", target: { place: "records", hash: "atp-harlow-price" } },
    { id: "f4", title: "Waive the consult fee for referrals", kind: "chat", target: { place: "chats", hash: "waive-consult-fee" } },
    { id: "f5", title: "Q4 billing", kind: "project", target: { place: "records", hash: "q4-billing" } },
  ],
  recent: [
    { id: "r1", title: "rivera-engagement-letter.docx", kind: "file", target: { place: "files", hash: "rivera-engagement-letter.docx" } },
    { id: "r2", title: "Morning lead sweep", kind: "automation", target: { place: "automations", hash: "morning-lead-sweep" } },
    { id: "r3", title: "Q4 billing", kind: "project", target: { place: "records", hash: "q4-billing" } },
    { id: "r4", title: "Pruitt engagement", kind: "project", target: { place: "records", hash: "pruitt-engagement" } },
    { id: "r5", title: "October invoices", kind: "agent", target: { place: "chats", hash: "october-invoices" } },
  ],
};
