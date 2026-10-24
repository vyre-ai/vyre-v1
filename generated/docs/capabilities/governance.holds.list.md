# governance.holds.list

Everything under a hold

| | |
|---|---|
| Module | governance |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | records.hold |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/governance/holds/list |
| MCP tool | governance_holds_list (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  kind?: "file" | "channel" | "thread" | "folder" | "person";
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  holds: Array<{
      target: {
        kind: "file" | "channel" | "thread" | "folder" | "person";
        id: string;
      };
      title: string;
      reason: string;
      by: string;
      at: number;
    }>;
  next?: string;
  total?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "cursor": "example",
    "kind": "file",
    "limit": 1
  },
  "output": {
    "holds": [
      {
        "at": 1760000000000,
        "by": "example",
        "reason": "example",
        "target": {
          "id": "fil_a1b2c3",
          "kind": "file"
        },
        "title": "example"
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
