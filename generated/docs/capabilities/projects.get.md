# projects.get

Read one project: record fields, channel, folder and counts

| | |
|---|---|
| Module | projects |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | project (/projectId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/projects/get |
| MCP tool | projects_get (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  projectId: string;
};
```

## Output

```ts
type Out = {
  project: {
    projectId: string;
    recordId: string;
    type: string;
    title: string;
    summary?: string;
    status: string;
    lead?: string;
    start?: number;
    due?: number;
    channelId: string;
    folderId: string;
    memberCount: number;
    openTasks: number;
    lateTasks: number;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "projectId": "prj_a1b2c3"
  },
  "output": {
    "project": {
      "channelId": "chn_a1b2c3",
      "due": 1760000000000,
      "folderId": "fld_a1b2c3",
      "lateTasks": 1,
      "lead": "usr_a1b2c3",
      "memberCount": 1,
      "openTasks": 1,
      "projectId": "prj_a1b2c3",
      "recordId": "rec_a1b2c3",
      "start": 1760000000000,
      "status": "active",
      "summary": "example",
      "title": "example",
      "type": "contact"
    }
  }
}
```
