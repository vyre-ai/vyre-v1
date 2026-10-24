# notifications.mute.set

Mute a sender, channel, record or thread (default one hour)

| | |
|---|---|
| Module | notifications |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/notifications/mute/set |
| MCP tool | notifications_mute_set (meta) |
| CLI | none |
| Emits | notification.muted |

## Input

```ts
type In = {
  target: {
    kind: "person" | "agent" | "channel" | "record" | "thread";
    id: string;
  };
  minutes?: number;
};
```

## Output

```ts
type Out = {
  until: number;
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
    "minutes": 1,
    "target": {
      "id": "agt_a1b2c3",
      "kind": "person"
    }
  },
  "output": {
    "until": 1760000000000
  }
}
```
