# inbox.counts

Unread counts for the sidebar: per inbox, per number and the Needs a match total

| | |
|---|---|
| Module | inbox |
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
| HTTP | POST /v1/inbox/counts |
| MCP tool | inbox_counts (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  byInbox: Array<{
      kind: "mailbox" | "number";
      id: string;
      name?: string;
      unread: number;
    }>;
  total: number;
  needsMatch: number;
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
  "input": {},
  "output": {
    "byInbox": [
      {
        "id": "example",
        "kind": "mailbox",
        "name": "example",
        "unread": 1
      }
    ],
    "needsMatch": 1,
    "total": 1
  }
}
```
