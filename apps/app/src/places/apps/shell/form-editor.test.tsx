// The form editor never draws its fields before they hold the saved form. The record arrives (or is peeked from the kept copy) in one render and the editor copies it into its fields in an effect, so the first
// thing drawn used to be the field with an empty name: a walk that read the name the moment the detail appeared read '' (apps.editors, 24 Nov 2026, red in CI on both final heads).
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { AppsDataProvider } from "./data.tsx";
import type { AppsData } from "./data.tsx";
import { FormEditor } from "./FormEditor.tsx";

const SAVED = {
  form: { id: "frm_saved", name: "Saved form name", recordType: "contact", kind: "public" },
  fields: [],
  settings: { consentText: "", captcha: false },
  choices: {},
};
const data = (peek: boolean): AppsData =>
  ({
    screens: {} as never,
    team: true,
    clock: () => ({ now: 0 }),
    call: async (cap: string) => (cap === "forms.get" ? SAVED : { types: [] }),
    ...(peek ? { peek: (cap: string) => (cap === "forms.get" ? SAVED : null) } : {}),
    nav: { open() {}, create() {}, show() {}, joinTeam() {}, openTask() {}, openThread() {} },
  }) as AppsData;

test("an editor whose saved form is already in hand does not draw the name field until it holds the name", () => {
  const html = renderToStaticMarkup(
    <AppsDataProvider value={data(true)}>
      <FormEditor route={{ group: "forms", id: "frm_saved" } as never} back={() => undefined} />
    </AppsDataProvider>,
  );
  assert.doesNotMatch(html, /Form name/, "the first draw is the loading state, not an empty field");
  assert.match(html, /Loading/);
});

test("a new form, which has nothing to load, draws its fields at once", () => {
  const html = renderToStaticMarkup(
    <AppsDataProvider value={data(false)}>
      <FormEditor route={{ group: "forms" } as never} back={() => undefined} />
    </AppsDataProvider>,
  );
  assert.match(html, /Form name/);
});
