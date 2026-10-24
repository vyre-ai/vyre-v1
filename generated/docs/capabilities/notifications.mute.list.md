# notifications.mute.list

My active mutes

| | |
|---|---|
| Module | notifications |
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
| HTTP | POST /v1/notifications/mute/list |
| MCP tool | notifications_mute_list (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  mutes: Array<{
      target: {
        kind: "person" | "agent" | "channel" | "record" | "thread";
        id: string;
      };
      until: number;
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
  "input": {},
  "output": {
    "mutes": [
      {
        "target": {
          "id": "agt_a1b2c3",
          "kind": "person"
        },
        "until": 1760000000000
      }
    ]
  }
}
```
