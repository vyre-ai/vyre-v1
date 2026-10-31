// Settings > This computer > Your sessions: one row to bring sessions in (the same picker as onboarding, opened in place) and the archive as shared rows.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import { archiveRow } from "./session-import-model.ts";
import { useSettingsData } from "./data.tsx";
import { Mark } from "../../onboarding/ProviderLogo.tsx";
import { SessionsCard } from "../../onboarding/SessionsCard.tsx";
import { Section, SettingsRow, SmallButton } from "./ui.tsx";
interface Archive { conversationId: string; title: string; provider: string; startedAt?: number; projectId?: string }
interface Tool { name: string; summary: string; ok?: boolean }
interface Transcript { session: Archive; messages: { role: string; text: string; tools?: Tool[] }[] }
const toolLine = (t: Tool): string => `${t.summary || t.name}${t.ok === false ? " (failed)" : ""}`;
const pad = { padding: 12, gap: 8 } as const;
export function SessionImport(): ReactElement | null {
  const data = useSettingsData();
  const personal = data.spaces.some((s) => s.current && s.kind === "personal");
  const [picking, setPicking] = useState(false);
  const [archives, setArchives] = useState<Archive[]>([]);
  const [next, setNext] = useState<string | undefined>();
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (work: () => Promise<void>): Promise<void> => { setBusy(true); setError(""); try { await work(); } catch (e) { setError(e instanceof Error ? e.message : "That did not work. Try again."); } finally { setBusy(false); } };
  const load = async (cursor?: string): Promise<void> => {
    const out = await data.call("sessions.list", { ...(cursor ? { cursor } : {}) }) as { sessions: Archive[]; next?: string };
    setArchives((old) => cursor ? [...old, ...out.sessions] : out.sessions); setNext(out.next);
  };
  // The archive is optional on first paint: a server without it shows no rows, never a raw error.
  useEffect(() => { if (personal) void load().catch(() => setArchives([])); }, [personal, data.call]);
  if (!personal) return null;
  const now = data.clock().now;
  const list: ReactElement[] = [];
  archives.forEach((a) => {
    const r = archiveRow(a, now);
    list.push(<SettingsRow key={a.conversationId} id={`session.${a.conversationId}`} label={r.title} {...(r.note ? { sub: r.note } : {})} lead={<Mark k={r.mark} size={18} />}
      control={<SmallButton label="Open" disabled={busy} testID={`open-${a.conversationId}`} onPress={() => void run(async () => setTranscript(await data.call("sessions.get", { conversationId: a.conversationId }) as Transcript))} />} />);
  });
  return <Section title="Your sessions">
    <SettingsRow id="sessions.bring" first label="Bring your sessions"
      control={data.sessionImporter ? <SmallButton label={picking ? "Close" : "Find sessions"} testID="sessions-discover" onPress={() => setPicking((v) => !v)} /> : <Text style={{ fontSize: 12.5, color: "var(--ink-3)" as string }}>Desktop app only</Text>} />
    {picking && data.sessionImporter ? <View style={pad}><SessionsCard call={data.call as never} onDone={() => { setPicking(false); void run(() => load()); }} /></View> : null}
    {error ? <View style={pad}><Text accessibilityRole="alert" style={{ color: "var(--danger)" as string }}>{error}</Text></View> : null}
    {list}
    {next ? <SettingsRow id="sessions.more" label="More sessions" onPress={() => void run(() => load(next))} /> : null}
    {transcript ? <View testID="sessions-transcript" style={pad}><Text accessibilityRole="header">{transcript.session.title}</Text>
      {/* ui-rows-lint: not a list (immutable transcript paragraphs preserve message bodies) */}
      {transcript.messages.map((m, i) => <View key={i}><Text>{m.role}</Text>{m.text ? <Text selectable>{m.text}</Text> : null}{(m.tools ?? []).map((t, j) => <Text key={j} selectable>{`Tool: ${toolLine(t)}`}</Text>)}</View>)}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <SmallButton label="Close" onPress={() => setTranscript(null)} />
        {data.continueSession ? <SmallButton label="Continue with your assistant" disabled={busy} testID="sessions-continue" onPress={() => void run(() => data.continueSession!(transcript.session.conversationId))} /> : null}
      </View>
    </View> : null}
  </Section>;
}
