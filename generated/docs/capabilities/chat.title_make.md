# chat.title_make

Name a chat from its first real request: 2 to 5 plain words, on a cheap model of the account that ran the turn or from the request's own words, never from a greeting. Made again once if the first came from a thin request; never after a person renamed the chat

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/chat/title_make |
| MCP tool | none |
| CLI | none |
| Emits | thread.updated |

## Input

```ts
type In = {
  threadId: string;
  account?: {
    ref: string;
    driver: string;
    kind?: string;
    payer?: string;
    spaceKey?: boolean;
  };
};
```

## Output

```ts
type Out = {
  made: boolean;
  title?: string;
  why?: "renamed" | "not_a_chat" | "direct" | "small_talk" | "done" | "has_title";
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
    "account": {
      "driver": "example",
      "kind": "example",
      "payer": "example",
      "ref": "example",
      "spaceKey": true
    },
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "made": true,
    "title": "example",
    "why": "renamed"
  }
}
```
