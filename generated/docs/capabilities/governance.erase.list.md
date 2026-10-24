# governance.erase.list

Past erasures: who, when and which kinds (never what)

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
| HTTP | POST /v1/governance/erase/list |
| MCP tool | governance_erase_list (engineer) |
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
  erasures: Array<{
      findingId: string;
      by: string;
      at: number;
      kinds: Array<"records" | "files" | "chats" | "inbox" | "mail" | "calls" | "memory" | "runs">;
      tombstones: number;
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
    "erasures": [
      {
        "at": 1760000000000,
        "by": "example",
        "findingId": "fnd_a1b2c3",
        "kinds": [
          "records"
        ],
        "tombstones": 1
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
