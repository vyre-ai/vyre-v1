# governance.tombstones.list

Tombstones that a restore will replay (kinds and times only)

| | |
|---|---|
| Module | governance |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | policy.manage |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/governance/tombstones/list |
| MCP tool | governance_tombstones_list (engineer) |
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
  tombstones: Array<{
      id: string;
      kind: string;
      at: number;
      by: string;
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
    "next": "example",
    "tombstones": [
      {
        "at": 1760000000000,
        "by": "example",
        "id": "tmb_a1b2c3",
        "kind": "example"
      }
    ],
    "total": 1
  }
}
```
