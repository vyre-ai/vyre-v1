# projects.create

Make a project: the record, exactly one channel and one folder (Projects/<name>), and an empty plan

| | |
|---|---|
| Module | projects |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | records.create |
| Grant level | edit |
| Risk | medium |
| Resource | record_type (create under /type) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/projects/create |
| MCP tool | projects_create (records) |
| CLI | vyre projects create |
| Emits | project.created, record.created |

## Input

```ts
type In = {
  type: string;
  title: string;
  summary?: string;
  goal?: string;
  lead?: string;
  start?: number;
  due?: number;
  stages?: Array<{
      key?: string;
      title: string;
    }>;
  members?: Array<{
      principal: string;
      role: "lead" | "member" | "reviewer" | "guest";
    }>;
  template?: string;
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

## Example

```json
{
  "name": "example",
  "input": {
    "due": 1760000000000,
    "goal": "example",
    "idempotencyKey": "idem_1",
    "lead": "usr_a1b2c3",
    "members": [
      {
        "principal": "usr_a1b2c3",
        "role": "lead"
      }
    ],
    "stages": [
      {
        "key": "draft",
        "title": "example"
      }
    ],
    "start": 1760000000000,
    "summary": "example",
    "template": "example",
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
