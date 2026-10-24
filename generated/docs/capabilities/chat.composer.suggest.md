# chat.composer.suggest

Composer symbol tables: @ people and agents, # folders, channels, records and files, / commands, skills and templates

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
| HTTP | POST /v1/chat/composer/suggest |
| MCP tool | chat_composer_suggest (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  symbol: "@" | "#" | "/";
  q: string;
  threadId?: string;
};
```

## Output

```ts
type Out = {
  items: Array<{
      group: string;
      kind: string;
      id: string;
      title: string;
      detail?: string;
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
  "input": {
    "q": "example",
    "symbol": "@",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "items": [
      {
        "detail": "example",
        "group": "example",
        "id": "example",
        "kind": "example",
        "title": "example"
      }
    ]
  }
}
```
