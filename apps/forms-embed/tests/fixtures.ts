// A form definition that uses every part of the renderer: three steps, a read-only notice, a hidden field, logic that shows, hides, requires and skips, a consent statement.
import { parseDefinition } from "../src/definition.js";
import type { FormDefinition } from "../src/definition.js";

export const RAW = {
  slug: "intake", name: "Client intake", kind: "public", intro: "Tell us about your matter.",
  fields: [
    { field: "name", label: "Your name", type: "text", required: true, step: 0 },
    { field: "email", label: "Email", type: "email", required: true, step: 0, prefillKey: "e" },
    { field: "area", label: "Practice area", type: "choice", step: 0, options: [{ value: "family", label: "Family" }, { value: "estate", label: "Estate planning" }, { value: "other", label: "Something else" }] },
    { field: "notice", label: "Please note", type: "text", mode: "show", value: "We reply within one business day.", step: 0 },
    { field: "source_secret", label: "Source", type: "text", mode: "hide", step: 0 },
    { field: "details", label: "What happened?", type: "longtext", required: true, step: 1, help: "A few sentences is plenty." },
    { field: "has_deadline", label: "Is there a deadline?", type: "checkbox", step: 1, placeholder: "There is a deadline" },
    { field: "deadline", label: "Deadline", type: "date", step: 1, required: true },
    { field: "budget", label: "Budget", type: "money", step: 2, min: 0 },
    { field: "referral", label: "Who referred you?", type: "text", step: 2 },
  ],
  logic: {
    rules: [
      { if: { field: "has_deadline", op: "eq", value: true }, then: [{ show: ["deadline"] }] },
      { if: { field: "area", op: "eq", value: "other" }, then: [{ skipToStep: 2 }] },
      { if: { field: "area", op: "eq", value: "estate" }, then: [{ hide: ["budget"] }, { require: ["referral"] }] },
    ],
  },
  thankYou: { text: "We will be in touch within one business day." },
  consentText: "I agree that you may contact me about this matter.",
  theme: { skin: "paper" },
};

export function define(over: Record<string, unknown> = {}): FormDefinition {
  const parsed = parseDefinition({ ...RAW, ...over });
  if (!parsed.def) throw new Error(`the fixture definition is invalid: ${parsed.problems.join("; ")}`);
  return parsed.def;
}
