// Email uses the shared EmailBuilder. A text uses the shared RichEditor. Neither step gets a plain body box.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { EmailBuilder, compileEmail } from "../../../../../../ui/src/EmailBuilder/index.tsx";
import type { EmailBlock } from "../../../../../../ui/src/EmailBuilder/props.ts";
import { RichEditor } from "../../../../../../ui/src/RichEditor/index.tsx";
import { useAutomationsData } from "../canvas/data.tsx";
import {
  EMAIL_CONSENT, EMAIL_REPLY, SMS_CONSENT, SMS_LINK_POLICY, SMS_QUIET_HOURS,
  fixtureValues, readMessage, readSms, recipientText, renderMessage, savedFromList, smsCount, toApiBlock, writeEmail, writeList, writeSms,
} from "./compose.ts";

export function MessageComposer({ stepKey, nodeId, input, samples, onInput }: {
  stepKey: string;
  nodeId: string;
  input: Record<string, unknown>;
  samples: Readonly<Record<string, unknown>>;
  onInput(next: Record<string, unknown>): void;
}): ReactElement | null {
  if (stepKey === "send_email") return <EmailStep nodeId={nodeId} input={input} samples={samples} onInput={onInput} />;
  if (stepKey === "send_sms") return <SmsStep nodeId={nodeId} input={input} samples={samples} onInput={onInput} />;
  return null;
}

function Line({ label, value, testID, onCommit }: { label: string; value: string; testID: string; onCommit(text: string): void }): ReactElement {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  const done = (): void => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput accessibilityLabel={label} testID={testID} value={shown} onChangeText={setDraft} onBlur={done} onSubmitEditing={done} style={s.input} />
    </View>
  );
}

function EmailStep({ nodeId, input, samples, onInput }: {
  nodeId: string;
  input: Record<string, unknown>;
  samples: Readonly<Record<string, unknown>>;
  onInput(next: Record<string, unknown>): void;
}): ReactElement {
  const data = useAutomationsData();
  const draft = readMessage(input);
  const [saved, setSaved] = useState<{ id: string; name: string; block: EmailBlock; shared?: boolean }[]>([]);
  const [rendered, setRendered] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void data.call("email_builder.saved_blocks.list", {}).then((out) => {
      if (!live) return;
      const rows = out && typeof out === "object" ? (out as { blocks?: unknown }).blocks : undefined;
      setSaved(savedFromList(rows));
    }).catch(() => { if (live) setSaved([]); });
    return () => { live = false; };
  }, [data, nodeId]);
  const subject = typeof input.subject === "string" ? input.subject : "";
  const values = fixtureValues(samples);
  return (
    <View style={s.wrap} testID="email-composer">
      <Line label="To" testID="composer-to" value={recipientText(input.to)} onCommit={(text) => onInput(writeList(input, "to", text))} />
      <Line label="Cc" testID="composer-cc" value={recipientText(input.cc)} onCommit={(text) => onInput(writeList(input, "cc", text))} />
      <Line label="Reply-to" testID="composer-reply" value={draft.replyTo} onCommit={(text) => onInput(writeEmail(input, { ...draft, subject, body: typeof input.body === "string" ? input.body : "", replyTo: text }))} />
      <Line label="Attachments" testID="composer-files" value={recipientText(input.fileIds)} onCommit={(text) => onInput(writeList(input, "fileIds", text))} />
      <Text style={s.note}>{EMAIL_REPLY}</Text>
      <Text style={s.note}>{EMAIL_CONSENT}</Text>
      <EmailBuilder
        id={nodeId}
        title="Email"
        subject={subject}
        previewText={draft.previewText}
        mode={draft.mode}
        blocks={draft.blocks}
        html={draft.html}
        plain={draft.plain}
        version={Math.max(draft.version, 1)}
        fromName={draft.fromName}
        density="compact"
        mergeValues={values}
        savedBlocks={saved}
        onSaveBlock={(name, block) => {
          void data.call("email_builder.saved_blocks.save", { name, block: toApiBlock(block) }).then((out) => {
            const row = out && typeof out === "object" ? (out as { block?: unknown }).block : undefined;
            const next = savedFromList(row ? [row] : []);
            if (next[0]) setSaved((list) => [...list.filter((item) => item.id !== next[0]?.id), next[0]!]);
          }).catch(() => undefined);
        }}
        onChange={(snapshot) => {
          const body = snapshot.html.trim().length > 0
            ? snapshot.html
            : snapshot.blocks.length > 0
              ? compileEmail(snapshot.blocks, { mode: "send" })
              : snapshot.plain;
          const mode = snapshot.html.trim().length > 0 ? "html" : snapshot.blocks.length > 0 ? "visual" : "plain";
          onInput(writeEmail(input, {
            subject: snapshot.subject,
            previewText: snapshot.previewText,
            body,
            mode,
            blocks: snapshot.blocks,
            html: snapshot.html,
            plain: snapshot.plain,
            replyTo: draft.replyTo,
            fromName: draft.fromName,
          }));
        }}
        onTestSend={() => setRendered(renderMessage("send_email", input, values) ?? "Nothing to render yet.")}
      />
      {rendered ? <Text testID="composer-rendered" style={s.note}>{rendered}</Text> : null}
    </View>
  );
}

function SmsStep({ nodeId, input, samples, onInput }: {
  nodeId: string;
  input: Record<string, unknown>;
  samples: Readonly<Record<string, unknown>>;
  onInput(next: Record<string, unknown>): void;
}): ReactElement {
  const draft = readSms(input);
  const body = typeof input.body === "string" ? input.body : "";
  const count = smsCount(body);
  const values = fixtureValues(samples);
  const [rendered, setRendered] = useState<string | null>(null);
  return (
    <View style={s.wrap} testID="sms-composer">
      <Line label="To" testID="composer-to" value={recipientText(input.to)} onCommit={(text) => onInput(writeList(input, "to", text))} />
      <Line label="Media" testID="composer-media" value={draft.mediaFileIds.join(", ")} onCommit={(text) => onInput(writeSms(input, { body, mediaFileIds: text.split(",") }))} />
      <RichEditor
        docId={`sms-${nodeId}`}
        mode="edit"
        placeholder="Write the text"
        markdown={body}
        density="compact"
        onMarkdown={(markdown) => onInput(writeSms(input, { body: markdown, mediaFileIds: draft.mediaFileIds }))}
        testID="sms-body"
      />
      <Text style={s.note} testID="sms-count">{`${count.segments} ${count.encoding} ${count.segments === 1 ? "segment" : "segments"}, ${count.characters} characters.`}</Text>
      <Text style={s.note}>{SMS_LINK_POLICY}</Text>
      <Text style={s.note}>{SMS_QUIET_HOURS}</Text>
      <Text style={s.note}>{SMS_CONSENT}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Preview with fixture data" testID="sms-preview" onPress={() => setRendered(renderMessage("send_sms", input, values) ?? "Nothing to render yet.")}>
        <Text style={s.note}>Preview with fixture data</Text>
      </Pressable>
      {rendered ? <Text style={s.note}>{rendered}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 8 },
  field: { gap: 4 },
  label: { fontSize: 12, color: "var(--ink-3)" as string },
  input: { fontSize: 14, color: "var(--ink)" as string, borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 },
  note: { fontSize: 12, lineHeight: 17, color: "var(--ink-3)" as string },
});
