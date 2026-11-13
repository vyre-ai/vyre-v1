# state.list

My things by what I did with them: starred, following, done, unread, muted, pinned (in my own order) or any (everything I have set on anything: one read paints a whole screen). Each row carries the thing's whole state

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
  flag: "starred" | "following" | "done" | "unread" | "muted" | "pinned" | "any";
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
      state: {
        thing: {
          type: string;
          id: string;
        };
        readUpto: number;
        unread: number;
        done: number | null;
        starred: number | null;
        follow: ("following" | "left") | null;
        alert: boolean;
        muted: number | null;
        pin: number | null;
      };
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
        "state": {
          "alert": true,
          "done": 1760000000000,
          "follow": "following",
          "muted": 1760000000000,
          "pin": 1,
          "readUpto": 1,
          "starred": 1760000000000,
          "thing": {
            "id": "cnv_a1b2c3",
            "type": "conversation"
          },
          "unread": 1
        },
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
