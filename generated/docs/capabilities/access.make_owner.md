# access.make_owner

The owner hands an item to someone else: they become the owner and the previous owner keeps Manage

| | |
|---|---|
| Module | access |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | transfer when actor.kind != 'person' |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/access/make_owner |
| MCP tool | none |
| CLI | none |
| Emits | grant.created, access.changed |

## Input

```ts
type In = {
  resource: {
    type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain" | "calendar" | "skill";
    id: string;
  };
  personId: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "personId": "usr_a1b2c3",
    "resource": {
      "id": "rec_a1b2c3",
      "type": "space"
    }
  },
  "output": {
    "ok": true
  }
}
```
