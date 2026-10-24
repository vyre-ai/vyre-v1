# vault.unshare

Stop sharing an item or folder with someone

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
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/vault/unshare |
| MCP tool | vault_unshare (vault) |
| CLI | none |
| Emits | grant.revoked, access.changed, folder.shared |

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
};
```

## Output

```ts
type Out = {
  revoked: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
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
    "revoked": 1
  }
}
```
