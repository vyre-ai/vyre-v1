# mail.template.reset

Reset a template to the one that ships with Vyre

| | |
|---|---|
| Module | mail |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | comms.templates |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | send when actor.kind != 'person' |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mail/template/reset |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  key: string;
};
```

## Output

```ts
type Out = {
  reset: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "key": "signature.request"
  },
  "output": {
    "reset": true
  }
}
```
