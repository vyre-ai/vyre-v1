# projects.from_channel

Make this channel a project: create the record and attach the channel, a folder and an empty plan

| | |
|---|---|
| Module | projects |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | records.create |
| Grant level | manage |
| Risk | medium |
| Resource | channel (/channelId) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/projects/from_channel |
| MCP tool | projects_from_channel (records) |
| CLI | none |
| Emits | project.created, record.created |

## Input

```ts
type In = {
  channelId: string;
  type?: string;
  title?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  projectId: string;
  recordId: string;
  channelId: string;
  folderId: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "channelId": "chn_a1b2c3",
    "idempotencyKey": "idem_1",
    "title": "example",
    "type": "contact"
  },
  "output": {
    "channelId": "chn_a1b2c3",
    "folderId": "fld_a1b2c3",
    "projectId": "prj_a1b2c3",
    "recordId": "rec_a1b2c3"
  }
}
```
