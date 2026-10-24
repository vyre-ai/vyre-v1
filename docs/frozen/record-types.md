# Record schemas (frozen)

Freeze review of the built-in record types and the synced entities named with them. Spec 2.9 (record types, fields, labels) and 2.10 (sync). ARCH 3.3 (events, entities, record types, fields, views). ARCH 7.4 (the Project record type and the system Task type that shares it).

The manifests are the source. `generated/sync/entities.ts` is the compiled sync profile. `generated/sync/replica.sql` is the replica table, including the version column. `contracts/tests/frozen-recordtypes.test.ts` locks this note. A change to a field, a label, a profile, or the version capabilities fails that test.

## Two shapes

A record type is a dynamic table `rt_<key>` declared with `rtype()`. Every field has a title. That title is the field label a person sees. The type sensitivity label is `internal`. The generator compiles one sync profile for every record type: desktop `all`, phone `window`, web `all`, window of the 500 most recent rows plus starred rows, `maxLabel` `internal`. Person fields and status fields are protected (assistant merge). Long text fields are text documents. One History for every record type is `records.versions` and `records.restore_version`. The replica row has a `version` column.

A synced entity is a core table declared with `entity()`. Each field has a type and a sensitivity label. The label is null unless the manifest sets one. Display titles are not part of the entity field. The default sync profile is desktop `all`, phone `window`, web `all`, and a manifest may override it. The replica row has a `version` column. Of this list, only `file` declares its own `versions` and `restore_version` (`files.versions`, `files.restore_version`). The other entities do not. Their row version is the sync version. They do not keep One History.

## Record types

Sync profile for all five: desktop `all`, phone `window`, web `all`. Type label `internal`. Versions: `records.versions`. Restore: `records.restore_version`.

### contact (`contacts-link`, `rt_contact`, id `rec_`)

Owner field `owner`. Summary field `company`. Group People. Attribution on. Protected field `owner`.

| Field | Type | Label | Required |
| --- | --- | --- | --- |
| name | text | Name | yes |
| title | text | Job title | |
| email | email | Email | |
| phone | phone | Phone | |
| company | relation | Company | |
| owner | person | Owner | |
| deliverability | choice | Deliverability | |
| pref_email_consent | choice | Email consent | |
| pref_sms_consent | choice | SMS consent | |
| pref_do_not_contact | checkbox | Do not contact | |
| pref_opt_outs | multichoice | Channel opt-outs | |
| pref_source | text | Preference source | |
| pref_at | datetime | Preference time | |

`company` relates to record type `company`, inverse `contacts`.

### company (`contacts-link`, `rt_company`, id `rec_`)

Owner field `owner`. Group People. Attribution on. Protected field `owner`.

| Field | Type | Label | Required |
| --- | --- | --- | --- |
| name | text | Name | yes |
| website | url | Website | |
| phone | phone | Phone | |
| address | address | Address | |
| owner | person | Owner | |
| contacts | relation | People | |

`contacts` relates to record type `contact`, inverse `company`.

### project (`projects`, `rt_project`, id `rec_`)

Template `project`. Workspace on (one channel, one folder, one plan). Title field `title`. Summary `summary`. Status `status`. Owner `lead`. Group Work. Protected fields `status`, `lead`. Text fields `goal`, `status_update`. Views: board grouped by status, timeline from `start` to `due`.

| Field | Type | Label | Required |
| --- | --- | --- | --- |
| title | text | Name | yes |
| summary | text | Summary | |
| status | status | Status | |
| lead | person | Lead | |
| start | datetime | Start | |
| due | datetime | Due | |
| goal | longtext | Brief and goal | |
| status_update | longtext | Status update | |
| status_update_at | datetime | Updated | |
| stages | multichoice | Stages | |
| channel | text | Channel | |
| folder | text | Folder | |
| pinned_files | files | Pinned files | |

### task (`projects`, `rt_task`, id `rec_`)

System type (cannot be dropped). Title field `title`. Summary `summary`. Status `status`. Owner `assigned`. Group Work. Protected field `status`. Text fields `why`, `notes`. The sync key `task` is this record type. The tasks module also keeps a `task_meta` entity. That entity is not this schema.

| Field | Type | Label | Required |
| --- | --- | --- | --- |
| title | text | Title | yes |
| summary | text | Summary | |
| why | longtext | Why | |
| kind | choice | Kind | |
| status | status | Status | |
| project | relation | Project | |
| stage | text | Stage | |
| assigned | text | Assigned | |
| reviewer | text | Reviewer | |
| approver | text | Approver | |
| start | datetime | Start | |
| due | datetime | Due | |
| effort | duration | Effort | |
| milestone | checkbox | Milestone | |
| parent | relation | Parent task | |
| depends_on | relation | Depends on | |
| order | number | Order | |
| source | text | Source | |
| thread | text | Thread | |
| attachments | files | Files | |
| notes | longtext | Working notes | |

`project` relates to `project` (inverse `tasks`). `parent` relates to `task` (inverse `subtasks`). `depends_on` relates to `task` (inverse `blocks`). `assigned`, `reviewer`, and `approver` are text, so they are not protected person fields.

### meeting (`meetings`, `rt_meeting`, id `rec_`)

Title field `title`. Summary `summary`. Status `status`. Owner `organizer`. Group Activity. Protected fields `status`, `organizer`. Text fields `transcript`, `summary`, `decisions`. The transcript field label is `confidential`. The type label stays `internal`.

| Field | Type | Label | Required | Sensitivity |
| --- | --- | --- | --- | --- |
| title | text | Title | yes | |
| starts_at | datetime | Starts | | |
| ends_at | datetime | Ends | | |
| provider | choice | Provider | | |
| join_url | url | Join link | | |
| status | status | Status | | |
| organizer | person | Organizer | | |
| attendees | relation | Attendees | | |
| calendar_event_id | text | Calendar event | | |
| provider_ref | text | Provider meeting id | | |
| recording | files | Recording | | |
| recording_state | choice | Recording state | | |
| transcript | longtext | Transcript | | confidential |
| summary | longtext | Summary | | |
| decisions | longtext | Decisions | | |

`attendees` relates to `contact`.

## Synced entities

Entity fields below have a type and a sensitivity label. An empty sensitivity cell means null. They have no display title in the entity schema.

### mailbox (`mail`, `mail_mailbox`, id `mbx_`)

Profile desktop `all`, phone `window`, web `all`. Protected fields `privacy`, `state`. No window and no max label. No `mailbox.versions` or `mailbox.restore_version`.

Fields: `kind` choice, `address` email, `title` text, `ownerId` person, `agentId` text, `provider` choice, `privacy` choice, `state` status, `connectionId` text, `lastSyncAt` datetime, `paused` checkbox.

### number (`telephony`, `telephony_number`, id `num_`)

Profile desktop `all`, phone `all`, web `all`. Protected fields `assigneeId`, `recording`, `state`. No `number.versions` or `number.restore_version`.

Fields: `e164` phone, `title` text, `capabilities` multichoice, `assigneeKind` choice, `assigneeId` text, `route` text, `hours` text, `recording` choice, `a2p` choice, `state` status, `twilioSid` text.

### conversation (`inbox`, `inbox_conversation`, id `cnv_`)

Profile desktop `all`, phone `window`, web `window`. Window 90 days or 300 recent rows. Protected field `needsMatch`. Access falls back to the mailbox when the contact is empty. No `conversation.versions` or `conversation.restore_version`.

Fields: `contactId` text, `address` text, `displayName` text, `lastMessageAt` datetime, `lastChannel` choice, `lastPreview` text, `unreadCount` number, `needsMatch` checkbox, `ownerId` person, `mailboxIds` text, `numberIds` text, `campaignId` text.

### call (`telephony`, `telephony_call`, id `cal_`)

Profile desktop `window`, phone `window`, web `window`. Window 90 days or 300 recent rows. `maxLabel` `confidential`. Parent is `number`. Transcript label is `confidential`. No `call.versions` or `call.restore_version`.

Fields: `numberId` text, `direction` choice, `from` text, `to` text, `contactId` text, `state` status, `startedAt` datetime, `answeredAt` datetime, `endedAt` datetime, `durationSec` duration, `handledBy` text, `recordingFileId` text, `transcript` longtext (confidential), `summary` longtext, `consentLogged` checkbox, `twilioSid` text, `traceId` text.

### sms (`telephony`, `telephony_sms`, id `sms_`)

Profile desktop `window`, phone `window`, web `window`. Window 90 days or 500 recent rows. `maxLabel` `confidential`. Parent is `number`. Body label is `confidential`. No `sms.versions` or `sms.restore_version`.

Fields: `numberId` text, `direction` choice, `from` text, `to` text, `body` longtext (confidential), `status` status, `contactId` text, `mediaFileIds` files, `campaignId` text, `at` datetime, `twilioSid` text, `traceId` text.

### calendar_event (`calendar`, `calendar_event`, id `cev_`)

Profile desktop `window`, phone `window`, web `window`. Window 120 days or 500 recent rows. Protected field `status`. Parent is `calendar`. No `calendar_event.versions` or `calendar_event.restore_version`. Trash restore is a separate event (`calendar_event.restored`), not One History.

Fields: `calendarId` text, `title` text, `startsAt` datetime, `endsAt` datetime, `allDay` checkbox, `location` text, `joinUrl` url, `joinProvider` choice, `description` longtext, `agenda` longtext, `attendees` text, `organizer` email, `recordIds` text, `meetingId` text, `providerId` text, `status` status, `bookedByAgentId` text, `fromBookingPage` text, `deletedAt` datetime.

### digest (`home`, `home_digests`, id `dgs_`)

Profile desktop `all`, phone `all`, web `all`. Window 14 days or 20 recent rows. Owned by `person`. No `digest.versions` or `digest.restore_version`.

Fields: `person` person, `period_start` datetime, `period_end` datetime, `headline` text, `items` text, `seen_at` datetime, `built_by` text.

### folder (`access`, `access_folders`, id `fld_`)

This is the list folder (Personal, Shared, Space), not a files directory. Files point at a folder through `folder_id`. There is no second sync key named `folder`.

Profile desktop `all`, phone `window`, web `all` (the entity default). No `folder.versions` or `folder.restore_version`.

Fields: `resourceType` choice, `name` text, `parentId` text, `scope` choice, `owner` text, `createdAt` datetime.

### file (`files`, `files_file`, id `fil_`)

Profile desktop `all`, phone `window`, web `window`. Window of 200 recent rows plus starred rows. Parent folder `folder_id`. Versions: `files.versions`. Restore: `files.restore_version` (a restore adds a new version). Version rows also live on the `file_version` entity. The file row itself still has the replica `version` column. The field named `version` maps onto that column.

Fields: `folder_id` text, `name` text, `kind` choice, `mime` text, `size` number, `version` number, `blob` text, `owner` text, `source_mount` text, `created_at` datetime, `updated_at` datetime, `updated_by` text, `deleted_at` datetime.

## Versioning

| Schema | Row version | versions | restore_version |
| --- | --- | --- | --- |
| contact, company, project, task, meeting | `version` on `rt_<key>` | `records.versions` | `records.restore_version` |
| file | `version` on `files_file` | `files.versions` | `files.restore_version` |
| mailbox, number, conversation, call, sms, calendar_event, digest, folder | `version` on the entity table | none of their own | none of their own |
