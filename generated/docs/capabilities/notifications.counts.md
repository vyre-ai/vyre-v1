# notifications.counts

Counts for the rail (Needs you and direct conversations only) and a quiet dot per other place

| | |
|---|---|
| Module | notifications |
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
| HTTP | POST /v1/notifications/counts |
| MCP tool | notifications_counts (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  rail: {
    needsYou: number;
    directConversations: number;
  };
  dots: Record<string, number>;
  otherSpaces: Array<{
      spaceId: string;
      needsYou: number;
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
  "input": {},
  "output": {
    "dots": {},
    "otherSpaces": [
      {
        "needsYou": 1,
        "spaceId": "spc_a1b2c3"
      }
    ],
    "rail": {
      "directConversations": 1,
      "needsYou": 1
    }
  }
}
```
