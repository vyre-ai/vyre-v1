# scheduler.can_hold

System: may this person hold scheduled work for this agent (a routine, a goal), and read its channel? Says why not, in reasons. Gives the answer a hand-over needs

| | |
|---|---|
| Module | scheduler-api |
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
| HTTP | POST /v1/scheduler/can_hold |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  person: string;
  agentId: string;
  channelId?: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
  reasons: Array<"not_in_space" | "cannot_use_agent" | "cannot_read_channel" | "agent_missing">;
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
    "agentId": "agt_a1b2c3",
    "channelId": "chn_a1b2c3",
    "person": "usr_a1b2c3"
  },
  "output": {
    "ok": true,
    "reasons": [
      "not_in_space"
    ]
  }
}
```
