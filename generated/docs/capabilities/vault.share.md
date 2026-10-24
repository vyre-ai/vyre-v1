# vault.share

Share an item or folder with a person, group, agent or automation at Use, View, Edit or Manage; subscription sign-ins are never shareable

| | |
|---|---|
| Module | vault |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/vault/share |
| MCP tool | vault_share (vault) |
| CLI | none |
| Emits | grant.created, access.changed, folder.shared |

## Input

```ts
type In = {
  resource: {
    type: "vault_item" | "vault_folder";
    id: string;
  };
  subject: {
    kind: "person" | "agent" | "actor" | "service" | "group" | "role" | "link";
    id: string;
  };
  level: "view" | "use" | "edit" | "manage";
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  granted: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.not_contained
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "level": "view",
    "resource": {
      "id": "vit_a1b2c3",
      "type": "vault_item"
    },
    "subject": {
      "id": "usr_a1b2c3",
      "kind": "person"
    }
  },
  "output": {
    "granted": true
  }
}
```
