# access.request

Ask the Manage holders of a resource (or the admins, for a permission) for access; one open request per person and resource

| | |
|---|---|
| Module | access |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/access/request |
| MCP tool | access_request (meta) |
| CLI | none |
| Emits | access.requested |

## Input

```ts
type In = {
  resource: {
    type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain" | "calendar";
    id: string;
  };
  level: "view" | "use" | "edit" | "manage";
  note?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  request: {
    id: string;
    requester: string;
    resource: {
      type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain" | "calendar";
      id: string;
    };
    level: "view" | "use" | "edit" | "manage";
    note?: string;
    state: "waiting" | "granted" | "declined";
    taskId: string;
    at: number;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.guest_cannot_request
- permission.needs_team
- permission.no_grant
- validation.bad_input
- validation.duplicate

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "level": "view",
    "note": "example",
    "resource": {
      "id": "rec_a1b2c3",
      "type": "space"
    }
  },
  "output": {
    "request": {
      "at": 1760000000000,
      "id": "arq_a1b2c3",
      "level": "view",
      "note": "example",
      "requester": "usr_a1b2c3",
      "resource": {
        "id": "rec_a1b2c3",
        "type": "space"
      },
      "state": "waiting",
      "taskId": "tsk_a1b2c3"
    }
  }
}
```
