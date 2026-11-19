# browser.cards.post

Leave a card in a chat for work in the person's own Chrome: a held send with the page's To, From, Subject and Message, or the "Using your Chrome" step with a masked picture. Never routes to an agent

| | |
|---|---|
| Module | browser |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | member |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/browser/cards/post |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  block: {
    type: "chrome_held" | "chrome_step";
    data: unknown;
  };
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  posted: boolean;
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
    "block": {
      "data": {},
      "type": "chrome_held"
    },
    "idempotencyKey": "idem_1",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "posted": true
  }
}
```
