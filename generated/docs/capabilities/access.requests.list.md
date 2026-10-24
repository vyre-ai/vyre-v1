# access.requests.list

Access requests I made, or waiting on me to decide

| | |
|---|---|
| Module | access |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/access/requests/list |
| MCP tool | access_requests_list (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  mine?: boolean;
  state?: "waiting" | "granted" | "declined";
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  requests: Array<{
      id: string;
      requester: string;
      resource: {
        type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain";
        id: string;
      };
      level: "view" | "use" | "edit" | "manage";
      note?: string;
      state: "waiting" | "granted" | "declined";
      taskId: string;
      at: number;
    }>;
  next?: string;
  total?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "cursor": "example",
    "limit": 1,
    "mine": true,
    "state": "waiting"
  },
  "output": {
    "next": "example",
    "requests": [
      {
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
    ],
    "total": 1
  }
}
```
