# inbox.thread_conversation

The conversation of an email thread, from its provider thread id

| | |
|---|---|
| Module | inbox |
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
| HTTP | POST /v1/inbox/thread_conversation |
| MCP tool | inbox_thread_conversation (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
};
```

## Output

```ts
type Out = {
  conversationId?: string;
  contactId?: string;
  subject?: string;
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
    "threadId": "18c2a1f04e9b"
  },
  "output": {
    "contactId": "rec_a1b2c3",
    "conversationId": "cnv_a1b2c3",
    "subject": "example"
  }
}
```
