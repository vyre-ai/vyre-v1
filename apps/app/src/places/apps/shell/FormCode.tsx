import type { ReactElement } from "react";
import { Text, View } from "react-native";
import { checkFormHtml, checkFormJs, generateFormHtml } from "../../../../../../lib/form-source.ts";
import type { PreviewField } from "./form-design.ts";
import { Button, Field, s } from "./editor-ui.tsx";

export interface FormCodeProps {
  html: string; css: string; js: string;
  onHtml(value: string): void; onCss(value: string): void; onJs(value: string): void;
  /** the questions asked on this form, in order: what "Generate from Build" places */
  asked: readonly PreviewField[];
  disabled?: boolean;
}

/** The form's own source: HTML (its layout, with <vyre-field> where each record-bound input goes), CSS and JavaScript. The inputs come from Build, so they stay bound to the record; Build never edits this. */
export function FormCode({ html, css, js, onHtml, onCss, onJs, asked, disabled }: FormCodeProps): ReactElement {
  const htmlCheck = html.length > 0 ? checkFormHtml(html) : null;
  const jsCheck = js.length > 0 ? checkFormJs(js) : null;
  const unplaced = htmlCheck && htmlCheck.ok ? asked.filter((q) => !htmlCheck.fields.includes(q.key)) : [];
  return <View style={{ gap: 12 }} testID="apps-form-code">
    <Text style={s.text}>Write the form's layout in HTML. Put <Text style={{ fontWeight: "600" }}>{'<vyre-field name="email"></vyre-field>'}</Text> where a question goes: the input is made from Build, so it stays bound to its record field, and Build never changes your HTML, CSS or JavaScript. Questions you leave out still appear after your markup. Save before publishing.</Text>
    <Field label="HTML" value={html} onChange={onHtml} multiline disabled={disabled} placeholder="<h1>Get in touch</h1>" />
    <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
      <Button title="Generate from Build" disabled={disabled || asked.length === 0} testID="apps-code-generate" onPress={() => onHtml(generateFormHtml(asked))} />
      {html.length > 0 ? <Button title="Clear HTML" disabled={disabled} onPress={() => onHtml("")} /> : null}
    </View>
    {htmlCheck && !htmlCheck.ok ? <Text accessibilityRole="alert" testID="apps-code-html-error" style={s.text}>{`This HTML cannot be saved: ${htmlCheck.reason}`}</Text> : null}
    {unplaced.length > 0 ? <Text testID="apps-code-unplaced" style={s.text}>{`Not placed in your HTML (shown after it): ${unplaced.map((q) => q.title).join(", ")}.`}</Text> : null}
    <Field label="Custom CSS" value={css} onChange={onCss} multiline disabled={disabled} />
    <Text style={s.text}>JavaScript runs on the public page when someone opens the form, in its own sandbox: it can change the page and read the answers on it, but it cannot reach this Space's data.</Text>
    <Field label="JavaScript" value={js} onChange={onJs} multiline disabled={disabled} placeholder="document.title = 'Hello';" />
    {jsCheck && !jsCheck.ok ? <Text accessibilityRole="alert" testID="apps-code-js-error" style={s.text}>{`This JavaScript cannot be saved: ${jsCheck.reason}`}</Text> : null}
  </View>;
}

/** Can what is typed be saved? The server checks again; this keeps Save from sending what it will refuse. */
export const codeProblem = (html: string, js: string): string | null => {
  const h = html.length > 0 ? checkFormHtml(html) : null, j = js.length > 0 ? checkFormJs(js) : null;
  return h && !h.ok ? `HTML: ${h.reason}` : j && !j.ok ? `JavaScript: ${j.reason}` : null;
};
