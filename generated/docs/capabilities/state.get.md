# state.get

My state on up to 500 things: how far I read, unread, done, starred, followed, muted

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
| HTTP | POST /v1/state/get |
| MCP tool | state_get (meta, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  things: Array<{
      type: string;
      id: string;
    }>;
};
```

## Output

```ts
type Out = {
  states: Array<{
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
    "things": [
      {
        "id": "cnv_a1b2c3",
        "type": "conversation"
      }
    ]
  },
  "output": {
    "states": [
      {
        "alert": true,
        "done": 1760000000000,
        "follow": "following",
        "muted": 1760000000000,
        "readUpto": 1,
        "starred": 1760000000000,
        "thing": {
          "id": "cnv_a1b2c3",
          "type": "conversation"
        },
        "unread": 1
      }
    ]
  }
}
```
