# chat.ask_suggest

Suggested agent for an Ask pane: the agent that booked the event, else the contact agent, else the person last used

| | |
|---|---|
| Module | chat |
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
| HTTP | POST /v1/chat/ask_suggest |
| MCP tool | chat_ask_suggest (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  scopeType: string;
  scopeId: string;
};
```

## Output

```ts
type Out = {
  agentId: string | null;
  reason: "booked_by" | "contact_agent" | "last_used" | "none";
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
    "scopeId": "example",
    "scopeType": "example"
  },
  "output": {
    "agentId": "agt_a1b2c3",
    "reason": "booked_by"
  }
}
```
