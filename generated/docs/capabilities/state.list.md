# state.list

My things by what I did with them: starred, following, done, unread or muted

| | |
|---|---|
| Module | state |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | member |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/state/list |
| MCP tool | state_list (meta, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  flag: "starred" | "following" | "done" | "unread" | "muted";
  type?: string;
  scope?: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  rows: Array<{
      thing: {
        type: string;
        id: string;
      };
      title: string;
      at: number;
      unread: number;
    }>;
  next?: string;
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
    "cursor": "example",
    "flag": "starred",
    "limit": 1,
    "scope": "mailbox:mbx_a1b2c3",
    "type": "example"
  },
  "output": {
    "next": "example",
    "rows": [
      {
        "at": 1760000000000,
        "thing": {
          "id": "cnv_a1b2c3",
          "type": "conversation"
        },
        "title": "example",
        "unread": 1
      }
    ]
  }
}
```
