# state.set

Mark a thing done or open again, star it, follow or leave it, set Alert me on replies, mute it, or pin it (`pin: {}` puts it last among my pins of this kind, `{ after: null }` first, `{ after: thing }` right below that pin; `pin: null` takes it off). Give at least one

| | |
|---|---|
| Module | state |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | member |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/state/set |
| MCP tool | state_set (meta, deferred) |
| CLI | none |
| Emits | state.changed |

## Input

```ts
type In = {
  thing: {
    type: string;
    id: string;
  };
  done?: boolean;
  star?: boolean;
  follow?: ("following" | "left") | null;
  alert?: boolean;
  mute?: {
    until: number;
  } | null;
  pin?: ({
    after?: {
      type: string;
      id: string;
    } | null;
  }) | null;
};
```

## Output

```ts
type Out = {
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
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "alert": true,
    "done": true,
    "follow": "following",
    "mute": {
      "until": 1760000000000
    },
    "pin": {
      "after": {
        "id": "cnv_a1b2c3",
        "type": "conversation"
      }
    },
    "star": true,
    "thing": {
      "id": "cnv_a1b2c3",
      "type": "conversation"
    }
  },
  "output": {
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
    }
  }
}
```
