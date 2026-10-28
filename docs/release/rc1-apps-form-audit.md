# RC1 Apps Form audit

Audit against `docs/spec/V1-SPEC.md` and the binding prototype in `scripts/shots/prototype/vyre-v1.html`.

| Feature | Binding evidence | Current behavior |
| --- | --- | --- |
| Layout, theme, fonts, CSS, cover, multiple pages, conditional logic | V1 spec 2.11, line 145; publish design flow 3.6, line 378 | Typed design controls save existing `forms.design_set` values. Field order and page numbers save through `forms.fields_set`. A page picker and local sample answers drive the scriptless preview. |
| Typed form fields and survey choices | V1 spec 2.11, lines 144–145: record type mapping and inherited validation; survey rating/choice | Editor preview uses schema types/options. Related record choices come from authenticated, permission-scoped queries for visible relation fields. Actual published renderer still has the gap below. |
| Scoped Ask chat | V1 spec 2.5, line 78: private chats scoped to an object | Ask starts a real assistant thread with `scopeType: form` and its form ID. |
| Per-change Ask diff and full HTML/JS form Code roundtrip | Prototype Apps notes around line 82744 | Not separately stated for Forms in v1 2.11/3.6. The v1 spec explicitly requires email HTML/diff at line 383 and site Code at line 384. The binding prototype remains a visual/product requirement for owner review; this observation does not waive it. Current Form Code edits CSS. |
| Drag layout and inline canvas editing | Prototype Form editor; general layout requirement in v1 line 145 | Reorder/page controls persist layout. Dragging and editing labels inside the canvas are not implemented. |

## Residual published-form gap

`modules/forms/handlers/submit.ts` public view currently exports field name, visibility, prefill and page without schema type/options. `host/src/routes/forms-page.ts` `fieldHtml` guesses the widget from its name through `inputType`. A published choice, relation or survey field can therefore differ from the typed editor preview. A fix needs bounded schema metadata and an explicit public relation-access policy; anonymous visitors must not receive the authenticated editor's record choices.

The preview remains an isolated iframe with no scripts or submission. HTTPS images are allowed for an explicitly configured cover, with no referrer. Local preview answers never call a write capability. Existing nested conditional rules and unedited theme keys survive saves; the editor can add/edit simple conditions and preserve or remove existing combined conditions.

## Evidence

Production Chromium runs against a freshly claimed daemon and a real production web export. The Apps flow creates a permission-scoped company fixture, checks its relation label and actual choice options, tests conditional Email visibility with local Name answers, saves theme/CSS and checks their readback after reload, then creates a phone form and checks the rendered Name question. It also creates a campaign, saves/installs a draft template and stops at sending-domain review. No real messages, provider-domain changes or paid services are triggered.
