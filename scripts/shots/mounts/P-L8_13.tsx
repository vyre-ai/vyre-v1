// Mount for P-L8_13: the public form renderer (apps/forms-embed) drawing a three-step intake form on its second step, in the Space's skin (Northwind is Paper, Harbor Studio is Dusk).
// The renderer is plain HTML and CSS, so the mount writes its markup and its stylesheet into the page the way the host's /f/<slug> document does.
import { createElement } from "react";
import { parseDefinition } from "../../../apps/forms-embed/src/definition.js";
import { renderForm } from "../../../apps/forms-embed/src/html.js";
import { styleSheet } from "../../../apps/forms-embed/src/theme.js";

export const title = "Public form";

const RAW = {
  slug: "intake", name: "Client intake", kind: "public", intro: "Tell us about your matter.",
  fields: [
    { field: "name", label: "Your name", type: "text", required: true, step: 0 },
    { field: "details", label: "What happened?", type: "longtext", required: true, step: 1, help: "A few sentences is plenty." },
    { field: "area", label: "Practice area", type: "choice", step: 1, options: [{ value: "family", label: "Family" }, { value: "estate", label: "Estate planning" }, { value: "other", label: "Something else" }] },
    { field: "has_deadline", label: "Is there a deadline?", type: "checkbox", step: 1, placeholder: "There is a deadline" },
    { field: "deadline", label: "Deadline", type: "date", step: 1, required: true },
    { field: "referral", label: "Who referred you?", type: "text", step: 2 },
  ],
  logic: { rules: [{ if: { field: "has_deadline", op: "eq", value: true }, then: [{ show: ["deadline"] }] }] },
  consentText: "I agree that you may contact me about this matter.",
};

export default function Mount() {
  const skin = typeof location === "undefined" ? "paper" : new URLSearchParams(location.search).get("skin") ?? "paper";
  const parsed = parseDefinition({ ...RAW, theme: { skin: skin === "paper" ? "paper" : "dusk" } });
  if (!parsed.def) throw new Error(parsed.problems.join("; "));
  const def = parsed.def;
  const html = renderForm(def, { status: "editing", step: 1, history: [0], answers: { name: "Dana Whitfield", has_deadline: true, area: "estate" }, errors: {}, consent: false });
  return createElement("div", { "data-testid": "form-embed", style: { minHeight: "100vh", background: "var(--win)" } }, createElement("style", { dangerouslySetInnerHTML: { __html: styleSheet(def) } }), createElement("div", { dangerouslySetInnerHTML: { __html: html } }));
}
