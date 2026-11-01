# inbox.match_suggestions

Suggested records for one sender

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
| HTTP | POST /v1/inbox/match_suggestions |
| MCP tool | inbox_match_suggestions (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  conversationId: string;
};
```

## Output

```ts
type Out = {
  suggestions: Array<{
      recordId: string;
      type: "contact" | "company";
      name: string;
      score: number;
      why: string;
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
    "conversationId": "cnv_a1b2c3"
  },
  "output": {
    "suggestions": [
      {
        "name": "example",
        "recordId": "rec_a1b2c3",
        "score": 1,
        "type": "contact",
        "why": "example"
      }
    ]
  }
}
```
