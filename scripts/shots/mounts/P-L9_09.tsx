// Mount for P-L9_09: the EmailBuilder over the prototype's Northwind check-in email. Query (read after mount, ruling 25):
// ?mode=visual|html|plain, ?focus=1, ?tab=style|ask|preview|checks, ?preview=desktop|mobile|dark, ?space=harbor for Harbor Studio's copy.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { EmailBuilder } from "../../../ui/src/EmailBuilder/index.tsx";
import type { EmailBlock, EmailDiff, EmailMode, EmailPreview, PaneTab } from "../../../ui/src/EmailBuilder/index.tsx";

export const title = "EmailBuilder";

const BLOCKS: readonly EmailBlock[] = [
  { id: "img", kind: "image", text: "Northwind, a fresh start" },
  { id: "h", kind: "text", text: "It has been a while, {{first_name|there}}" },
  { id: "t1", kind: "text", text: "Hi {{first_name|there}}, it has been a few months since we last spoke. A lot has changed at Northwind since then, and I wanted to check in on {{company|your team}} personally." },
  { id: "t2", kind: "text", text: "If anything slipped while things were busy, we can pick it up with a short call. No prep needed on your side, and I will bring a one-page summary of where things stand." },
  { id: "btn", kind: "button", text: "Book a 20 minute catch-up" },
  { id: "ft", kind: "text", text: "Northwind, 410 Market Street, San Francisco, CA. You are getting this because you worked with Northwind." },
];
const DIFFS: readonly EmailDiff[] = [
  { id: "d-subject", summary: "Shorter subject: It has been a while" },
  { id: "d-body", summary: "Name the spring offer in the second paragraph" },
  { id: "d-cta", summary: "Change the button to Book 15 minutes" },
];
const AGENTS = [{ id: "asst", name: "Assistant", assistant: true }, { id: "docs", name: "Docs", role: "Reviews and drafts documents" }, { id: "intake", name: "Intake", role: "Books first calls" }];

export default function Mount(): ReactNode {
  const { height } = useWindowDimensions();
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => { setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "")); }, []);
  if (q === null) return <View style={{ height }} />;
  const mode = (["visual", "html", "plain"].includes(q.get("mode") ?? "") ? q.get("mode") : "visual") as EmailMode;
  const tab = (["style", "ask", "preview", "checks"].includes(q.get("tab") ?? "") ? q.get("tab") : "style") as PaneTab;
  const preview = (["desktop", "mobile", "dark"].includes(q.get("preview") ?? "") ? q.get("preview") : "desktop") as EmailPreview;
  return (
    <View style={{ height }}>
      <EmailBuilder id="em-q4" title="Q4 check-in" subject="It has been a while, {{first_name|there}}" previewText="A short note from Maya at Northwind, and one way to pick things back up."
        mode={mode} focus={q.get("focus") === "1"} paneTab={tab} preview={preview} blocks={BLOCKS} diffs={DIFFS} version={3} mergeValues={{ first_name: "Elena", company: "Rivera Holdings" }}
        html={mode === "html" ? "<table width=\"100%\"><tr><td><h1>It has been a while</h1><p>Hi Elena,</p></td></tr></table>" : ""}
        ask={{ place: "email", context: { kind: "email", id: "em-q4", title: "Q4 check-in", access: "edit" }, agents: AGENTS, onAsk: () => undefined }} />
    </View>
  );
}
