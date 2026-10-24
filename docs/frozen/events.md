# Event catalogue freeze

Freeze review of the committed event catalogue. The rules are ARCHITECTURE-V1 section 3.3 (name, schema version, payload schema, subject, vis, label, redact) and V1-SPEC section 2.22 (the Space event log and the catalogue a reader can list). This is acceptance AC24.

The catalogue is the `events` array in `generated/registry.json`, emitted by tools/gen from `manifests/`. Each event also has a page under `generated/docs/events/`. Manifests and generated files stay as they are. The lock is the count, the hash, and `contracts/tests/frozen-events.test.ts`.

## Frozen values

| Item | Value |
|---|---|
| Events | 598 |
| Hash | `79cbbc7b64fa608656dc5c093b3174d31bbfd49935601ef8f88c0184f3701185` |
| Hash input | SHA-256 of the canonical JSON of the events array (`lib/canonical.ts`: sorted keys, no whitespace) |
| Schema version | 1 on every event |
| Distinct names | 598 |
| Primitives | 139 |
| Registry hash | `3ff9acdeef414687ab8031f3daec6c5dfbffe9fe8653782f01d6abda10368283` (`generated/hash.txt`) |

The registry hash covers the whole registry. The event hash covers the events array only.

## Checks

Name. Every name is `<primitive>.<verb>`: `^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$`. One dot, both segments lowercase, digits and underscores allowed (`access_review.closed`, `calendar_event.created`). 598 names, all unique, 139 primitives.

Owner. Every event carries `module`, and that id is one of the registry modules. 74 modules own at least one event. Six modules declare none: `console-views`, `default`, `estate-planning`, `harbor-studio`, `law-firm-intake`, `steps-core`.

Payload. Every payload dereferences through `$ref` into `$defs` to a JSON Schema with `type: object` and at least one property. The subject id is a JSON pointer into that schema. 270 subjects use type `entity`. The rest use a resource type from the architecture list (`record`, `file`, `thread`, `task`, and the others on `EventDef`).

vis. `space` 429, `participants` 127, `owner` 41, `private` 1 (`signin.failed`).

label. 460 events omit `label`. 136 use `subject` (the event inherits the subject's label). 2 use `internal`: `console.change_applied` (console-assistant) and `schema.changed` (schema).

redact. Three events name payload pointers that readers below clearance lose. Each pointer is a property of that event's payload:

| Event | Pointer | Label | Module |
|---|---|---|---|
| conflict.opened | /recordId | subject | sync |
| conflict.resolved | /summary | subject | conflicts |
| mail.received | /subject | subject | mail |

sv. Every event has integer schema version 1.

`replay` is `pure` on 552 events and `stub` on 46. 79 events carry an automation trigger with a title. 42 name a notification kind, and each kind is in the registry. 110 name a retention key, and each key is in the registry. Summaries are present on all 598.

## Events per module

| Module | Events |
|---|---|
| access | 18 |
| agents | 11 |
| audit | 4 |
| automations | 18 |
| backup | 5 |
| calendar | 6 |
| campaigns | 6 |
| chat | 34 |
| computers | 12 |
| conflicts | 6 |
| connectors | 24 |
| console-assistant | 3 |
| contacts-link | 6 |
| devices | 6 |
| documenso | 1 |
| documents | 2 |
| docusign | 1 |
| dropbox-sign | 1 |
| email-builder-api | 2 |
| engine | 25 |
| esign | 4 |
| events | 7 |
| files | 28 |
| forms | 5 |
| gate | 5 |
| git | 8 |
| github | 11 |
| google | 4 |
| governance | 6 |
| health | 5 |
| home | 3 |
| hubspot | 1 |
| identity | 10 |
| import | 3 |
| inbox | 7 |
| journeys | 10 |
| kits | 6 |
| logs | 4 |
| mail | 24 |
| mailgun | 2 |
| mcp | 6 |
| meetings | 8 |
| members | 5 |
| memory | 14 |
| microsoft | 4 |
| mounts | 7 |
| network | 5 |
| notifications | 10 |
| portal | 4 |
| previews | 2 |
| projects | 16 |
| records | 11 |
| reports-client | 3 |
| resend | 2 |
| runbooks | 4 |
| runs | 9 |
| scheduler-api | 10 |
| schema | 7 |
| search | 1 |
| settings | 2 |
| sites | 10 |
| sources | 11 |
| spaces | 10 |
| stripe | 11 |
| sync | 6 |
| tasks | 20 |
| telephony | 16 |
| templates | 2 |
| terminal | 5 |
| twilio | 4 |
| updates | 4 |
| vault | 20 |
| vault-requests | 4 |
| zoom | 1 |
