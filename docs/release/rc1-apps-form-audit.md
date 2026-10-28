# RC1 Apps Form audit

Audit against `docs/spec/V1-SPEC.md` and the binding prototype in `scripts/shots/prototype/vyre-v1.html`.

| Feature | Binding evidence | Current behavior |
| --- | --- | --- |
| Layout, theme, fonts, CSS, cover, multiple pages, conditional logic | V1 spec 2.11, line 145; publish design flow 3.6, line 378 | Typed design controls save existing `forms.design_set` values. Field order and page numbers save through `forms.fields_set`. A page picker and local sample answers drive the scriptless preview. |
| Typed form fields and survey choices | V1 spec 2.11, lines 144–145: record type mapping and inherited validation; survey rating/choice | Editor preview uses schema types/options. Related record choices come from authenticated, permission-scoped queries for visible relation fields. The published renderer now reads selected-field schema metadata and validates/coerces typed answers before record writes. Public relation selection remains guarded as described below. |
| Scoped Ask chat | V1 spec 2.5, line 78: private chats scoped to an object | Ask starts a real assistant thread with `scopeType: form` and its form ID. |
| Per-change Ask diff and full HTML/JS form Code roundtrip | Prototype Apps notes around line 82744 | Not separately stated for Forms in v1 2.11/3.6. The v1 spec explicitly requires email HTML/diff at line 383 and site Code at line 384. The binding prototype remains a visual/product requirement for owner review; this observation does not waive it. Current Form Code edits CSS. |
| Drag layout and inline canvas editing | Prototype Form editor; general layout requirement in v1 line 145 | Reorder/page controls persist layout. Dragging and editing labels inside the canvas are not implemented. |

## Public form follow-up and remaining relation authority

`publicFormViewTyped` in `modules/forms/handlers/submit.ts` reads only the selected fields' metadata through the host-wired schema reader. `host/src/routes/forms-page.ts` renders choice/status, multiple choice, boolean, number, date/time, rating and configured file controls using that metadata. Anonymous submissions validate choices and dates and convert numeric/boolean values before record writes. Uploaded files keep their visitor/token binding and become the record schema's list of file IDs only after upload checks succeed. The host adds a stable idempotency key and isolates stored upload names by a hash of the form, visitor, token, filename and bytes.

Public relation and person questions expose no record choices. Arbitrary IDs, including another Space's IDs, are refused. Required relation questions, including conditional requirements, block publication with a field-specific error; the editor's publish review explains the unavailable question and disables confirmation. Signed links retain their missing-field list, so existing bound relation values stay untouched.

The existing module `Ctx.call` permits `onBehalfOf` only with a valid approval token (`packages/contracts/src/ctx.ts`). The public route calls the form as `svc_host` in `host/src/daemon/daemon.ts`; `formCtx` deliberately has no general record-reading capability. No publisher impersonation or synthetic approval token was added.

A future explicit allowlist needs additive field configuration, an authenticated publisher's explicit confirmation that the selected labels/records become public, and a snapshot of at most 100 approved IDs/labels. Public reads and submit must resolve **only those saved IDs** in the local target type, never query the record list. A bounded host seam can use the existing kernel authorizer to require the saved publisher's current `forms.publish` permission on the form and current record View on each approved row. It must apply row filters, hidden title fields and label clearance to the actual current row, reject deleted/missing/foreign records, and omit or refuse choices when the publisher is suspended, removed or loses a grant. Snapshot labels must not refresh from new record text without publisher approval.

Permission tests required for that seam: no form permission; no record grant; row-filter mismatch; hidden or sealed title; higher classification; expired/revoked grant; suspended/removed publisher; deleted row; foreign Space ID; forged choice ID; changed target schema; and a concurrent revocation between view and submit. The approved IDs, target type and publisher identity must come from stored configuration, never visitor input.

Uploads already use a separate narrow guard: `forms.update` requires caller write access to the upload folder, and `host/src/daemon/forms-authority.ts` rechecks the saved creator's current form Edit/`forms.publish` and folder Edit/`files.write`, active status and a live folder in this Space before accepting or consuming an upload. Tests cover missing permission, revoked publisher, deleted folder, stale authorization and cross-Space IDs. This checks existing authority and creates no grant.

The editor preview remains isolated with no scripts or submission. HTTPS images are allowed for an explicitly configured cover, with no referrer. Local preview answers never call a write capability. Existing nested conditional rules and unedited theme keys survive saves; the editor can add/edit simple conditions and preserve or remove existing combined conditions.

## Evidence

Production Chromium runs against a freshly claimed daemon and a real production web export. The Apps flow creates a permission-scoped company fixture, checks its relation label and actual choice options, tests conditional Email visibility with local Name answers, saves theme/CSS and checks their readback after reload, then creates a phone form and checks the rendered Name question. It also creates a campaign, saves/installs a draft template and stops at sending-domain review. No real messages, provider-domain changes or paid services are triggered.
