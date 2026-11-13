# state.gain

Host only: a person gets access to a scope; they start with nothing unread and keep the flags they had

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
| HTTP | POST /v1/state/gain |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  person: string;
  scope: string;
};
```

## Output

```ts
type Out = {
  rows: number;
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
    "person": "example",
    "scope": "mailbox:mbx_a1b2c3"
  },
  "output": {
    "rows": 1
  }
}
```
