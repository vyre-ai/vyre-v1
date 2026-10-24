# notifications.mute.clear

End a mute

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
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/notifications/mute/clear |
| MCP tool | notifications_mute_clear (meta) |
| CLI | none |
| Emits | notification.unmuted |

## Input

```ts
type In = {
  target: {
    kind: "person" | "agent" | "channel" | "record" | "thread";
    id: string;
  };
};
```

## Output

```ts
type Out = {
  cleared: boolean;
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
    "target": {
      "id": "agt_a1b2c3",
      "kind": "person"
    }
  },
  "output": {
    "cleared": true
  }
}
```
