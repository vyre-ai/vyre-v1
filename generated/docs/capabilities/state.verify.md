# state.verify

Host only: compare every head, unread and badge with the entries and the rows; with repair, fix what differs. Runs at module start and in the doctor

| | |
|---|---|
| Module | state |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | member |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/state/verify |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  person?: string;
  scope?: string;
  repair?: boolean;
  deep?: boolean;
};
```

## Output

```ts
type Out = {
  problems: Array<{
      kind: "head" | "unread" | "count";
      detail: string;
      person?: string;
      thing?: {
        type: string;
        id: string;
      };
      scope?: string;
    }>;
  repaired: number;
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
    "deep": true,
    "person": "example",
    "repair": true,
    "scope": "mailbox:mbx_a1b2c3"
  },
  "output": {
    "problems": [
      {
        "detail": "example",
        "kind": "head",
        "person": "example",
        "scope": "example",
        "thing": {
          "id": "cnv_a1b2c3",
          "type": "conversation"
        }
      }
    ],
    "repaired": 1
  }
}
```
