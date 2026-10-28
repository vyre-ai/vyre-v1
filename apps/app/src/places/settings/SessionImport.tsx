// Local bodies are opened only after a person selects a source; writes require a separate confirmation.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import type { SessionPayload, SessionSource } from "../../../../../client/src/session-import/parse.ts";
import { confirmedSessionInput } from "./session-import-model.ts";
import { useSettingsData } from "./data.tsx";
import { Section, SettingsRow, SmallButton } from "./ui.tsx";
interface Archive { conversationId: string; title: string; provider: string; projectId?: string }
interface Transcript { session: Archive; messages: { role: string; text: string }[] }
export function SessionImport(): ReactElement | null {
  const data = useSettingsData();
  const personal = data.spaces.some((s) => s.current && s.kind === "personal");
  const [sources, setSources] = useState<SessionSource[]>([]);
  const [preview, setPreview] = useState<{ source: SessionSource; session: SessionPayload; at: number } | null>(null);
  const [archives, setArchives] = useState<Archive[]>([]);
  const [next, setNext] = useState<string | undefined>();
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const run = async (work: () => Promise<void>): Promise<void> => { setBusy(true); setError(""); try { await work(); } catch (e) { setError(e instanceof Error ? e.message : "That did not work. Try again."); } finally { setBusy(false); } };
  const load = async (cursor?: string): Promise<void> => {
    const out = await data.call("sessions.list", { ...(cursor ? { cursor } : {}) }) as { sessions: Archive[]; next?: string };
    setArchives((old) => cursor ? [...old, ...out.sessions] : out.sessions); setNext(out.next);
  };
  useEffect(() => { if (personal) void run(() => load()); }, [personal, data.call]);
  if (!personal) return null;
  return <Section title="Imported coding sessions">
    <Text>Copy selected Codex and Claude Code history into this Personal Space. Review the visible messages before confirming. Original sessions stay on your computer.</Text>
    {data.sessionImporter ? <SmallButton label="Find local sessions" testID="sessions-discover" disabled={busy} onPress={() => void run(async () => { setSources(await data.sessionImporter!.discover()); setPreview(null); setNotice(""); })} /> : <Text>Open the desktop app to import local sessions.</Text>}
    {sources.map((source) => <SettingsRow key={source.sessionKey} id={source.sessionKey} label={`${source.provider === "codex" ? "Codex" : "Claude Code"}: ${source.sessionId}`} sub={source.cwd ?? "Local session"} control={<SmallButton label="Preview" disabled={busy} testID={`preview-${source.sessionKey}`} onPress={() => void run(async () => { const session = await data.sessionImporter!.preview(source); setPreview({ source, session, at: data.clock().now }); })} />} />)}
    {preview ? <View testID="sessions-preview">
      <Text accessibilityRole="header">{preview.session.title}</Text>
      <Text>{preview.session.repo?.root && preview.session.repo?.remote ? `Personal project: ${preview.session.repo.root}` : "Personal imported sessions"}</Text>
      <Text>{`${preview.session.messages.length} visible messages will be copied`}</Text>
      {preview.session.messages.map((m) => <View key={m.sourceMessageId}><Text>{m.role}</Text><Text selectable>{m.text}</Text></View>)}
      <SmallButton label="Cancel preview" disabled={busy} onPress={() => setPreview(null)} />
      <SmallButton label="Confirm import into Personal" testID="sessions-confirm" disabled={busy || !preview.session.messages.length} onPress={() => void run(async () => {
        await data.call("sessions.import", confirmedSessionInput(preview, data.clock().now));
        setPreview(null); setSources([]); setNotice("Session copied into your Personal archive."); await load();
      })} />
    </View> : null}
    {notice ? <Text>{notice}</Text> : null}
    {error ? <Text accessibilityRole="alert">{error}</Text> : null}
    {archives.map((a) => <SettingsRow key={a.conversationId} id={a.conversationId} label={a.title} sub={`${a.provider} · ${a.projectId ? "Personal project" : "Imported sessions"}`} control={<SmallButton label="Read archive" disabled={busy} onPress={() => void run(async () => setTranscript(await data.call("sessions.get", { conversationId: a.conversationId }) as Transcript))} />} />)}
    {next ? <SmallButton label="More sessions" disabled={busy} onPress={() => void run(() => load(next))} /> : null}
    {transcript ? <View testID="sessions-transcript"><Text accessibilityRole="header">{transcript.session.title}</Text>{transcript.messages.map((m, i) => <View key={i}><Text>{m.role}</Text><Text selectable>{m.text}</Text></View>)}
      <SmallButton label="Close archive" onPress={() => setTranscript(null)} />
      {data.continueSession ? <SmallButton label="Continue with your assistant" disabled={busy} testID="sessions-continue" onPress={() => void run(() => data.continueSession!(transcript.session.conversationId))} /> : null}
    </View> : null}
  </Section>;
}
