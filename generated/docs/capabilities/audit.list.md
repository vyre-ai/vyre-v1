# audit.list

List audit rows with filters (Console Audit log)

| | |
|---|---|
| Module | audit |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | audit.read |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | yes |
| HTTP | POST /v1/audit/list |
| MCP tool | audit_list (engineer) |
| CLI | vyre audit list |
| Emits | none |

## Input

```ts
type In = {
  actor?: {
    kind: "person" | "agent" | "actor" | "service";
    id: string;
  };
  action?: string;
  resource?: {
    type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain";
    id: string;
  };
  class?: "change" | "sensitive" | "deny" | "admin" | "erase" | "sign_in";
  from?: number;
  to?: number;
  q?: string;
  traceId?: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  rows: Array<{
      id: string;
      at: number;
      actor: {
        kind: "person" | "agent" | "actor" | "service";
        id: string;
      };
      onBehalfOf?: {
        kind: "person" | "agent" | "actor" | "service";
        id: string;
      };
      action: string;
      resource?: {
        type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain";
        id: string;
      };
      class: "change" | "sensitive" | "deny" | "admin" | "erase" | "sign_in";
      before?: unknown;
      after?: unknown;
      traceId: string;
      requestId?: string;
      seq: number;
    }>;
  next?: string;
  total?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "action": "example",
    "actor": {
      "id": "usr_a1b2c3",
      "kind": "person"
    },
    "class": "change",
    "cursor": "example",
    "from": 1760000000000,
    "limit": 1,
    "q": "example",
    "resource": {
      "id": "rec_a1b2c3",
      "type": "space"
    },
    "to": 1760000000000,
    "traceId": "0123456789abcdef0123456789abcdef"
  },
  "output": {
    "next": "example",
    "rows": [
      {
        "action": "grant.created",
        "actor": {
          "id": "usr_a1b2c3",
          "kind": "person"
        },
        "after": {},
        "at": 1760000000000,
        "before": {},
        "class": "change",
        "id": "aud_a1b2c3",
        "onBehalfOf": {
          "id": "usr_a1b2c3",
          "kind": "person"
        },
        "requestId": "arq_a1b2c3",
        "resource": {
          "id": "rec_a1b2c3",
          "type": "space"
        },
        "seq": 1,
        "traceId": "0123456789abcdef0123456789abcdef"
      }
    ],
    "total": 1
  }
}
```
