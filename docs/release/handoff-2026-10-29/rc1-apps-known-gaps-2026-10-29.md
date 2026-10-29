# Concrete remaining Apps gaps, 29 October 2026 04:24 PKT

Read-only audit, stopped at lead request. Existing v1 design stays authoritative. No changes made by this audit. Sites remain the accepted v1.1 exclusion; durable automation belongs to Grok.

## P1: Forms Code is CSS only; accepted HTML/CSS/JS roundtrip is absent

Accepted prototype `/Users/irfad/Downloads/Vyre-v1-prototype.html:68438` says form source is HTML, CSS and JS, inputs stay bound to record fields, Build keeps working after code edits, custom parts become locked code parts. Production `apps/app/src/places/apps/shell/FormWorkspace.tsx:26` exposes only Custom CSS. Its props carry css/onCss, no HTML or JS state. `manifests/forms.ts:27` get and `:31` design_set expose CSS/theme/logic only, so there is no saved source contract for that roundtrip. Prior checkpoint line81 already identified this as open. Actual `apps.editors.live.test.ts:57` proves CSS save/reload; it does not cover HTML/JS or Build-to-Code roundtrip. This gap remains open.

## P1: Form Ask leaves the editor; no inline proposed diff acceptance

`apps/app/src/places/apps/shell/FormEditor.tsx:118` Ask calls chat.start and navigates through d.nav.openThread. `FormWorkspace.tsx:12` accepts only ask():void, and its toolbar invokes that callback. No inline proposal state, version/diff or accept-per-change callback exists in that form controller. This matches the unresolved inline Ask item in checkpoint81. A real scoped chat opening does not complete the prototype's inline source-edit/diff workflow.

## P1: Public relation/person answers remain unsupported

Authenticated design preview is now implemented: `FormEditor.tsx:46` resolves authorized target record labels; actual browser `apps.editors.live.test.ts:52` checks the real Company option. Public behavior remains blocked: `FormEditor.tsx:110` warns and `:113` disables publication when an asked relation/person question is required. `modules/forms/handlers/index.ts:201` enforces that condition server-side. `modules/forms/handlers/submit.ts:164` rejects relation/person values. No publisher-approved public choice grant seam exists. These guards prevent disclosure and must remain until an authorized choice contract is implemented. Preview support closed the old preview gap, not the production visitor behavior.

## P1: Email Ask UI exists but production Ask driver is never installed

CampaignEmail now supports manual HTML/visual/plain save and actual ask_diff result application: `CampaignEmail.tsx:21`, `:38`, `:60`, `:91-92`. It should not be reported as wholly absent. However `modules/email-builder-api/handlers/compile.ts:51` initializes askDriver=null; `:54` provides configureEmailBuilder; `:754` refuses every ask_diff if no driver exists. Repository search finds configureEmailBuilder only in that module's exports and fixtures/tests, never a production daemon/host driver, and impl.ts exports no hostSeams hook. Configuring a model in Settings cannot populate this global by itself. Existing backend tests inject an AskDriver; they do not prove production agent-backed Ask works. V1-SPEC3.6 requires an agent selector and accepted per-change diff. This production wiring gap remains open.

## Closed evidence retained

Apps no longer mounts a deferred Sites frame. Forms/Campaigns/Templates/domains have actual controllers, nested route/history proof, and conditional typed preview. The release screenshot gate now requires apps-place; actual Paper/light and Graphite/dark3/3 passed in `/tmp/vyre-apps-shot-gate-green.log`. E-mail manual HTML save exists in CampaignEmail and shared EmailBuilder. Do not reopen those completed mounts or reinvent the visual direction.

## Separate platform findings handed to lead

Saved-code self-recovery and production multi-Space switching are separate P1 findings. Lead owns recovery investigation; this agent is assigned multi-Space switching next. Packaged real-user history import and physical iPhone A2HS remain explicit acceptance obligations; no new implementation defect was established for them in this bounded audit.
