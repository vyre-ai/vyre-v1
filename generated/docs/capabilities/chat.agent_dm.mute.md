# chat.agent_dm.mute

Mute agent messages from one person for the rest of my day; what their agents send waits until tomorrow and the person is told. undo lifts it

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/chat/agent_dm/mute |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  personId: string;
  undo?: boolean;
};
```

## Output

```ts
type Out = {
  until: number | null;
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
    "personId": "usr_a1b2c3",
    "undo": true
  },
  "output": {
    "until": 1760000000000
  }
}
```
