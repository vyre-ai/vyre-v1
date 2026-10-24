# vault.health

Team health: weak, reused, stale and rotation-due items (ids and issues only; breach checks come later)

| | |
|---|---|
| Module | vault |
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
| HTTP | POST /v1/vault/health |
| MCP tool | vault_health (vault) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  folderId?: string;
};
```

## Output

```ts
type Out = {
  total: number;
  weak: number;
  reused: number;
  stale: number;
  rotationDue: number;
  items: Array<{
      itemId: string;
      name: string;
      issues: Array<"weak" | "reused" | "stale" | "rotation_due">;
    }>;
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
    "folderId": "vfd_a1b2c3"
  },
  "output": {
    "items": [
      {
        "issues": [
          "weak"
        ],
        "itemId": "vit_a1b2c3",
        "name": "example"
      }
    ],
    "reused": 1,
    "rotationDue": 1,
    "stale": 1,
    "total": 1,
    "weak": 1
  }
}
```
