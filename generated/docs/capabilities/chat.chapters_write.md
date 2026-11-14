# chat.chapters_write

Write the title and one line of up to 3 closed chapters that only have the plain words of the chat, on a cheap model of the account that ran the turn. A model that fails leaves the plain words. Never holds a post

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
      "ref": "example"
    },
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "written": 1
  }
}
```
