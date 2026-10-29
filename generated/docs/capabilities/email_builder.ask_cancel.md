# email_builder.ask_cancel

Stop my Ask Vyre request on a design that is still waiting for the agent

| | |
|---|---|
| Module | email-builder-api |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/email_builder/ask_cancel |
| MCP tool | email_builder_ask_cancel (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  emailId: string;
};
```

## Output

```ts
type Out = {
  cancelled: number;
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
    "emailId": "eml_a1b2c3"
  },
  "output": {
    "cancelled": 1
  }
}
```
