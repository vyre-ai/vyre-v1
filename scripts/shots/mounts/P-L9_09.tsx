// Mount for P-L9_09: the EmailBuilder over the prototype's Northwind check-in email. Query (read after mount, ruling 25):
// ?view=visual|html|plain (not ?mode, which the shots harness uses for light or dark), ?focus=1, ?tab=style|ask|preview|checks, ?preview=desktop|mobile|dark, ?space=harbor for Harbor Studio's copy.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { EmailBuilder } from "../../../ui/src/EmailBuilder/index.tsx";
import type { EmailBlock, EmailDiff, EmailMode, EmailPreview, PaneTab } from "../../../ui/src/EmailBuilder/index.tsx";

export const title = "EmailBuilder";

const BLOCKS: readonly EmailBlock[] = [
  { id: "t0", kind: "text", text: "Hi {{first_name}}," },
  { id: "t1", kind: "text", text: "Spring is when planning picks up, so I am checking in with a few of the firms we have talked to. How is the season shaping up at {{company}}?" },
  { id: "t2", kind: "text", text: "If a short call helps, just reply." },
  { id: "m1", kind: "merge", field: "owner_name", text: "owner name" },
  { id: "ft", kind: "footer", text: "Northwind · 410 Market Street, San Francisco, CA", align: "center", unsub: true },
];
const CONTACTS = [
  { id: "c1", name: "Elena Rivera", values: { first_name: "Elena", company: "Harbor Studio", owner_name: "Maya" } },
  { id: "c2", name: "Omar Haddad", values: { first_name: "Omar", company: "Haddad Legal", owner_name: "Maya" } },
];
const TEMPLATES = [
  { id: "tp1", name: "Quick check-in", blocks: BLOCKS },
  { id: "tp2", name: "Blank", blocks: [] as readonly EmailBlock[] },
];
const SAVED = [{ id: "blk_1", name: "Sign-off", block: { id: "o", kind: "text" as const, text: "Warm regards, {{owner_name}}" } }, { id: "blk_2", name: "Follow us", shared: true, block: { id: "p", kind: "social" as const, align: "center" as const, links: [{ network: "linkedin" as const, url: "https://linkedin.com/company/northwind" }] } }];
const IDEAS = ["Quick check-in, {{first_name}}", "How is spring shaping up at {{company}}?", "A short note before the busy season", "{{first_name}}, one question about spring", "Checking in on {{company}}"];
const DIFFS: readonly EmailDiff[] = [
  { id: "d-subject", summary: "Shorter subject: It has been a while" },
  { id: "d-body", summary: "Name the spring offer in the second paragraph" },
  { id: "d-cta", summary: "Change the button to Book 15 minutes" },
];
const AGENTS = [{ id: "asst", name: "Assistant", assistant: true }, { id: "docs", name: "Docs", role: "Reviews and drafts documents" }, { id: "intake", name: "Intake", role: "Books first calls" }];

export default function Mount(): ReactNode {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => { setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "")); }, []);
  if (q === null) return <View style={{ flex: 1 }} />;
  const mode = (["visual", "html", "plain"].includes(q.get("view") ?? "") ? q.get("view") : "visual") as EmailMode;
  const tab = (["style", "ask", "preview", "checks"].includes(q.get("tab") ?? "") ? q.get("tab") : "style") as PaneTab;
  const preview = (["desktop", "mobile", "dark"].includes(q.get("preview") ?? "") ? q.get("preview") : "desktop") as EmailPreview;
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <EmailBuilder id="em-q4" title="Q4 check-in" subject="Quick check-in, {{first_name}}" previewText=""
        mode={mode} focus={q.get("focus") === "1"} paneTab={tab} preview={preview} blocks={BLOCKS} diffs={DIFFS} version={3} contacts={CONTACTS} templates={TEMPLATES} subjectIdeas={IDEAS} savedBlocks={SAVED} comments={[{ id: "k1", by: "Maya Chen", text: "Keep it under three lines." }]}
        fromName="Maya Chen · Northwind" testTo="Irfad Imtiaz" brand={{ name: "Northwind", color: "#5B5BD6", font: "Inter" }}
        askThread={[{ from: "you", text: "Make it warmer and shorter, then add a P.S." }, { from: "assistant", text: "I softened the opening and made the second paragraph more reassuring. Your merge fields are untouched. I added a short P.S. above the footer." }]}
        ask={{ place: "email", context: { kind: "email", id: "em-q4", title: "Q4 check-in", access: "edit" }, agents: AGENTS, onAsk: () => undefined }} />
    </View>
  );
}
