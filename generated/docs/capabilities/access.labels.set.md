# access.labels.set

Set the sensitivity label of a folder, channel, inbox or other container (items inherit unless set)

| | |
|---|---|
| Module | access |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | policy.manage |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/access/labels/set |
| MCP tool | access_labels_set (engineer) |
| CLI | none |
| Emits | access.changed |

## Input

```ts
type In = {
  resource: {
    type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain";
    id: string;
  };
  label: "public" | "internal" | "confidential" | "restricted";
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
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "label": "public",
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
