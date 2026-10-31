# automations.connector_card

Post a compact card in the chat: a title and up to 20 rows, each done or not. Used for connector test results and the review before publish. A key is refused.

| | |
|---|---|
| Module | automations |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/automations/connector_card |
| MCP tool | automations_connector_card (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  title: string;
  items: Array<{
      text: string;
      done: boolean;
    }>;
};
```

## Output

```ts
type Out = {
  messageId: string;
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
    "items": [
      {
        "done": true,
        "text": "example"
      }
    ],
    "threadId": "thr_a1b2c3",
    "title": "example"
  },
  "output": {
    "messageId": "example"
  }
}
```
