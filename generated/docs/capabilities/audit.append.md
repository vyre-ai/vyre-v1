# audit.append

System: add an audit row for an act a module audits by hand

| | |
|---|---|
| Module | audit |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/audit/append |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  action: string;
  class: "change" | "sensitive" | "deny" | "admin" | "erase" | "sign_in";
  resource?: {
    type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain";
    id: string;
  };
  onBehalfOf?: {
    kind: "person" | "agent" | "actor" | "service";
    id: string;
  };
  detail?: unknown;
};
```

## Output

```ts
type Out = {
  auditId: string;
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
    "action": "example",
    "class": "change",
    "detail": {},
    "onBehalfOf": {
      "id": "usr_a1b2c3",
      "kind": "person"
    },
    "resource": {
      "id": "rec_a1b2c3",
      "type": "space"
    }
  },
  "output": {
    "auditId": "aud_a1b2c3"
  }
}
```
