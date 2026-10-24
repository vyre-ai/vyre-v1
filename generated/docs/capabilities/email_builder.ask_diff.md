# email_builder.ask_diff

Ask Vyre edit: returns a per-change diff the author accepts change by change

| | |
|---|---|
| Module | email-builder-api |
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
| HTTP | POST /v1/email_builder/ask_diff |
| MCP tool | email_builder_ask_diff (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  emailId: string;
  instruction: string;
  agentId?: string;
};
```

## Output

```ts
type Out = {
  changes: Array<{
      path: string;
      before: unknown;
      after: unknown;
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
    "agentId": "agt_a1b2c3",
    "emailId": "eml_a1b2c3",
    "instruction": "example"
  },
  "output": {
    "changes": [
      {
        "after": {},
        "before": {},
        "path": "example"
      }
    ]
  }
}
```
