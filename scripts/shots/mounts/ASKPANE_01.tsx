// Mount for ASKPANE_01 (lane l-askpane, rc.17): Ask Vyre opens in the one shared pane on the right of the place, beside the thing, never in Chats. ?part=
//   records (a client's record page with the pane about the record), file (the Files viewer with the pane about the file), vault (the Vault with the pane about an item),
//   settings (Settings > Appearance with the pane about the page). Each pane holds a short Ask conversation over a scripted runtime.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { AskPaneHost } from "../../../apps/app/src/shell/ask/host.tsx";
import { openAskPane, resetAskPanes } from "../../../apps/app/src/shell/ask/pane.ts";
import type { AskRequest } from "../../../apps/app/src/shell/ask/pane.ts";
import { screenFromHash, setScreenContext } from "../../../apps/app/src/shell/ask/screen.ts";
import { ShellRuntimeProvider } from "../../../apps/app/src/shell/providers/runtime.tsx";
import type { ShellRuntime } from "../../../apps/app/src/shell/providers/runtime.tsx";
import { createSample } from "../../../apps/app/src/places/chats/conversation/sample.ts";
import { RecordPage, RecordPageDataProvider } from "../../../apps/app/src/places/records/recordpage/index.ts";
import { createSamplePage } from "../../../apps/app/src/places/records/recordpage/sample.ts";
import { FileViewer } from "../../../apps/app/src/places/files/viewer/FileViewer.tsx";
import { FilesViewerDataProvider } from "../../../apps/app/src/places/files/viewer/data.tsx";
import { createSampleViewer } from "../../../apps/app/src/places/files/viewer/sample.ts";
import Vault from "../../../apps/app/src/places/vault/layout/index.tsx";
import { createSampleVault } from "../../../apps/app/src/places/vault/layout/sample.ts";
import { SettingsDataProvider } from "../../../apps/app/src/places/settings/data.tsx";
import { SettingsPlace } from "../../../apps/app/src/places/settings/SettingsPlace.tsx";
import { createSampleSettings } from "../../../apps/app/src/places/settings/sample.ts";

export const title = "Ask Vyre in a pane beside the thing";

const NOW = Date.UTC(2025, 9, 24, 10, 0, 0);
const ME = { kind: "person" as const, id: "usr_irfad" };
const AI = { kind: "agent" as const, id: "agt_assistant" };
const PEOPLE = [{ id: "usr_irfad", name: "Irfad Imtiaz", kind: "person" }, { id: "agt_assistant", name: "Assistant", kind: "agent" }, { id: "agt_billing", name: "Billing", kind: "agent" }, { id: "usr_maya", name: "Maya Chen", kind: "person" }];

interface Part { place: string; ask: AskRequest; talk: [typeof ME | typeof AI, string][] }
const PARTS: Record<string, Part> = {
  records: {
    place: "records", ask: { thing: { kind: "record", id: "cl_0", title: "Elena Rivera" } },
    talk: [[ME, "What is still open before we can start her matter?"], [AI, "Two things: the signed engagement letter and the retainer. Maya marked the consult as done on Tuesday. Want me to draft a reminder to Elena?"]],
  },
  file: {
    place: "files", ask: { thing: { kind: "file", id: "f_note", title: "Consult fee.md" } },
    talk: [[ME, "Is this fee the same as the one on the website?"], [AI, "No. The note says **$250**, the website says $200. Omar asked to confirm it with Maya before it goes out."]],
  },
  vault: {
    place: "vault", ask: { thing: { kind: "vault_item", id: "vit_ghl", title: "GoHighLevel" } },
    talk: [[ME, "Which automations use this key?"], [AI, "Two: **New lead to GoHighLevel** and **Nightly pipeline sync**. The key was last rotated 214 days ago, past its 90-day rule."]],
  },
  settings: {
    place: "settings", ask: { thing: { kind: "settings_page", id: "appearance", title: "Appearance" } },
    talk: [[ME, "Can the app follow my Mac's dark mode?"], [AI, "It already does. **Vyre**, your skin now, is light by day and black by night, following your Mac. A skin like Graphite or Paper stays one way."]],
  },
};

/** A runtime whose Ask thread is the conversation sample, rewritten as this part's short Ask. */
function askRuntime(part: Part): ShellRuntime {
  const s = createSample("idle");
  const old = (s.replica.rows("messages") as unknown as { id: string }[]).map((r) => r.id);
  s.replica.remove("messages", old);
  const thread = (s.replica.rows("threads") as unknown as Record<string, unknown>[])[0]!;
  s.replica.put("threads", [{ ...thread, kind: "ask", title: `Ask about ${part.ask.thing?.title ?? ""}`, listed: false, members: [{ kind: "person", id: "usr_irfad" }, { kind: "agent", id: "agt_assistant" }], agents: [{ agentId: "agt_assistant", mode: "lead", model: "sonnet" }] }] as never);
  s.replica.put("messages", part.talk.map(([author, body], i) => ({ id: `a${i}`, messageId: `a${i}`, threadId: "c1", threadSeq: i + 1, author, kind: author.kind === "agent" ? "agent" : "text", body, blocks: [], depth: 0, attachments: [], reactions: [], pinned: false, createdAt: NOW - (part.talk.length - i) * 60_000 })) as never);
  const everyone = { status: "ready" as const, data: PEOPLE };
  return {
    screens: s.data.screens,
    call: async (cap: string, input: unknown) => {
      if (cap === "chat.asks_of") return { threads: [{ threadId: "c1", agents: [{ agentId: "agt_assistant", mode: "lead" }] }], total: 1 };
      if (cap === "agents.list") return { agents: [{ agentId: "agt_assistant", name: "Assistant", kind: "assistant", ownerId: "usr_irfad" }, { agentId: "agt_billing", name: "Billing", kind: "agent" }] };
      return s.data.call(cap, input);
    },
    connection: { get: () => "online", subscribe: () => () => undefined },
    principals: { subscribe: () => () => undefined, getSnapshot: () => everyone },
    recordTitle: () => undefined, me: { id: "usr_irfad", name: "Irfad Imtiaz", kind: "person" }, clock: () => ({ now: NOW, offsetMin: 0 }),
    space: { id: "northwind", kind: "team", name: "Northwind" }, assistant: { id: "agt_assistant", name: "Assistant" },
    aiConnected: true, calendarConnected: true, deferredModules: new Set<string>(), isDeferred: () => false,
    open: () => undefined, openUrl: () => undefined,
  } as unknown as ShellRuntime;
}

function PlaceBody({ part }: { part: string }): ReactNode {
  const page = useMemo(() => createSamplePage(), []);
  const viewer = useMemo(() => createSampleViewer(), []);
  const vault = useMemo(() => createSampleVault(), []);
  const settings = useMemo(() => createSampleSettings(), []);
  if (part === "file") return <FilesViewerDataProvider value={viewer.data}><FileViewer fileId="f_note" /></FilesViewerDataProvider>;
  if (part === "vault") return <Vault data={vault.data} />;
  if (part === "settings") return <SettingsDataProvider value={{ ...settings.data, ask: () => undefined }}><SettingsPlace initialPage="appearance" /></SettingsDataProvider>;
  return <RecordPageDataProvider value={{ ...page.data, nav: { ...page.data.nav, ask: () => undefined } }}><RecordPage type="clients" recordId="cl_0" start={{ all: true, pane: false }} /></RecordPageDataProvider>;
}

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "records"), []);
  const p = PARTS[part ?? "records"] ?? PARTS["records"]!;
  const rt = useMemo(() => askRuntime(p), [p]);
  useEffect(() => {
    if (part === null) return;
    resetAskPanes();
    setScreenContext(screenFromHash(p.place, ""));
    openAskPane(p.ask, p.place);
  }, [part, p]);
  if (part === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  return (
    <ShellRuntimeProvider value={rt}>
      <View style={{ flex: 1, minHeight: 760, flexDirection: "row", backgroundColor: "var(--win)" as string }}>
        <AskPaneHost place={p.place} rt={rt}><PlaceBody part={part} /></AskPaneHost>
      </View>
    </ShellRuntimeProvider>
  );
}
