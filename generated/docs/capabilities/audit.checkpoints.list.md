# audit.checkpoints.list

Signed checkpoints (every 1000 events or 10 minutes)

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
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/audit/checkpoints/list |
| MCP tool | audit_checkpoints_list (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  checkpoints: Array<{
      seq: number;
      at: number;
      hash: string;
      signatureOk: boolean;
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
    "cursor": "example",
    "limit": 1
  },
  "output": {
    "checkpoints": [
      {
        "at": 1760000000000,
        "hash": "example",
        "seq": 1,
        "signatureOk": true
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
