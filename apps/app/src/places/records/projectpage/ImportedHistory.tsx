import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { dateWords } from "./model.ts";
import { useProjectPageData } from "./data.tsx";
import type { ImportedSessionArchive, ImportedSessionTranscript } from "./data.tsx";

interface ViewProps {
  archives: readonly ImportedSessionArchive[];
  transcript?: ImportedSessionTranscript | null;
  now: number;
  busy: boolean;
  error: string;
  onRead(conversationId: string): void;
  onRetry(): void;
  onContinue(conversationId: string): void;
  onClose?: () => void;
  onOpenThread(threadId: string): void;
}

const providerName = (provider: ImportedSessionArchive["provider"]): string => provider === "codex" ? "Codex" : "Claude Code";
const Button = ({ label, onPress, disabled = false }: { label: string; onPress(): void; disabled?: boolean }): ReactElement => (
  <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={{ paddingHorizontal: 8, paddingVertical: 5, borderRadius: 7, opacity: disabled ? 0.45 : 1 }}>
    <Text style={{ color: "var(--accent)" as string, fontSize: 12.5, fontWeight: "500" }}>{label}</Text>
  </Pressable>
);

export function ImportedHistoryView({ archives, transcript = null, now, busy, error, onRead, onRetry, onContinue, onClose, onOpenThread }: ViewProps): ReactElement {
  return <View testID="project-imported-history" style={{ marginTop: 10 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 4 }}>
      <Text accessibilityRole="header" style={{ fontSize: 12.5, fontWeight: "600", color: "var(--ink-2)" as string }}>Imported coding history</Text>
      <Text style={{ fontSize: 12, color: "var(--ink-3)" as string }}>{archives.length}</Text>
    </View>
    {error ? <View accessibilityRole="alert"><Text style={{ color: "var(--danger)" as string }}>{error}</Text><Button label="Retry imported history" onPress={onRetry} disabled={busy} /></View> : null}
    {!error && busy && archives.length === 0 ? <Text style={{ fontSize: 12.5, color: "var(--ink-3)" as string }}>Loading imported history…</Text> : null}
    {!error && !busy && archives.length === 0 ? <Text style={{ fontSize: 12.5, color: "var(--ink-3)" as string }}>No imported sessions are filed in this project.</Text> : null}
    {archives.map((archive) => <Row key={archive.conversationId} id={`imported:${archive.conversationId}`} title={archive.title} note={`${providerName(archive.provider)} · ${dateWords(archive.startedAt)}`}
      trailing={<View style={{ flexDirection: "row", alignItems: "center" }}><Button label="Read archive" onPress={() => onRead(archive.conversationId)} disabled={busy} />{archive.continuedThreadId ? <Button label="Open continued chat" onPress={() => onOpenThread(archive.continuedThreadId!)} disabled={busy} /> : null}</View>} />)}
    {transcript ? <View testID="project-imported-transcript" style={{ gap: 8, marginTop: 12, padding: 12, borderRadius: 10, backgroundColor: "var(--sunk)" as string }}>
      <Text accessibilityRole="header" style={{ fontSize: 14, fontWeight: "600", color: "var(--ink)" as string }}>{transcript.session.title}</Text>
      {/* ui-rows-lint: not a list (transcript paragraphs preserve the immutable visible history) */}
      {transcript.messages.map((message) => <View key={message.sourceMessageId}><Text style={{ fontSize: 11.5, color: "var(--ink-3)" as string }}>{message.role}</Text><Text selectable style={{ fontSize: 13, lineHeight: 19, color: "var(--ink)" as string }}>{message.text}</Text></View>)}
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Button label="Close archive" onPress={() => onClose?.()} disabled={busy} />
        {transcript.session.continuedThreadId ? <Button label="Open continued chat" onPress={() => onOpenThread(transcript.session.continuedThreadId!)} disabled={busy} /> : <Button label="Continue with your assistant" onPress={() => onContinue(transcript.session.conversationId)} disabled={busy} />}
      </View>
    </View> : null}
  </View>;
}

export function ImportedHistory({ projectId }: { projectId: string }): ReactElement | null {
  const data = useProjectPageData();
  const api = data.imports;
  const [archives, setArchives] = useState<ImportedSessionArchive[]>([]);
  const [transcript, setTranscript] = useState<ImportedSessionTranscript | null>(null);
  const [busy, setBusy] = useState(api !== undefined);
  const [error, setError] = useState("");
  const load = useCallback(async (): Promise<void> => {
    if (!api) return;
    setBusy(true); setError("");
    try { setArchives(await api.list(projectId)); }
    catch (e) { setError(e instanceof Error ? e.message : "Imported history could not be loaded."); }
    finally { setBusy(false); }
  }, [api, projectId]);
  useEffect(() => { void load(); }, [load]);
  if (!api) return null;
  const run = (work: () => Promise<void>): void => { setBusy(true); setError(""); void work().catch((e: unknown) => setError(e instanceof Error ? e.message : "That did not work. Try again.")).finally(() => setBusy(false)); };
  return <ImportedHistoryView archives={archives} transcript={transcript} now={data.now()} busy={busy} error={error} onRetry={() => void load()}
    onRead={(id) => run(async () => setTranscript(await api.read(id)))} onClose={() => setTranscript(null)}
    onContinue={(id) => run(async () => { const threadId = await api.continue(id); data.nav.openThread(threadId); await load(); })} onOpenThread={data.nav.openThread} />;
}
