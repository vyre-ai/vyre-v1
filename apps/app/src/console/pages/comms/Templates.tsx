import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { View } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import { ObjectSection } from "../../../../../../ui/src/ObjectPage/index.tsx";
import { useConsoleData } from "../../shell/data.tsx";
import { Section } from "../../shell/ui.tsx";
import { Help, Actions, Button, TextBox, Note, ReadState, attempt, useAction, useRead } from "../shared.tsx";
import { CommsList, CommsObject } from "./common.tsx";

type Template = CapMap["mail.template.get"]["out"]["template"];
type Preview = CapMap["mail.template.preview"]["out"];

const blankWords = (names: string[]): string => names.map((n) => n.replace(/_/g, " ")).join(", ");

/** Console, Messaging, Email: the emails Vyre sends for a signature request, a reminder, a signed copy and an expired link, and any template the Space adds. */
export function TemplatesPage({ initialKey }: { initialKey?: string }): ReactElement {
  const data = useConsoleData();
  const list = useRead<CapMap["mail.template.list"]["out"]>("mail.template.list", {});
  const [selected, setSelected] = useState(initialKey ?? "");
  useEffect(() => setSelected(initialKey ?? ""), [initialKey]);
  if (selected)
    return (
      <TemplateObject
        key={selected}
        templateKey={selected}
        onBack={() => {
          setSelected("");
          list.refresh();
          data.nav.openPage("templates");
        }}
      />
    );
  if (!list.data) return <ReadState error={list.error} retry={list.refresh} />;
  return (
    <View testID="console-templates">
      <Section title="Email templates" count={list.data.templates.length}>
        <CommsList
          rows={list.data.templates.map((t) => ({
            id: t.key,
            title: t.title,
            note: `${t.subject}${t.customised ? " · changed by your Space" : ""}`,
          }))}
          onOpen={(key) => {
            setSelected(key);
            data.nav.openPage("templates", { templateKey: key });
          }}
          empty="No templates yet."
          testID="templates-list"
        />
      </Section>
      <Help>
        {
          "Put a field in with its name in double braces, like {{signer_name|there}}. The words after the bar are used when the field is empty."
        }
      </Help>
    </View>
  );
}

function TemplateObject({ templateKey, onBack }: { templateKey: string; onBack(): void }): ReactElement {
  const query = useRead<CapMap["mail.template.get"]["out"]>("mail.template.get", { key: templateKey });
  if (!query.data) return <ReadState error={query.error} retry={query.refresh} />;
  return <TemplateEditor template={query.data.template} onBack={onBack} refresh={query.refresh} />;
}

function TemplateEditor({
  template,
  onBack,
  refresh,
}: {
  template: Template;
  onBack(): void;
  refresh(): void;
}): ReactElement {
  const [subject, setSubject] = useState(template.subject),
    [text, setText] = useState(template.text),
    [recordId, setRecordId] = useState(""),
    [preview, setPreview] = useState<Preview | null>(null),
    [previewNote, setPreviewNote] = useState("");
  const { call } = useConsoleData();
  const action = useAction(refresh);
  const changed = subject !== template.subject || text !== template.text;
  const valid = subject.trim() !== "" && text.trim() !== "";
  // the preview follows the words as they are typed, on the chosen record when there is one
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      const input: Record<string, unknown> = { subject, text };
      if (recordId.trim()) input["recordId"] = recordId.trim();
      void call("mail.template.preview", input).then(
        (out) => {
          if (!alive) return;
          setPreview(out as Preview);
          setPreviewNote("");
        },
        () => {
          if (!alive) return;
          setPreview(null);
          setPreviewNote(
            recordId.trim() ? "That record could not be read." : "The preview needs a subject and a body.",
          );
        },
      );
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [call, subject, text, recordId]);
  const add = (field: string): void => setText((t) => `${t}{{${field}}}`);
  return (
    <View testID="template-object">
      <CommsObject
        id={template.key}
        name={template.title}
        kind="Email template"
        status={template.source === "builtin" ? "Ships with Vyre" : "Changed by your Space"}
        parent="Email templates"
        onBack={onBack}
      >
        <ObjectSection title="Words">
          <TextBox label="Subject" testID="template-subject" value={subject} onChange={setSubject} />
          <TextBox
            label="Body"
            testID="template-text"
            value={text}
            onChange={setText}
            multiline
            rows={Math.min(30, Math.max(8, text.split("\n").length + 2))}
          />
          {template.fields.length ? (
            <Actions>
              {/* ui-rows-lint: not a list (small buttons that put a field name into the text) */}
              {template.fields.map((f) => (
                <Button
                  key={f.key}
                  small
                  label={f.key.replace(/_/g, " ")}
                  testID={`template-field-${f.key}`}
                  onPress={() => add(f.key)}
                />
              ))}
            </Actions>
          ) : null}
          <Actions>
            <Button
              primary
              label="Save"
              testID="template-save"
              disabled={!changed || !valid || action.busy}
              {...(!valid ? { why: "A template needs a subject and a body" } : {})}
              onPress={() =>
                void action.run(
                  "mail.template.save",
                  {
                    key: template.key,
                    title: template.title,
                    subject: subject.trim(),
                    text,
                    idempotencyKey: attempt(),
                  },
                  "Template saved",
                )
              }
            />
            {template.source === "space" ? (
              <Button
                label="Use the one that ships with Vyre"
                testID="template-reset"
                disabled={action.busy}
                onPress={() =>
                  void action.run("mail.template.reset", { key: template.key }, "Template reset").then(onBack)
                }
              />
            ) : null}
          </Actions>
          {action.note ? <Note>{action.note}</Note> : null}
        </ObjectSection>
        <ObjectSection title="Preview">
          <TextBox
            label="Show it for this record"
            testID="template-record"
            value={recordId}
            onChange={setRecordId}
            hint="Paste a record id to see its own values"
          />
          {preview ? (
            <View testID="template-preview">
              <Note>{preview.subject}</Note>
              <Note>{preview.text}</Note>
              {preview.blanks.length ? (
                <Note testID="template-blanks">{`Would go out empty: ${blankWords(preview.blanks)}. Add words after a bar to cover it, like {{${preview.blanks[0]}|…}}.`}</Note>
              ) : null}
            </View>
          ) : previewNote ? (
            <Note>{previewNote}</Note>
          ) : null}
        </ObjectSection>
      </CommsObject>
    </View>
  );
}
