# notifications.delegate.resolve

Walk a person's delegate chain for an item and return the first holder who can act on it (access evaluated for each)

| | |
|---|---|
| Module | notifications |
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
| HTTP | POST /v1/notifications/delegate/resolve |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  person: string;
  resource: {
    type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain" | "calendar";
    id: string;
  };
};
```

## Output

```ts
type Out = {
  delegate?: {
    kind: "person" | "role";
    id: string;
  };
  walked: number;
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
    "person": "example",
    "resource": {
      "id": "rec_a1b2c3",
      "type": "space"
    }
  },
  "output": {
    "delegate": {
      "id": "example",
      "kind": "person"
    },
    "walked": 1
  }
}
```
