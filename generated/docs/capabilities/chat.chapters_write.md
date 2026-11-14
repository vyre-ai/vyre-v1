# chat.chapters_write

Head closed chapters of a long chat, each at most once ever: a cheap model on the asker's own api_key account (never a subscription, never someone else's), only for a chapter the asker opened, at most about 750 tokens in and 40 out. Anything else keeps the plain words. Never holds a post

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
| HTTP | POST /v1/chat/chapters_write |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  account?: {
    ref: string;
    driver: string;
    kind?: string;
  };
};
```

## Output

```ts
type Out = {
  written: number;
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
      "ref": "example"
    },
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "written": 1
  }
}
```
