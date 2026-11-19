// New document: ONE sheet, from a record's Files. Pick a template (the ones for this kind of record and for any), see the page filled from the record with the missing fields marked, type them, Make.
// After Make the same sheet offers Open and Send for signature: a made PDF goes straight on to the signing sheet. A failure keeps everything typed, and every state has Back and Close.
import { useEffect, useReducer, useRef } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Dialog } from "../../../../../../ui/src/Dialog/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { Segmented } from "../../../../../../ui/src/Segmented/index.tsx";
import { TextField } from "../../../../../../ui/src/TextField/index.tsx";
import { canSignFile } from "../sign/model.ts";
import type { SignData } from "../sign/data.tsx";
import { loadTemplates, makeDocument, readTemplate } from "./actions.ts";
import { asked, canMake, formatsFor, initial, labelOf, offered, step, usesSigningDate, whyNot } from "./model.ts";
import type { DocState, ExcerptLine, Kind, TemplateRow } from "./model.ts";

export interface DocumentSheetProps {
  call: SignData["call"];
  recordId: string;
  recordType: string;
  /** The record's own files folder; null before it exists (it is made when the document is). */
  folderId: string | null;
  /** Today as 2026-11-19, in the Space's day. */
  today: string;
  /** Test and walk start: the sheet begins here instead of loading. */
  start?: DocState;
  onClose(): void;
  onOpen?(fileId: string): void;
  /** A made PDF goes on to the signing sheet. */
  onSign?(file: { fileId: string; name: string; signers: string[] }): void;
}

const bare = (name: string): string => name.replace(/\.[^.]+$/, "");
const kindsOf = (s: Extract<DocState, { phase: "fill" }>): Map<string, Kind> =>
  new Map((s.preview?.fields ?? []).map((f) => [f.name, f.kind] as const));
/** A short stable word for what the press means, so a retry of the same press makes one file and a changed value makes another. */
function keyOf(recordId: string, s: Extract<DocState, { phase: "fill" }>): string {
  const text = JSON.stringify([s.template.fileId, s.values, s.signingDate, s.format]);
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `doc-${recordId}-${s.template.fileId}-${(h >>> 0).toString(36)}`;
}

export function DocumentSheet(p: DocumentSheetProps): ReactElement {
  const [s, send] = useReducer(step, p.start ?? initial());
  const folder = useRef<string | null>(p.folderId);
  const list = (): void => {
    send({ t: "reload" });
    void loadTemplates(p.call).then((r) => send(r.ok ? { t: "templates", list: r.value } : { t: "templates_failed", error: r.error }));
  };
  useEffect(() => {
    if (!p.start) list();
  }, []);
  const status = s.phase === "fill" ? s.status : s.phase;
  // the page is read again a moment after the person stops typing, so what they typed shows in it; Make never waits for that
  const typed = s.phase === "fill" ? JSON.stringify([s.values, s.signingDate]) : "";
  const seen = useRef("");
  useEffect(() => {
    if (s.phase !== "fill") {
      seen.current = "";
      return undefined;
    }
    if (s.status !== "ready") return undefined;
    // the first time the page is shown it is what was read; only a later change is read again
    if (seen.current === "") {
      seen.current = typed;
      return undefined;
    }
    if (typed === seen.current) return undefined;
    const t = setTimeout(() => {
      seen.current = typed;
      send({ t: "check" });
    }, 700);
    return () => clearTimeout(t);
  }, [typed, status]);
  // one request at a time: a template opening, the page being read again, the document being made
  const token = s.phase === "fill" ? s.token : 0;
  useEffect(() => {
    if (s.phase !== "fill") return;
    if (s.status === "loading" || s.status === "checking") {
      void readTemplate(p.call, s.template, p.recordId, { values: s.values, signingDate: s.signingDate, kinds: kindsOf(s) }).then((r) =>
        send(r.ok ? { t: "previewed", token: s.token, preview: r.value } : { t: "preview_failed", token: s.token, error: r.error }),
      );
    }
    if (s.status === "making") {
      const sent = s;
      void (async () => {
        try {
          if (folder.current === null) {
            const f = (await p.call("projects.files_folder", { recordId: p.recordId })) as { folderId?: string | null };
            if (typeof f?.folderId !== "string") throw new Error("This record has no files folder to put the document in.");
            folder.current = f.folderId;
          }
        } catch (e) {
          const m = (e as { error?: { message?: string }; message?: string })?.error?.message ?? (e as Error).message;
          send({ t: "make_failed", token: sent.token, error: m || "That did not go through. Try again." });
          return;
        }
        const r = await makeDocument(p.call, {
          template: sent.template,
          recordId: p.recordId,
          folderId: folder.current as string,
          values: sent.values,
          signingDate: sent.signingDate,
          kinds: kindsOf(sent),
          format: sent.format,
          key: keyOf(p.recordId, sent),
        });
        send(r.ok ? { t: "made", token: sent.token, made: r.value } : { t: "make_failed", token: sent.token, error: r.error });
      })();
    }
  }, [token, status]);

  if (s.phase === "made") {
    const m = s.made;
    const pdf = canSignFile(m.name);
    return (
      <Dialog
        title="Document made"
        onClose={p.onClose}
        width={520}
        fill
        testID="doc-sheet-made"
        actions={[
          { label: "Make another", onPress: () => send({ t: "back" }), testID: "doc-another" },
          ...(p.onOpen ? [{ label: "Open", onPress: () => p.onOpen?.(m.fileId), testID: "doc-open" }] : []),
          ...(pdf && p.onSign
            ? [{ label: "Send for signature", primary: true, onPress: () => p.onSign?.(m), testID: "doc-sign" }]
            : [{ label: "Done", primary: true, onPress: p.onClose, testID: "doc-done" }]),
        ]}
      >
        <View style={st.stack}>
          <Text style={st.file} numberOfLines={1} testID="doc-made-name">
            {m.name}
          </Text>
          <Text style={st.said}>It is in this record's files.</Text>
          {m.signers.length > 0 ? (
            <Text style={st.said} testID="doc-made-signers">
              {m.signers.length === 1 ? "One person signs" : `${m.signers.length} people sign`}: {m.signers.map(labelOf).join(", ")}. Each signs where the document says.
            </Text>
          ) : null}
          {m.layout === "simple" ? (
            <Text style={st.quiet} testID="doc-made-layout">
              The words are set in a plain page look. The Word file keeps your own layout.
            </Text>
          ) : null}
        </View>
      </Dialog>
    );
  }

  if (s.phase === "templates") {
    const rows = offered(s.templates, p.recordType);
    return (
      <Dialog title="New document" onClose={p.onClose} width={520} fill testID="doc-sheet" actions={[{ label: "Cancel", onPress: p.onClose, testID: "doc-cancel" }]}>
        <View style={st.stack}>
          {s.status === "loading" ? (
            <Text style={st.quiet} testID="doc-loading">
              Looking for templates
            </Text>
          ) : null}
          {s.status === "failed" ? (
            <View style={st.stack}>
              <Text accessibilityRole="alert" role="alert" style={st.problem} testID="doc-error">
                {s.error}
              </Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Try again" testID="doc-retry" onPress={list} style={st.again}>
                <Text style={st.addText}>Try again</Text>
              </Pressable>
            </View>
          ) : null}
          {s.status === "ready" && rows.length === 0 ? (
            <Text style={st.said} testID="doc-none">
              There are no templates for this yet. In Files, mark a Word file or a document as a template, and it shows here.
            </Text>
          ) : null}
          {s.status === "ready" ? (
            <View style={st.list} testID="doc-templates">
              {/* ui-rows-lint: not a list (each slot holds one ui/Row; the wrapper only carries its test id) */}
              {rows.map((t) => (
                <View key={t.fileId} testID={`doc-template-${t.fileId}`}>
                  <Row
                    id={`doc-template:${t.fileId}`}
                    title={bare(t.name)}
                    note={t.fields === 1 ? "1 field" : `${t.fields} fields`}
                    onPress={() => send({ t: "pick", template: t, today: p.today })}
                  />
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </Dialog>
    );
  }

  return <FillPage s={s} send={send} p={p} />;
}

function FillPage({
  s,
  send,
  p,
}: {
  s: Extract<DocState, { phase: "fill" }>;
  send: (e: Parameters<typeof step>[1]) => void;
  p: DocumentSheetProps;
}): ReactElement {
  const why = whyNot(s);
  const busy = s.status === "loading" || s.status === "checking" || s.status === "making";
  const formats = formatsFor(s.template.name);
  const ask = asked(s.preview);
  const words = s.format === "pdf" ? "PDF" : s.format === "docx" ? "Word file" : "document";
  const make = (): void => send({ t: "make" });
  return (
    <Dialog
      title={bare(s.template.name)}
      onClose={p.onClose}
      width={560}
      fill
      testID="doc-sheet-fill"
      actions={[
        { label: "Back", onPress: () => send({ t: "back" }), testID: "doc-back" },
        {
          label: s.status === "making" ? "Making…" : `Make ${words}`,
          primary: true,
          disabled: !canMake(s),
          ...(why && !busy ? { why } : {}),
          onPress: make,
          testID: "doc-make",
        },
      ]}
    >
      <View style={st.stack}>
        {s.status === "loading" ? (
          <Text style={st.quiet} testID="doc-opening">
            Opening the template
          </Text>
        ) : null}
        {s.preview && s.preview.excerpt.length > 0 ? <PageText lines={s.preview.excerpt} /> : null}
        {s.preview && ask.length > 0 ? (
          <View style={st.stack} testID="doc-asked">
            <Text style={st.label}>Fields to fill</Text>
            {/* ui-rows-lint: not a list (the fields of the form: a label and an input each) */}
            {ask.map((f) => (
              <View key={f.name} style={st.field}>
                <Text style={st.amber}>{labelOf(f.name)}</Text>
                <TextField
                  value={s.values[f.name] ?? ""}
                  onChangeText={(v) => send({ t: "edit", name: f.name, value: v })}
                  accessibilityLabel={labelOf(f.name)}
                  placeholder={f.kind === "date" ? "2026-11-19" : f.kind === "money" ? "1500" : ""}
                  testID={`doc-field-${f.name}`}
                  style={st.input}
                />
              </View>
            ))}
          </View>
        ) : null}
        {usesSigningDate(s.preview) ? (
          <View style={st.field}>
            <Text style={st.label}>Signing date</Text>
            <TextField
              value={s.signingDate}
              onChangeText={(v) => send({ t: "date", value: v })}
              accessibilityLabel="Signing date"
              placeholder="2026-11-19"
              testID="doc-date"
              style={st.input}
            />
          </View>
        ) : null}
        {formats.length > 1 ? (
          <Segmented
            label="Make it as"
            options={formats.map((f) => ({ id: f.format, label: f.label }))}
            value={s.format}
            onChange={(format) => send({ t: "format", format })}
            testID="doc-format"
          />
        ) : null}
        {s.preview && s.preview.signers.length > 0 ? (
          <Text style={st.quiet} testID="doc-signers">
            Signs: {s.preview.signers.map(labelOf).join(", ")}
          </Text>
        ) : null}
        {why && !busy ? (
          <Text style={st.quiet} testID="doc-why">
            {why}
          </Text>
        ) : null}
        {s.error ? (
          <Text accessibilityRole="alert" role="alert" style={st.problem} testID="doc-error">
            {s.error}
          </Text>
        ) : null}
      </View>
    </Dialog>
  );
}

/** The page as it will read: the words, with what came from the record in bold. */
function PageText({ lines }: { lines: readonly ExcerptLine[] }): ReactElement {
  return (
    <View style={st.page} testID="doc-page">
      {lines.slice(0, 40).map((l, i) => {
        const parts: ReactElement[] = [];
        let at = 0;
        for (const f of [...l.filled].sort((a, b) => a.from - b.from)) {
          if (f.from < at) continue;
          if (f.from > at) parts.push(<Text key={`t${at}`}>{l.text.slice(at, f.from)}</Text>);
          parts.push(
            <Text key={`f${f.from}`} style={st.filled}>
              {l.text.slice(f.from, f.to)}
            </Text>,
          );
          at = f.to;
        }
        if (at < l.text.length) parts.push(<Text key={`t${at}e`}>{l.text.slice(at)}</Text>);
        return (
          <Text key={i} style={st.line}>
            {parts}
          </Text>
        );
      })}
    </View>
  );
}

const st = StyleSheet.create({
  stack: { gap: 10 },
  list: { marginHorizontal: -6 },
  file: { fontSize: 12.5, color: "var(--ink-3)" as string },
  said: { fontSize: 13, lineHeight: 19, color: "var(--ink-2)" as string },
  quiet: { fontSize: 12.5, color: "var(--ink-3)" as string },
  label: { fontSize: 12.5, fontWeight: "600", color: "var(--ink-2)" as string, marginTop: 4 },
  amber: { fontSize: 12.5, fontWeight: "600", color: "var(--warn)" as string },
  field: { gap: 4 },
  input: { width: "100%" },
  problem: { fontSize: 12.5, color: "var(--danger)" as string },
  again: { alignSelf: "flex-start", paddingVertical: 6, paddingHorizontal: 8, marginLeft: -8, borderRadius: 7 },
  addText: { fontSize: 13, color: "var(--accent)" as string, fontWeight: "500" },
  page: {
    gap: 6,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "var(--line)" as string,
    backgroundColor: "var(--raised)" as string,
    maxHeight: 280,
    overflow: "hidden",
  },
  line: { fontSize: 13, lineHeight: 19, color: "var(--ink)" as string },
  filled: { fontWeight: "600" },
});
