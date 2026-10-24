# audit.export

Export audit rows as CSV into a file

| | |
|---|---|
| Module | audit |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | audit.read |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/audit/export |
| MCP tool | audit_export (engineer) |
| CLI | none |
| Emits | audit.exported |

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
};
```

## Output

```ts
type Out = {
  fileId: string;
  rows: number;
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
    "from": 1760000000000,
    "resource": {
      "id": "rec_a1b2c3",
      "type": "space"
    },
    "to": 1760000000000
  },
  "output": {
    "fileId": "fil_a1b2c3",
    "rows": 1
  }
}
```
